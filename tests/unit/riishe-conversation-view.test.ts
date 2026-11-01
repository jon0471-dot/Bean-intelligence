/**
 * BEAN Intelligence — RIISHE conversation list view logic tests.
 *
 * Pins the pure helpers shared by the sidebar UI and the API routes:
 *  1. Title sanitization (rename must never blank a title, must collapse
 *     whitespace, must cap length with an honest ellipsis).
 *  2. Case-insensitive title search that works beyond ASCII (SQLite LIKE is
 *     ASCII-only case-aware; the JS filter is what the endpoint ships).
 *  3. ChatGPT-style date buckets computed against LOCAL calendar days —
 *     fixed 24h windows would put "11pm yesterday" into the wrong bucket.
 */
import { describe, test, expect } from 'bun:test'

import {
  sanitizeConversationTitle,
  filterConversationsByTitle,
  conversationSidebarSections,
  CONVERSATION_TITLE_MAX,
} from '../../src/lib/riishe/conversation-view'
import type { ConversationListItem } from '../../src/lib/riishe/conversation-view'

function conv(id: string, title: string, updatedAt: Date): ConversationListItem {
  return { id, title, messages: 1, updatedAt: updatedAt.toISOString() }
}

describe('sanitizeConversationTitle', () => {
  test('trims and collapses internal whitespace', () => {
    expect(sanitizeConversationTitle('  Hello   world  ')).toBe('Hello world')
    expect(sanitizeConversationTitle('a\n\tb')).toBe('a b')
  })

  test('never blanks a title — falls back when empty', () => {
    expect(sanitizeConversationTitle('   ')).toBe('New conversation')
    expect(sanitizeConversationTitle('', 'Kept title')).toBe('Kept title')
  })

  test('caps length with an ellipsis instead of silent truncation', () => {
    const long = 'x'.repeat(CONVERSATION_TITLE_MAX + 50)
    const out = sanitizeConversationTitle(long)
    expect(out.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX)
    expect(out.endsWith('…')).toBe(true)
    // Exactly at the cap: unchanged, no ellipsis
    expect(sanitizeConversationTitle('y'.repeat(CONVERSATION_TITLE_MAX))).toBe('y'.repeat(CONVERSATION_TITLE_MAX))
  })

  test('unicode titles are preserved, not mangled', () => {
    expect(sanitizeConversationTitle('  भारत की राजधानी ')).toBe('भारत की राजधानी')
    expect(sanitizeConversationTitle('中文会话')).toBe('中文会话')
  })
})

describe('filterConversationsByTitle', () => {
  const list = [
    conv('1', 'Gingee fort history', new Date('2026-11-01T10:00:00Z')),
    conv('2', 'QUARTZ revenue model', new Date('2026-11-01T09:00:00Z')),
    conv('3', 'भारत की राजधानी', new Date('2026-10-20T09:00:00Z')),
  ]

  test('empty or whitespace query returns the list unchanged', () => {
    expect(filterConversationsByTitle(list, '')).toHaveLength(3)
    expect(filterConversationsByTitle(list, '   ')).toHaveLength(3)
  })

  test('case-insensitive ASCII match', () => {
    expect(filterConversationsByTitle(list, 'quartz').map((c) => c.id)).toEqual(['2'])
    expect(filterConversationsByTitle(list, 'FORT').map((c) => c.id)).toEqual(['1'])
  })

  test('non-ASCII match works (would break with SQL LIKE collation)', () => {
    expect(filterConversationsByTitle(list, 'राजधानी').map((c) => c.id)).toEqual(['3'])
    expect(filterConversationsByTitle(list, '中文')).toHaveLength(0)
  })

  test('no match returns empty list', () => {
    expect(filterConversationsByTitle(list, 'zzz-not-there')).toHaveLength(0)
  })
})

describe('conversationSidebarSections', () => {
  // Fixed "now": 2026-11-01 15:00 local time.
  const now = new Date(2026, 10, 1, 15, 0, 0)

  test('buckets by local calendar day, not fixed 24h windows', () => {
    const sections = conversationSidebarSections(
      [
        conv('today', 'this morning', new Date(2026, 10, 1, 8, 0)),
        conv('late-night', '11:30pm yesterday', new Date(2026, 9, 31, 23, 30)), // 15.5h ago -> YESTERDAY
        conv('three-days', 'three days ago', new Date(2026, 9, 29, 12, 0)),
        conv('two-weeks', 'two weeks ago', new Date(2026, 9, 18, 12, 0)),
        conv('two-months', 'two months ago', new Date(2026, 8, 1, 12, 0)),
      ],
      now,
    )
    const byLabel = Object.fromEntries(sections.map((s) => [s.label, s.items.map((i) => i.id)]))
    expect(byLabel['Today']).toEqual(['today'])
    expect(byLabel['Yesterday']).toEqual(['late-night'])
    expect(byLabel['Previous 7 days']).toEqual(['three-days'])
    expect(byLabel['Previous 30 days']).toEqual(['two-weeks'])
    expect(byLabel['Older']).toEqual(['two-months'])
  })

  test('empty buckets are omitted; ordering is chronological', () => {
    const sections = conversationSidebarSections(
      [conv('a', 'old', new Date(2025, 0, 1)), conv('b', 'now', new Date(2026, 10, 1, 14, 0))],
      now,
    )
    expect(sections.map((s) => s.label)).toEqual(['Today', 'Older'])
  })

  test('boundary: exactly 7 days back lands in Previous 7 days', () => {
    const sections = conversationSidebarSections(
      [conv('edge', 'edge', new Date(2026, 9, 25, 15, 0))],
      now,
    )
    expect(sections.map((s) => s.label)).toEqual(['Previous 7 days'])
  })
})
