import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { sendMessage } from '../utils/api'
import type { Message } from '../types'
import MessageComponent from './Message'
import InputComposer from './InputComposer'
import EmptyState from './EmptyState'

export default function ChatArea() {
  const {
    currentConversationId, createConversation, selectConversation,
    addMessage, updateMessageContent, finalizeMessage, setMessageError,
    setConversationTitleFromMessage, getCurrentConversation,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const streamStopRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  const conv = getCurrentConversation()
  const messages = conv?.messages ?? []

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    if (!userScrolledRef.current) scrollToBottom(false)
  }, [messages, scrollToBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowJumpBtn(!nearBottom)
    userScrolledRef.current = !nearBottom
  }

  // Reset scroll tracking on conversation change
  useEffect(() => {
    userScrolledRef.current = false
    setShowJumpBtn(false)
    scrollToBottom(false)
  }, [currentConversationId, scrollToBottom])

  const fakeStream = async (convId: string, msgId: string, text: string) => {
    streamStopRef.current = false
    const chunkSize = 5
    let i = 0
    while (i < text.length && !streamStopRef.current) {
      const end = Math.min(i + chunkSize, text.length)
      updateMessageContent(convId, msgId, text.slice(0, end))
      i = end
      if (!userScrolledRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      }
      await new Promise(r => setTimeout(r, 18))
    }
    if (!streamStopRef.current) {
      updateMessageContent(convId, msgId, text)
    }
    finalizeMessage(convId, msgId)
  }

  const submit = async (content: string) => {
    const text = content.trim()
    if (!text || isGenerating) return
    setInput('')

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
    }
    addMessage(convId, userMsg)
    setConversationTitleFromMessage(convId, text)

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
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const reply = await sendMessage(apiMessages, abortRef.current.signal)
      await fakeStream(convId!, assistantId, reply)
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
    streamStopRef.current = true
    abortRef.current?.abort()
    setIsGenerating(false)
    if (currentConversationId) {
      const conv = useChatStore.getState().conversations.find(c => c.id === currentConversationId)
      const streaming = conv?.messages.find(m => m.isStreaming)
      if (streaming) finalizeMessage(currentConversationId, streaming.id)
    }
  }

  const regenerate = async () => {
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

    await submit(lastUser.content)
  }

  return (
    <div className="chat-area">
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
        <button className="jump-to-bottom" onClick={() => { scrollToBottom(); userScrolledRef.current = false; setShowJumpBtn(false) }}>
          <ChevronDown size={14} /> Jump to bottom
        </button>
      )}

      <InputComposer
        value={input}
        onChange={setInput}
        onSend={() => submit(input)}
        onStop={stopGeneration}
        isGenerating={isGenerating}
      />
    </div>
  )
}
