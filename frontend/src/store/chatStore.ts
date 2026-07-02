import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Conversation, Message } from '../types';
import { generateTitle } from '../utils/helpers';

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  sidebarCollapsed: boolean;
  selectedModel: string;
  searchQuery: string;
  theme: 'dark' | 'light';

  createConversation: () => string;
  selectConversation: (id: string | null) => void;
  addMessage: (convId: string, message: Message) => void;
  updateMessageContent: (convId: string, msgId: string, content: string) => void;
  finalizeMessage: (convId: string, msgId: string) => void;
  setMessageError: (convId: string, msgId: string, text?: string) => void;
  setMessageFeedback: (convId: string, msgId: string, feedback: 'up' | 'down') => void;
  setConversationTitleFromMessage: (convId: string, content: string) => void;
  updateConversationTitle: (convId: string, title: string) => void;
  deleteConversation: (convId: string) => void;
  pinConversation: (convId: string) => void;
  clearAllConversations: () => void;
  toggleSidebar: () => void;
  setSelectedModel: (model: string) => void;
  setSearchQuery: (q: string) => void;
  toggleTheme: () => void;
  getCurrentConversation: () => Conversation | undefined;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      currentConversationId: null,
      sidebarCollapsed: false,
      selectedModel: 'claude-sonnet-4-6',
      searchQuery: '',
      theme: 'dark',

      createConversation: () => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const conv: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: now,
          updatedAt: now,
          pinned: false,
          model: get().selectedModel,
        };
        set(s => ({ conversations: [conv, ...s.conversations] }));
        return id;
      },

      selectConversation: (id) => set({ currentConversationId: id }),

      addMessage: (convId, message) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
              : c
          ),
        })),

      updateMessageContent: (convId, msgId, content) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === msgId ? { ...m, content, isStreaming: true } : m
                  ),
                }
              : c
          ),
        })),

      finalizeMessage: (convId, msgId) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === msgId ? { ...m, isStreaming: false } : m
                  ),
                }
              : c
          ),
        })),

      setMessageError: (convId, msgId, text = 'Something went wrong. Please try again.') =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === msgId
                      ? { ...m, isStreaming: false, hasError: true, content: text }
                      : m
                  ),
                }
              : c
          ),
        })),

      setMessageFeedback: (convId, msgId, feedback) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === msgId ? { ...m, feedback } : m
                  ),
                }
              : c
          ),
        })),

      setConversationTitleFromMessage: (convId, content) => {
        const conv = get().conversations.find(c => c.id === convId);
        if (conv && conv.title === 'New Chat') {
          get().updateConversationTitle(convId, generateTitle(content));
        }
      },

      updateConversationTitle: (convId, title) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId ? { ...c, title } : c
          ),
        })),

      deleteConversation: (convId) => {
        const { currentConversationId, conversations } = get();
        const remaining = conversations.filter(c => c.id !== convId);
        set({
          conversations: remaining,
          currentConversationId:
            currentConversationId === convId ? remaining[0]?.id ?? null : currentConversationId,
        });
      },

      pinConversation: (convId) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId ? { ...c, pinned: !c.pinned } : c
          ),
        })),

      clearAllConversations: () => set({ conversations: [], currentConversationId: null }),

      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      setSelectedModel: (model) => set({ selectedModel: model }),

      setSearchQuery: (q) => set({ searchQuery: q }),

      toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      getCurrentConversation: () => {
        const { conversations, currentConversationId } = get();
        return conversations.find(c => c.id === currentConversationId);
      },
    }),
    {
      name: 'novachat-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
