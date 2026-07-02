import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Sun, Moon, Menu, Zap } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { MODELS } from '../types'

interface Props {
  onMobileMenuOpen: () => void
}

export default function Header({ onMobileMenuOpen }: Props) {
  const { selectedModel, setSelectedModel, toggleTheme, theme, sidebarCollapsed } = useChatStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = MODELS.find(m => m.id === selectedModel) ?? MODELS[0]

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="header">
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        {/* mobile menu or sidebar collapsed indicator */}
        <button
          className="icon-btn"
          onClick={onMobileMenuOpen}
          style={{ display: sidebarCollapsed ? 'flex' : 'none' }}
        >
          <Menu size={18} />
        </button>
        <button className="icon-btn" onClick={onMobileMenuOpen} style={{ display:'none' }}
          // shown only on mobile via CSS but let's handle through sidebar logic
        />

        {/* Model Selector */}
        <div className="model-selector" ref={ref}>
          <button className="model-btn" onClick={() => setOpen(o => !o)}>
            <Zap size={14} style={{ color:'var(--accent)' }} />
            <span style={{ fontWeight:500 }}>{current.name}</span>
            <BadgeTag badge={current.badge} />
            <ChevronDown size={14} style={{ color:'var(--text-muted)', marginLeft:2 }} />
          </button>

          {open && (
            <div className="model-dropdown">
              {MODELS.map(m => (
                <div
                  key={m.id}
                  className={`model-option ${m.id === selectedModel ? 'active' : ''}`}
                  onClick={() => { setSelectedModel(m.id); setOpen(false) }}
                >
                  <div>
                    <div style={{ fontSize:'14px', fontWeight:500, color:'var(--text-primary)' }}>{m.name}</div>
                    <div style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:1 }}>{m.description}</div>
                  </div>
                  <BadgeTag badge={m.badge} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </div>
  )
}

function BadgeTag({ badge }: { badge: 'Fast' | 'Balanced' | 'Deep' }) {
  const cls = badge === 'Fast' ? 'badge-fast' : badge === 'Deep' ? 'badge-deep' : 'badge-balanced'
  return <span className={`badge ${cls}`}>{badge}</span>
}
