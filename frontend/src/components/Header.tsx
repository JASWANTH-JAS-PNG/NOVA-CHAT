import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Sun, Moon, Menu, Zap, Sparkles, Check } from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { MODELS, THEMES } from '../types'
import type { Theme } from '../types'

interface Props {
  onMobileMenuOpen: () => void
}

const THEME_ICONS: Record<Theme, typeof Sun> = {
  dark: Moon,
  light: Sun,
  'glass-dark': Sparkles,
  'glass-light': Sparkles,
}

interface DropdownPos {
  top: number
  left?: number
  right?: number
}

function useDropdownPortal(triggerRef: React.RefObject<HTMLElement | null>, open: boolean) {
  const [pos, setPos] = useState<DropdownPos | null>(null)

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 6,
      left: rect.left,
      right: window.innerWidth - rect.right,
    })
  }, [open, triggerRef])

  return pos
}

export default function Header({ onMobileMenuOpen }: Props) {
  const { selectedModel, setSelectedModel, setTheme, theme, sidebarCollapsed } = useChatStore()
  const [open, setOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)

  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const modelPanelRef = useRef<HTMLDivElement>(null)
  const themeBtnRef = useRef<HTMLButtonElement>(null)
  const themePanelRef = useRef<HTMLDivElement>(null)

  const current = MODELS.find(m => m.id === selectedModel) ?? MODELS[0]
  const currentTheme = THEMES.find(t => t.id === theme) ?? THEMES[0]
  const CurrentThemeIcon = THEME_ICONS[theme]

  const modelPos = useDropdownPortal(modelBtnRef, open)
  const themePos = useDropdownPortal(themeBtnRef, themeOpen)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      const insideModel = modelBtnRef.current?.contains(t) || modelPanelRef.current?.contains(t)
      const insideTheme = themeBtnRef.current?.contains(t) || themePanelRef.current?.contains(t)
      if (!insideModel) setOpen(false)
      if (!insideTheme) setThemeOpen(false)
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
        <div className="model-selector">
          <button className="model-btn" ref={modelBtnRef} onClick={() => setOpen(o => !o)}>
            <Zap size={14} style={{ color:'var(--accent)' }} />
            <span style={{ fontWeight:500 }}>{current.name}</span>
            <BadgeTag badge={current.badge} />
            <ChevronDown size={14} style={{ color:'var(--text-muted)', marginLeft:2 }} />
          </button>

          {open && modelPos && createPortal(
            <div
              className="model-dropdown dropdown-portal"
              ref={modelPanelRef}
              style={{ top: modelPos.top, left: modelPos.left }}
            >
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
            </div>,
            document.body
          )}
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
        <div className="theme-selector">
          <button className="icon-btn" ref={themeBtnRef} onClick={() => setThemeOpen(o => !o)} title={currentTheme.name}>
            <CurrentThemeIcon key={theme} size={17} className="icon-morph" />
          </button>

          {themeOpen && themePos && createPortal(
            <div
              className="model-dropdown dropdown-portal theme-dropdown"
              ref={themePanelRef}
              style={{ top: themePos.top, right: themePos.right }}
            >
              {THEMES.map(t => {
                const Icon = THEME_ICONS[t.id]
                return (
                  <div
                    key={t.id}
                    className={`model-option ${t.id === theme ? 'active' : ''}`}
                    onClick={() => { setTheme(t.id); setThemeOpen(false) }}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <Icon size={15} style={{ color:'var(--accent)' }} />
                      <div>
                        <div style={{ fontSize:'14px', fontWeight:500, color:'var(--text-primary)' }}>{t.name}</div>
                        <div style={{ fontSize:'12px', color:'var(--text-muted)', marginTop:1 }}>{t.description}</div>
                      </div>
                    </div>
                    {t.id === theme && <Check size={14} style={{ color:'var(--accent)' }} />}
                  </div>
                )
              })}
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  )
}

function BadgeTag({ badge }: { badge: 'Fast' | 'Balanced' | 'Deep' }) {
  const cls = badge === 'Fast' ? 'badge-fast' : badge === 'Deep' ? 'badge-deep' : 'badge-balanced'
  return <span className={`badge ${cls}`}>{badge}</span>
}
