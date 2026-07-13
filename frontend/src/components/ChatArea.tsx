import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { sendMessageStream } from '../utils/api'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { filesToAttachments } from '../utils/attachments'
import type { Message, Attachment } from '../types'
import MessageComponent from './Message'
import InputComposer from './InputComposer'
import EmptyState from './EmptyState'

export default function ChatArea() {
  const {
    currentConversationId, createConversation, selectConversation,
    addMessage, appendMessageContent, finalizeMessage, setMessageError,
    setConversationTitleFromMessage, getCurrentConversation,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  const [hasNewMessage, setHasNewMessage] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const isOnline = useOnlineStatus()

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const dragCounterRef = useRef(0)
  const lastMessageCountRef = useRef(0)

  const conv = getCurrentConversation()
  const messages = conv?.messages ?? []

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    if (!userScrolledRef.current) {
      scrollToBottom(false)
    } else if (messages.length > lastMessageCountRef.current) {
      setHasNewMessage(true)
    }
    lastMessageCountRef.current = messages.length
  }, [messages, scrollToBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowJumpBtn(!nearBottom)
    userScrolledRef.current = !nearBottom
    if (nearBottom) setHasNewMessage(false)
  }

  // Reset scroll tracking on conversation change
  useEffect(() => {
    userScrolledRef.current = false
    setShowJumpBtn(false)
    scrollToBottom(false)
  }, [currentConversationId, scrollToBottom])

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    const next = await filesToAttachments(files)
    setPendingFiles(prev => [...prev, ...next])
  }

  const removeAttachment = (id: string) => {
    setPendingFiles(prev => prev.filter(a => a.id !== id))
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current++
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    addFiles(files)
  }

  const submit = async (content: string, attachments: Attachment[] = []) => {
    const text = content.trim()
    if ((!text && !attachments.length) || isGenerating) return
    setInput('')
    setPendingFiles([])

    let convId = currentConversationId
    if (!convId) {
      convId = createConversation()
      selectConversation(convId)
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    }
    addMessage(convId, userMsg)
    setConversationTitleFromMessage(convId, text || `${attachments.length} file(s) attached`)

    const assistantId = crypto.randomUUID()
    addMessage(convId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    })

    setIsGenerating(true)
    userScrolledRef.current = false
    abortRef.current = new AbortController()

    const currentConv = useChatStore.getState().conversations.find(c => c.id === convId)
    const apiMessages = (currentConv?.messages ?? [])
      .filter(m => m.id !== assistantId && !m.isStreaming)
      .map(m => ({
        role: m.role,
        content: m.attachments?.length
          ? `${m.content}\n\n[User attached ${m.attachments.length} file(s): ${m.attachments.map(a => a.name).join(', ')}]`
          : m.content,
      }))

    try {
      await sendMessageStream(
        apiMessages,
        (delta) => {
          appendMessageContent(convId!, assistantId, delta)
          if (!userScrolledRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'instant' })
          }
        },
        abortRef.current.signal
      )
      finalizeMessage(convId!, assistantId)
    } catch (err: unknown) {
      const error = err as Error
      if (error.name === 'AbortError') {
        finalizeMessage(convId!, assistantId)
      } else {
        setMessageError(convId!, assistantId, error.message || 'Failed to get response.')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const stopGeneration = () => {
    abortRef.current?.abort()
    setIsGenerating(false)
    if (currentConversationId) {
      const conv = useChatStore.getState().conversations.find(c => c.id === currentConversationId)
      const streaming = conv?.messages.find(m => m.isStreaming)
      if (streaming) finalizeMessage(currentConversationId, streaming.id)
    }
  }

  const regenerate = useCallback(async () => {
    if (!currentConversationId || isGenerating) return
    const conv = useChatStore.getState().conversations.find(c => c.id === currentConversationId)
    if (!conv) return

    const msgs = conv.messages
    const lastUser = [...msgs].reverse().find(m => m.role === 'user')
    if (!lastUser) return

    // Remove last assistant message
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
    if (lastAssistant) {
      useChatStore.setState(s => ({
        conversations: s.conversations.map(c =>
          c.id === currentConversationId
            ? { ...c, messages: c.messages.filter(m => m.id !== lastAssistant.id) }
            : c
        ),
      }))
    }

    await submit(lastUser.content, lastUser.attachments ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversationId, isGenerating])

  return (
    <div
      className="chat-area"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-message">Drop files to attach</div>
        </div>
      )}
      {messages.length === 0 ? (
        <EmptyState onPrompt={p => { setInput(p); setTimeout(() => submit(p), 0) }} />
      ) : (
        <div className="messages-container" ref={scrollRef} onScroll={handleScroll}>
          <div className="messages-inner">
            {messages.map((msg, i) => (
              <MessageComponent
                key={msg.id}
                message={msg}
                conversationId={currentConversationId!}
                isLast={i === messages.length - 1}
                onRegenerate={i === messages.length - 1 ? regenerate : undefined}
              />
            ))}
          </div>
          <div ref={bottomRef} />
        </div>
      )}

      {showJumpBtn && (
        <button
          className={`jump-to-bottom ${hasNewMessage ? 'has-new' : ''}`}
          onClick={() => { scrollToBottom(); userScrolledRef.current = false; setShowJumpBtn(false); setHasNewMessage(false) }}
        >
          <ChevronDown size={14} /> {hasNewMessage ? 'New message' : 'Jump to bottom'}
        </button>
      )}

      <InputComposer
        value={input}
        onChange={setInput}
        onSend={() => submit(input, pendingFiles)}
        onStop={stopGeneration}
        isGenerating={isGenerating}
        disabled={!isOnline}
        attachments={pendingFiles}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
      />
    </div>
  )
}
