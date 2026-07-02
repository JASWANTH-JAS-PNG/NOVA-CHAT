import { useRef, useEffect, type KeyboardEvent } from 'react'
import { ArrowUp, Square, Mic, Paperclip } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  isGenerating: boolean
  disabled?: boolean
}

export default function InputComposer({ value, onChange, onSend, onStop, isGenerating, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 8 * 24 // ~8 lines
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
  }, [value])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isGenerating && value.trim()) onSend()
    }
  }

  return (
    <div className="input-area">
      <div className="input-composer">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder="Message NovaChat… (Enter to send, Shift+Enter for newline)"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled}
          rows={1}
        />
        <div className="input-actions">
          <div style={{ display:'flex', gap:'4px' }}>
            <button className="icon-btn" title="Attach file" disabled>
              <Paperclip size={16} />
            </button>
            <button className="icon-btn" title="Voice input" disabled>
              <Mic size={16} />
            </button>
          </div>
          {isGenerating ? (
            <button className="stop-btn" onClick={onStop} title="Stop generating">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={onSend}
              disabled={!value.trim() || disabled}
              title="Send message"
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
