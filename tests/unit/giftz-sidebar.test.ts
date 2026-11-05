/**
 * BEAN Intelligence — unit tests for the CODE GIFTZ ChatGPT-style
 * conversation sidebar (search / rename / delete-confirmation / date
 * groups / collapse / mobile drawer).
 * Run: bun test tests/unit/giftz-sidebar.test.ts
 *
 * Conventions follow tests/unit/riishe-sidebar.test.ts:
 *  - source-level pins for component/route code,
 *  - SSR render checks for presentational behavior,
 *  - the shared pure view helpers are pinned once in
 *    tests/unit/riishe-conversation-view.test.ts — here we pin that GIFTZ
 *    REUSES them (no drifted second implementation).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GiftzSidebarBody } from '../../src/components/bean/code-giftz-sidebar'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const sidebar = src('../../src/components/bean/code-giftz-sidebar.tsx')
const screen = src('../../src/components/bean/code-giftz.tsx')
const listRoute = src('../../src/app/api/code-giftz/chat/route.ts')
const itemRoute = src('../../src/app/api/code-giftz/chat/[id]/route.ts')

describe('CODE GIFTZ sidebar — search', () => {
  test('a search input exists and is labeled for accessibility', () => {
    expect(sidebar).toContain('aria-label="Search conversations"')
    expect(sidebar).toContain('placeholder="Search conversations"')
  })

  test('the list endpoint accepts ?q= and reuses the SHARED RIISHE filter (no second implementation)', () => {
    expect(listRoute).toContain("searchParams.get('q')")
    expect(listRoute).toContain('filterConversationsByTitle')
    expect(listRoute).toContain("from '@/lib/riishe/conversation-view'")
  })

  test('search scans ALL conversations (take 200) and caps results at 50, like RIISHE', () => {
    expect(listRoute).toContain('take: 200')
    expect(listRoute).toContain('.slice(0, 50)')
  })

  test('the parent debounces search input and clears back to the unfiltered recents', () => {
    expect(screen).toContain('searchQuery')
    expect(screen).toContain('encodeURIComponent(q)')
    // Clearing the query must refetch the unfiltered list, not leave the
    // filtered rows frozen on screen.
    expect(screen).toContain('if (q.length === 0)')
  })

  test('the empty state explains WHY the list is empty while searching', () => {
    expect(sidebar).toContain('No conversations match')
  })
})

describe('CODE GIFTZ sidebar — rename', () => {
  test('a PATCH rename endpoint exists with owner-only access', () => {
    expect(itemRoute).toContain('export async function PATCH')
    expect(itemRoute).toContain('project.userId !== user.id')
  })

  test('rename persists through the same sanitizer RIISHE uses (never blank, capped, whitespace-collapsed)', () => {
    expect(itemRoute).toContain('sanitizeConversationTitle')
    expect(itemRoute).toContain("from '@/lib/riishe/conversation-view'")
  })

  test('the rename dialog is a real dialog with Save/Cancel and honest failure text', () => {
    expect(sidebar).toContain('Rename conversation')
    expect(sidebar).toContain('Rename failed. Please try again.')
    expect(sidebar).toContain('renameSaving')
  })
})

describe('CODE GIFTZ sidebar — delete with confirmation', () => {
  test('deletion is confirmed by an AlertDialog — never a single click', () => {
    expect(sidebar).toContain('Delete this conversation?')
    expect(sidebar).toContain('permanently removed')
    expect(sidebar).toContain('AlertDialogAction')
  })

  test('failed deletion keeps the dialog open and names the error (honest failure)', () => {
    expect(sidebar).toContain('Delete failed. Please try again.')
  })

  test('row action buttons stopPropagation so the row never opens as a side effect', () => {
    const stops = sidebar.match(/stopPropagation\(\)/g)?.length ?? 0
    expect(stops).toBeGreaterThanOrEqual(3)
  })

  test('the parent delete path is ONLY invoked from the confirmed flow and refreshes the list', () => {
    expect(screen).toContain('async function deleteProject(id: string): Promise<SidebarActionResult>')
    expect(screen).toContain("method: 'DELETE'")
    expect(screen).not.toContain('onClick={(e) => { e.stopPropagation(); void deleteProject(p.id) }}')
  })
})

describe('CODE GIFTZ sidebar — date-grouped history', () => {
  test('grouping comes from the SHARED conversationSidebarSections helper', () => {
    expect(sidebar).toContain("import { conversationSidebarSections } from '@/lib/riishe/conversation-view'")
    expect(sidebar).toContain('conversationSidebarSections(projects)')
  })

  test('rows surface message AND file counts plus age', () => {
    expect(sidebar).toContain('{project.messages} message')
    expect(sidebar).toContain('{project.files} file')
    expect(sidebar).toContain('timeAgo(project.updatedAt)')
  })

  test('SSR: sections render with labels and the active row is highlighted', () => {
    // Calendar-day-safe fixtures: "noon TODAY local" is always inside the
    // Today bucket and noon-minus-40-days is always inside Older, whatever
    // wall-clock time the suite runs at (hardcoded calendar dates made this
    // test fail the next day; now-based offsets fail right after midnight).
    const noonToday = new Date()
    noonToday.setHours(12, 0, 0, 0)
    const older = new Date(noonToday)
    older.setDate(older.getDate() - 40)
    const html = renderToStaticMarkup(
      React.createElement(GiftzSidebarBody, {
        projects: [
          { id: 'p1', title: 'Greeting module', messages: 2, files: 1, updatedAt: noonToday.toISOString() },
          { id: 'p2', title: 'Parser fix', messages: 4, files: 2, updatedAt: older.toISOString() },
        ],
        activeId: 'p1',
        searching: false,
        searchQuery: '',
        onSearchChange: () => {},
        onOpen: () => {},
        onNew: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
      }),
    )
    // Static render skips Radix portals but the rows/labels must be in the tree.
    expect(html).toContain('Greeting module')
    expect(html).toContain('Parser fix')
    expect(html).toContain('Today')
    expect(html).toContain('Older')
    expect(html).toContain('2 messages · 1 file')
    expect(html).toContain('aria-current="true"')
  })

  test('SSR: the empty state renders without projects', () => {
    const html = renderToStaticMarkup(
      React.createElement(GiftzSidebarBody, {
        projects: [],
        activeId: null,
        searching: false,
        searchQuery: '',
        onSearchChange: () => {},
        onOpen: () => {},
        onNew: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
      }),
    )
    expect(html).toContain('No conversations yet')
  })
})

describe('CODE GIFTZ sidebar — collapse + mobile drawer', () => {
  test('the desktop rail has exactly one collapse toggle', () => {
    expect(sidebar.match(/aria-label="Collapse sidebar"/g)?.length).toBe(1)
  })

  test('the collapsed rail offers expand + new conversation (icon strip)', () => {
    expect(sidebar).toContain('GiftzSidebarCollapsedRail')
    expect(sidebar).toContain('aria-label="Expand sidebar"')
    expect(sidebar).toContain('aria-label="New conversation"')
  })

  test('the mobile drawer embeds the SAME body inside a Sheet with an sr-only title', () => {
    expect(sidebar).toContain('GiftzSidebarMobile')
    expect(sidebar).toContain('<SheetContent')
    expect(sidebar).toContain('CODE GIFTZ conversations')
  })

  test('the mobile drawer closes only AFTER a successful action (closeAfterAction)', () => {
    expect(sidebar).toContain('closeAfterAction={() => onOpenChange(false)}')
  })

  test('the parent wires the collapsed grid column and the header trigger', () => {
    expect(screen).toContain("'lg:grid-cols-[48px_1fr]'")
    expect(screen).toContain('GiftzSidebarMobileTrigger')
    expect(screen).toContain('setSidebarOpen(true)')
  })
})

describe('CODE GIFTZ sidebar — runtime contract', () => {
  test('rename/delete return honest { ok, error } results the dialogs can render', () => {
    expect(screen).toContain('Promise<SidebarActionResult>')
    expect(screen).toContain('return { ok: false, error:')
    expect(sidebar).toContain('SidebarActionResult')
  })

  test('opening a conversation from the sidebar loads its full server history', () => {
    // openProject fetches /api/code-giftz/chat/[id] and rebuilds messages+files
    expect(screen).toContain('`/api/code-giftz/chat/${id}`')
    expect(screen).toContain('setMessages(d.project.messages.map')
  })

  test('the sidebar list refetches after a completed turn (new conversations appear)', () => {
    expect(screen).toContain('void loadProjects()')
  })
})
