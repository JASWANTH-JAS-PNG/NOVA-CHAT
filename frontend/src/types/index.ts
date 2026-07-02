export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  hasError?: boolean;
  feedback?: 'up' | 'down';
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  model: string;
}

export interface Model {
  id: string;
  name: string;
  description: string;
  badge: 'Fast' | 'Balanced' | 'Deep';
}

export const MODELS: Model[] = [
  { id: 'claude-sonnet-4-6', name: 'Nova', description: 'Balanced speed & quality', badge: 'Balanced' },
  { id: 'claude-haiku-4-5', name: 'Nova Flash', description: 'Fastest responses', badge: 'Fast' },
  { id: 'claude-opus-4-8', name: 'Nova Deep', description: 'Maximum reasoning', badge: 'Deep' },
];

export const SUGGESTED_PROMPTS = [
  'Explain quantum computing in simple terms',
  'Write a Python script to scrape a website',
  'What are the best practices for React performance?',
  'Help me debug this TypeScript error',
  'Write a cover letter for a software engineer role',
  'Summarize the key ideas of stoicism',
];
