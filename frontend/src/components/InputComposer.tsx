import { useRef, useEffect, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Square, Mic, Paperclip, X, FileText } from 'lucide-react'
import type { Attachment } from '../types'
import { formatFileSize } from '../utils/attachments'

export const MAX_CHARS = 6000

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
  disabled?: boolean
  attachments: Attachment[]
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

const ACCEPTED_TYPES = 'image/*,.pdf,.doc,.docx,.txt,.csv,.json,.md'

export default function InputComposer({
  value, onChange, onSend, onStop, isGenerating, disabled,
  attachments, onAddFiles, onRemoveAttachment,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseValueRef = useRef('')

  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState('')
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

  const speechSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  const overLimit = value.length > MAX_CHARS
  const showCounter = value.length > MAX_CHARS * 0.8

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 6 * 24 // ~6 lines
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
  }, [value])

  useEffect(() => {
    if (!micError) return
    const t = setTimeout(() => setMicError(''), 4000)
    return () => clearTimeout(t)
  }, [micError])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  const canSend = !isGenerating && !disabled && !overLimit && (value.trim().length > 0 || attachments.length > 0)

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imageFiles = items
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((f): f is File => !!f)
    if (imageFiles.length) {
      e.preventDefault()
      onAddFiles(imageFiles)
    }
  }

  const openFilePicker = () => {
    if (disabled || isGenerating) return
    fileInputRef.current?.click()
  }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onAddFiles(files)
  }

  const handleRemoveAttachment = (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id))
    setTimeout(() => {
      onRemoveAttachment(id)
      setRemovingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 150)
  }

  const toggleMic = () => {
    if (disabled || isGenerating || !speechSupported) return

    if (isRecording) {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    baseValueRef.current = value ? value + ' ' : ''

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interimText += result[0].transcript
      }
      if (finalText) baseValueRef.current += finalText + ' '
      onChange(baseValueRef.current + interimText)
    }

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setMicError('Microphone access denied. Allow it in your browser settings.')
      } else if (event.error !== 'aborted') {
        setMicError('Voice input failed. Please try again.')
      }
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  const busy = disabled || isGenerating

  return (
    <div className="input-area">
      <div className="input-composer">
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map(a => (
              <div
                key={a.id}
                className={`attachment-chip ${removingIds.has(a.id) ? 'chip-removing' : ''}`}
              >
                {a.dataUrl ? (
                  <img src={a.dataUrl} alt={a.name} className="attachment-thumb" />
                ) : (
                  <FileText size={16} className="attachment-file-icon" />
                )}
                <div className="attachment-meta">
                  <span className="attachment-name">{a.name}</span>
                  <span className="attachment-size">{formatFileSize(a.size)}</span>
                </div>
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => handleRemoveAttachment(a.id)}
                  title="Remove"
                  aria-label={`Remove attachment ${a.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder="Message NovaChat… (Enter to send, Shift+Enter for newline)"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          disabled={disabled}
          rows={1}
          aria-label="Message NovaChat"
        />

        {micError && <div className="mic-error" role="alert">{micError}</div>}
        {showCounter && (
          <div className={`char-counter ${overLimit ? 'over' : ''}`}>
            {value.length} / {MAX_CHARS}
          </div>
        )}

        <div className="input-actions">
          <div style={{ display:'flex', gap:'4px' }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              style={{ display: 'none' }}
              onChange={handleFilesSelected}
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              className="icon-btn"
              title="Attach file"
              aria-label="Attach file"
              onClick={openFilePicker}
              disabled={busy}
            >
              <Paperclip size={16} />
            </button>
            <button
              className={`icon-btn ${isRecording ? 'mic-recording' : ''}`}
              title={speechSupported ? (isRecording ? 'Stop recording' : 'Voice input') : 'Voice input not supported in this browser'}
              aria-label={isRecording ? 'Stop voice input recording' : 'Start voice input'}
              aria-pressed={isRecording}
              onClick={toggleMic}
              disabled={busy || !speechSupported}
            >
              <Mic size={16} />
            </button>
          </div>
          {isGenerating ? (
            <button className="stop-btn" onClick={onStop} title="Stop generating" aria-label="Stop generating response">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={onSend}
              disabled={!canSend}
              title="Send message"
              aria-label="Send message"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <div style={{ textAlign:'center', fontSize:'11px', color:'var(--text-muted)', marginTop:'8px' }}>
        NovaChat can make mistakes. Verify important information.
      </div>
    </div>
  )
}
