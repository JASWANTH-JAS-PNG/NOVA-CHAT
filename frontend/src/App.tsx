import { useEffect, useState } from 'react'
import { useChatStore } from './store/chatStore'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import ChatArea from './components/ChatArea'

export default function App() {
  const { theme, selectConversation, sidebarCollapsed } = useChatStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        selectConversation(null)
      }
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectConversation])

  return (
    <div className="app-root">
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}
      <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <Sidebar onMobileClose={() => setMobileOpen(false)} />
      </div>
      <div className="main-area">
        <Header onMobileMenuOpen={() => setMobileOpen(true)} />
        <ChatArea />
      </div>
    </div>
  )
}
