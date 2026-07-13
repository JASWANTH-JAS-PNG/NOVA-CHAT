import { memo, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Copy, ThumbsUp, ThumbsDown, RotateCcw, Check, AlertCircle, FileText } from 'lucide-react'
import type { Message as IMessage } from '../types'
import { useChatStore } from '../store/chatStore'

interface Props {
  message: IMessage
  conversationId: string
  isLast: boolean
  onRegenerate?: () => void
}

function Message({ message, conversationId, isLast, onRegenerate }: Props) {
  const { setMessageFeedback } = useChatStore()
  const [copied, setCopied] = useState(false)

  const copyMessage = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (message.role === 'user') {
    return (
      <div className="message-wrapper user message-enter">
        <div className="message-bubble-user">
          {message.attachments && message.attachments.length > 0 && (
            <div className="attachment-row sent">
              {message.attachments.map(a => (
                <div key={a.id} className="attachment-chip">
                  {a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="attachment-thumb" />
                  ) : (
                    <FileText size={16} className="attachment-file-icon" />
                  )}
                  <div className="attachment-meta">
                    <span className="attachment-name">{a.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {message.content}
        </div>
        <div className="message-actions" style={{ marginRight:4 }}>
          <button className="icon-btn" style={{ padding:4 }} title="Copy" onClick={copyMessage}>
            {copied ? <Check size={13} className="copy-icon-pop" style={{ color:'var(--accent)' }} /> : <Copy size={13} />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="message-wrapper assistant message-enter">
      <div className="message-assistant-content">
        <div className="assistant-avatar">N</div>
        <div className="message-text">
          {message.hasError ? (
            <div>
              {message.content && (
                <MarkdownContent content={message.content} streaming={false} />
              )}
              <div className="message-error">
                <AlertCircle size={15} />
                {message.errorMessage ?? 'Something went wrong. Please try again.'}
              </div>
              {onRegenerate && (
                <button className="retry-btn" onClick={onRegenerate}>
                  <RotateCcw size={13} /> Retry
                </button>
              )}
            </div>
          ) : message.isStreaming && !message.content ? (
            <div className="typing-dots" aria-label="NovaChat is typing">
              <span /><span /><span />
            </div>
          ) : (
            <MarkdownContent content={message.content} streaming={!!message.isStreaming} />
          )}
        </div>
      </div>

      {!message.isStreaming && !message.hasError && (
        <div className="message-actions" style={{ marginLeft:40 }}>
          <button className="icon-btn" style={{ padding:4 }} title="Copy" onClick={copyMessage}>
            {copied ? <Check size={13} className="copy-icon-pop" style={{ color:'var(--accent)' }} /> : <Copy size={13} />}
          </button>
          <button
            className="icon-btn"
            style={{ padding:4, color: message.feedback === 'up' ? 'var(--accent)' : undefined }}
            title="Good response"
            onClick={() => setMessageFeedback(conversationId, message.id, 'up')}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ padding:4, color: message.feedback === 'down' ? 'var(--danger)' : undefined }}
            title="Bad response"
            onClick={() => setMessageFeedback(conversationId, message.id, 'down')}
          >
            <ThumbsDown size={13} />
          </button>
          {isLast && onRegenerate && (
            <button className="icon-btn" style={{ padding:4 }} title="Regenerate" onClick={onRegenerate}>
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(Message)

function MarkdownContent({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className={`markdown-body ${streaming ? 'streaming-cursor' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            const child = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>
            const lang = /language-(\w+)/.exec(child?.props?.className ?? '')?.[1] ?? ''
            return <CodeBlock language={lang}>{child}</CodeBlock>
          },
          code({ className, children, ...rest }) {
            if (!className) {
              return <code {...rest}>{children}</code>
            }
            return <code className={className} {...rest}>{children}</code>
          },
          a({ href, children, ...rest }) {
            const isSafe = !!href && /^(https?:|mailto:)/i.test(href)
            return (
              <a
                href={isSafe ? href : undefined}
                target={isSafe ? '_blank' : undefined}
                rel={isSafe ? 'noopener noreferrer' : undefined}
                {...rest}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function CodeBlock({ language, children }: { language: string; children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = preRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'code'}</span>
        <button className="code-block-copy" onClick={handleCopy}>
          {copied ? <><Check size={11} className="copy-icon-pop" /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}
