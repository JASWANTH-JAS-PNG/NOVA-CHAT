import { useState, useRef, useEffect } from 'react'
import {
  Plus, Search, Pin, Pencil, Trash2, ChevronLeft, ChevronRight, Check, X,
} from 'lucide-react'
import { useChatStore } from '../store/chatStore'
import { groupConversationsByDate } from '../utils/helpers'
import type { Conversation } from '../types'

interface Props {
  onMobileClose: () => void
}

export default function Sidebar({ onMobileClose }: Props) {
  const {
    conversations, currentConversationId, sidebarCollapsed,
    selectConversation, deleteConversation, pinConversation,
    updateConversationTitle, toggleSidebar, searchQuery, setSearchQuery,
  } = useChatStore()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleNewChat = () => {
    selectConversation(null)
    onMobileClose()
  }

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id)
    setRenameVal(conv.title)
  }

  const submitRename = (id: string) => {
    if (renameVal.trim()) updateConversationTitle(id, renameVal.trim())
    setRenamingId(null)
  }

  const filtered = searchQuery
    ? conversations.filter(
        c =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : conversations

  const groups = groupConversationsByDate(filtered)

  if (sidebarCollapsed) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'12px 0', gap:'8px', height:'100%' }}>
        <button className="icon-btn" onClick={toggleSidebar} title="Expand sidebar">
          <ChevronRight size={17} className="icon-morph" />
        </button>
        <button className="icon-btn" onClick={handleNewChat} title="New chat">
          <Plus size={17} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* Logo + collapse */}
      <div style={{ padding:'14px 12px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
          <div style={{
            width:30, height:30, borderRadius:9,
            background:'var(--accent-gradient)',
            boxShadow:'var(--glow-accent)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontWeight:700, fontSize:14, color:'#fff',
          }}>N</div>
          <span style={{ fontWeight:600, fontSize:15, color:'var(--text-primary)', letterSpacing:'-0.01em' }}>NovaChat</span>
        </div>
        <button className="icon-btn" onClick={toggleSidebar} title="Collapse sidebar">
          <ChevronLeft size={16} className="icon-morph" />
        </button>
      </div>

      {/* New Chat */}
      <div style={{ padding:'0 10px 10px', flexShrink:0 }}>
        <button className="primary-btn" style={{ width:'100%', justifyContent:'center' }} onClick={handleNewChat}>
          <Plus size={15} /> New Chat
        </button>
      </div>

      {/* Search */}
      <div style={{ padding:'0 10px 10px', flexShrink:0 }}>
        <div style={{
          display:'flex', alignItems:'center', gap:'8px',
          background:'var(--bg-elevated)', border:'1px solid var(--border)',
          borderRadius:'var(--radius-md)', padding:'7px 12px',
        }}>
          <Search size={13} style={{ color:'var(--text-muted)', flexShrink:0 }} />
          <input
            type="text"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              background:'none', border:'none', outline:'none',
              color:'var(--text-primary)', fontSize:'13px', width:'100%',
            }}
          />
          {searchQuery && (
            <button className="icon-btn" style={{ padding:2 }} onClick={() => setSearchQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 8px' }}>
        {Object.entries(groups).map(([group, convs]) => (
          <div key={group} style={{ marginBottom:'6px' }}>
            <div style={{
              padding:'4px 8px', fontSize:'10px', fontWeight:700,
              color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em',
              marginBottom:'2px',
            }}>{group}</div>
            {convs.map((conv, index) =>
              renamingId === conv.id ? (
                <RenameInput
                  key={conv.id}
                  value={renameVal}
                  onChange={setRenameVal}
                  onSubmit={() => submitRename(conv.id)}
                  onCancel={() => setRenamingId(null)}
                />
              ) : deleteId === conv.id ? (
                <DeleteConfirm
                  key={conv.id}
                  title={conv.title}
                  onConfirm={() => { deleteConversation(conv.id); setDeleteId(null) }}
                  onCancel={() => setDeleteId(null)}
                />
              ) : (
                <ConvItem
                  key={conv.id}
                  index={index}
                  conv={conv}
                  isActive={conv.id === currentConversationId}
                  onSelect={() => { selectConversation(conv.id); onMobileClose() }}
                  onRename={() => startRename(conv)}
                  onPin={() => pinConversation(conv.id)}
                  onDelete={() => setDeleteId(conv.id)}
                />
              )
            )}
          </div>
        ))}

        {conversations.length === 0 && (
          <div style={{ padding:'32px 8px', textAlign:'center', color:'var(--text-muted)', fontSize:'13px' }}>
            No conversations yet.<br />Start a new chat!
          </div>
        )}
      </div>
    </div>
  )
}

function ConvItem({ conv, index, isActive, onSelect, onRename, onPin, onDelete }: {
  conv: Conversation
  index: number
  isActive: boolean
  onSelect: () => void
  onRename: () => void
  onPin: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`conv-item ${isActive ? 'active' : ''}`}
      style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
      onClick={onSelect}
    >
      <span style={{
        fontSize:'13.5px', color:'var(--text-primary)', flex:1,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
      }}>
        {conv.pinned && <Pin size={11} style={{ display:'inline', marginRight:5, color:'var(--accent)' }} />}
        {conv.title}
      </span>
      <div className="conv-actions" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" style={{ padding:4 }} title={conv.pinned ? 'Unpin' : 'Pin'} onClick={onPin}>
          <Pin size={13} style={{ color: conv.pinned ? 'var(--accent)' : undefined }} />
        </button>
        <button className="icon-btn" style={{ padding:4 }} title="Rename" onClick={onRename}>
          <Pencil size={13} />
        </button>
        <button className="icon-btn" style={{ padding:4, color:'var(--danger)' }} title="Delete" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function RenameInput({ value, onChange, onSubmit, onCancel }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <div style={{ padding:'4px 6px', display:'flex', gap:'4px', alignItems:'center' }}>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel() }}
        style={{
          flex:1, background:'var(--bg-elevated)', border:'1px solid var(--accent)',
          borderRadius:'8px', padding:'5px 9px', color:'var(--text-primary)',
          fontSize:'13px', outline:'none',
        }}
      />
      <button className="icon-btn" style={{ padding:4, color:'var(--accent)' }} onClick={onSubmit}><Check size={13} /></button>
      <button className="icon-btn" style={{ padding:4 }} onClick={onCancel}><X size={13} /></button>
    </div>
  )
}

function DeleteConfirm({ title, onConfirm, onCancel }: {
  title: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div style={{
      margin:'2px 0', padding:'10px 12px', background:'var(--bg-elevated)',
      borderRadius:'var(--radius-md)', border:'1px solid rgba(255,92,92,0.3)',
    }}>
      <div style={{ fontSize:'12px', color:'var(--text-muted)', marginBottom:'8px' }}>
        Delete "<span style={{ color:'var(--text-primary)' }}>{title}</span>"?
      </div>
      <div style={{ display:'flex', gap:'6px' }}>
        <button onClick={onConfirm} style={{
          flex:1, background:'var(--danger)', color:'#fff', border:'none',
          borderRadius:'6px', padding:'5px', fontSize:'12px', cursor:'pointer',
        }}>Delete</button>
        <button onClick={onCancel} style={{
          flex:1, background:'var(--bg-surface)', color:'var(--text-primary)', border:'1px solid var(--border)',
          borderRadius:'6px', padding:'5px', fontSize:'12px', cursor:'pointer',
        }}>Cancel</button>
      </div>
    </div>
  )
}
