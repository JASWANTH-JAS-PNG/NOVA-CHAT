import { Component } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.error('NovaChat crashed:', error)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crash-screen" role="alert">
          <AlertTriangle size={40} style={{ color: 'var(--danger)' }} aria-hidden="true" />
          <h1>Something went wrong</h1>
          <p>NovaChat hit an unexpected error. Your conversations are safe and were not lost.</p>
          <button className="primary-btn" onClick={this.handleReload}>
            Reload NovaChat
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
