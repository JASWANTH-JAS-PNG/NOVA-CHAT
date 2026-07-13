import { SUGGESTED_PROMPTS } from '../types'

interface Props {
  onPrompt: (prompt: string) => void
}

export default function EmptyState({ onPrompt }: Props) {
  return (
    <div className="empty-state">
      <div style={{ textAlign:'center', animation: 'message-enter-spring 500ms var(--ease-spring) backwards' }}>
        <div className="empty-logo" style={{ margin:'0 auto 16px' }}>N</div>
        <h1 style={{ fontSize:'22px', fontWeight:700, letterSpacing:'-0.02em', color:'var(--text-primary)', margin:'0 0 8px' }}>
          How can I help you today?
        </h1>
        <p style={{ color:'var(--text-muted)', fontSize:'14px' }}>
          Ask me anything — I'm here to help.
        </p>
      </div>

      <div className="prompt-chips">
        {SUGGESTED_PROMPTS.map((prompt, i) => (
          <button
            key={prompt}
            className="prompt-chip"
            style={{ '--i': i } as React.CSSProperties}
            onClick={() => onPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
