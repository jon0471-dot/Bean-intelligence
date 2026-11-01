/**
 * RIISHE — conversation list view logic (pure, shared by server and client).
 *
 * Kept free of React and database imports so both the API routes and the UI
 * consume the exact same semantics (and the unit tests pin them once).
 */

export interface ConversationListItem {
  id: string
  title: string
  messages: number
  updatedAt: string
}

/** Maximum length of a user-chosen conversation title (server-enforced). */
export const CONVERSATION_TITLE_MAX = 120

/**
 * Sanitize a user-supplied conversation title: trim, collapse internal
 * whitespace, cap length. An empty result falls back (rename must never be
 * able to blank a title — the sidebar would render an unusable zero-height
 * row and search could never find the conversation again).
 */
export function sanitizeConversationTitle(input: string, fallback = 'New conversation'): string {
  const cleaned = input.replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return fallback
  if (cleaned.length <= CONVERSATION_TITLE_MAX) return cleaned
  return cleaned.slice(0, CONVERSATION_TITLE_MAX - 1).trimEnd() + '…'
}

/**
 * Case-insensitive title search. Implemented in JS (not SQL LIKE) because
 * SQLite's LIKE is case-insensitive only for ASCII — the app's users search
 * in every script, and a search that misses "हिंदी" or "中文" rows because of
 * collation would be a silent correctness bug. Empty/whitespace queries
 * return the list unchanged (the caller then renders the normal recents).
 */
export function filterConversationsByTitle<T extends ConversationListItem>(
  conversations: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return conversations
  return conversations.filter((c) => c.title.toLowerCase().includes(q))
}

export interface ConversationGroups {
  today: ConversationListItem[]
  yesterday: ConversationListItem[]
  previous7Days: ConversationListItem[]
  previous30Days: ConversationListItem[]
  older: ConversationListItem[]
}

function startOfDay(d: Date): number {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/**
 * ChatGPT-style date buckets for the sidebar history. Bucket boundaries are
 * computed against LOCAL calendar days (not fixed 24h windows): a message at
 * 11pm yesterday must appear under "Yesterday" even if it is 1am now.
 */
export function groupConversationsByDate<T extends ConversationListItem>(
  conversations: T[],
  now: Date = new Date(),
): { today: T[]; yesterday: T[]; previous7Days: T[]; previous30Days: T[]; older: T[] } {
  const todayStart = startOfDay(now)
  const DAY = 24 * 60 * 60 * 1000
  const groups: { today: T[]; yesterday: T[]; previous7Days: T[]; previous30Days: T[]; older: T[] } = {
    today: [],
    yesterday: [],
    previous7Days: [],
    previous30Days: [],
    older: [],
  }
  for (const c of conversations) {
    const t = startOfDay(new Date(c.updatedAt))
    if (t >= todayStart) groups.today.push(c)
    else if (t >= todayStart - DAY) groups.yesterday.push(c)
    else if (t >= todayStart - 7 * DAY) groups.previous7Days.push(c)
    else if (t >= todayStart - 30 * DAY) groups.previous30Days.push(c)
    else groups.older.push(c)
  }
  return groups
}

/** Ordered sidebar sections: label + the conversations in that bucket. */
export function conversationSidebarSections<T extends ConversationListItem>(
  conversations: T[],
  now: Date = new Date(),
): Array<{ label: string; items: T[] }> {
  const g = groupConversationsByDate(conversations, now)
  return [
    { label: 'Today', items: g.today },
    { label: 'Yesterday', items: g.yesterday },
    { label: 'Previous 7 days', items: g.previous7Days },
    { label: 'Previous 30 days', items: g.previous30Days },
    { label: 'Older', items: g.older },
  ].filter((s) => s.items.length > 0)
}
