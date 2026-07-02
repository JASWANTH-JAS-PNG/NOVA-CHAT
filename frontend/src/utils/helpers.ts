import type { Conversation } from '../types';

export function groupConversationsByDate(
  conversations: Conversation[]
): Record<string, Conversation[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const sevenDaysAgo = today - 7 * 86400000;
  const thirtyDaysAgo = today - 30 * 86400000;

  const groups: Record<string, Conversation[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    'Previous 30 Days': [],
    Older: [],
  };

  const sorted = [...conversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  for (const conv of sorted) {
    if (conv.pinned) {
      groups['Pinned'].push(conv);
      continue;
    }
    const t = conv.updatedAt;
    if (t >= today) groups['Today'].push(conv);
    else if (t >= yesterday) groups['Yesterday'].push(conv);
    else if (t >= sevenDaysAgo) groups['Previous 7 Days'].push(conv);
    else if (t >= thirtyDaysAgo) groups['Previous 30 Days'].push(conv);
    else groups['Older'].push(conv);
  }

  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0));
}

export function generateTitle(content: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  return cleaned.length > 50 ? cleaned.slice(0, 47) + '...' : cleaned;
}
