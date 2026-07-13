import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useChatStore } from './store/chatStore'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import ChatArea from './components/ChatArea'

export default function App() {
  const { theme, selectConversation, sidebarCollapsed } = useChatStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isOnline = useOnlineStatus()

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
    <div className={`app-root ${theme}`}>
      {!isOnline && (
        <div className="offline-banner" role="status">
          <WifiOff size={14} aria-hidden="true" />
          You're offline — messages can't be sent until your connection is restored.
        </div>
      )}
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
