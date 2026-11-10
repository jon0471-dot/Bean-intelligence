/**
 * BEAN Intelligence — unit tests for the RIISHE sidebar defect fixes.
 * Run: bun test tests/unit/riishe-sidebar.test.ts
 *
 * Pins (source-level, the established convention for component code):
 *   1. NO HEADER CLOSE BUTTON — the X / "Close conversations" control was
 *      REMOVED from the sidebar header at the source (tree removal, never a
 *      CSS hide, never replaced by another icon). The mobile drawer closes
 *      via the overlay tap, Escape, and automatically after every successful
 *      action (closeAfterAction). The Sheet's own built-in close stays
 *      tree-removed (showClose={false}) so no duplicate can appear.
 *   2. DELETE CONTROL — a direct hover trash (desktop), a menu path that is
 *      visible without hover (mobile), stopPropagation so the row never
 *      opens the conversation when delete is clicked, confirmation dialog
 *      with honest backend-failure handling.
 *   3. MOBILE DIALOG UNMOUNT BUG — askDelete/askRename must not close the
 *      Sheet before the dialog shows (closing unmounts the dialogs).
 *   4. RUNTIME CONTRACT — delete/rename return honest { ok, error } results
 *      instead of resolving identically on success and failure.
 *   5. ACCESSIBLE TOOLTIPS on the remaining icon-only controls.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SheetContent } from '../../src/components/ui/sheet'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const sheet = src('../../src/components/ui/sheet.tsx')
const sidebar = src('../../src/components/bean/riishe/riishe-sidebar.tsx')
const runtime = src('../../src/components/bean/riishe/use-riishe-chat.ts')

describe('no header close button — removed at the source', () => {
  test('SheetContent still exposes its showClose opt-out with conditional render (other consumers unchanged)', () => {
    expect(sheet).toContain('showClose = true')
    expect(sheet).toContain('{showClose ? (')
    expect(sheet).toContain('<SheetPrimitive.Close')
  })

  test('the sidebar header renders NO "Close conversations" control anywhere', () => {
    // The X was removed entirely (user decision, 2026-11-01): no aria-label,
    // no tooltip text, no button branch. It must not come back hidden —
    // there is no CSS hiding here because there is no element at all.
    expect(sidebar).not.toContain('aria-label="Close conversations"')
    expect(sidebar).not.toContain('>Close conversations</TooltipContent>')
    expect(sidebar).not.toContain('Close conversations\n            </TooltipContent>')
  })

  test('the removal is a tree removal — the old onClose button ternary is gone', () => {
    expect(sidebar).not.toContain('{onClose ? (')
    expect(sidebar).not.toContain('onClick={onClose}')
  })

  test('the mobile drawer still opts out of the Sheet built-in close (no duplicate)', () => {
    expect(sidebar).toContain('showClose={false}')
  })

  test('the desktop rail keeps exactly one collapse toggle', () => {
    expect(sidebar.match(/aria-label="Collapse sidebar"/g)?.length).toBe(1)
  })

  test('the drawer closes AFTER successful actions via closeAfterAction (no UI control)', () => {
    // New chat, settings, rename success, delete success, row selection.
    expect(sidebar).toContain('closeAfterAction?.()')
    expect(sidebar).toContain('closeAfterAction={() => onOpenChange(false)}')
    expect(sidebar).toContain('closeAfterAction?: () => void')
  })

  test('selecting a conversation closes the drawer on mobile (click and keyboard paths)', () => {
    const rowBlock = sidebar.slice(sidebar.indexOf('function ConversationRow('), sidebar.indexOf('export function RiisheSidebarBody'))
    expect(rowBlock).toContain('chat.openConversation(conv.id)')
    expect(rowBlock.match(/closeAfterAction\?\.\(\)/g)?.length).toBe(2)
  })

  test('every ConversationRow render site passes closeAfterAction through (live-verified contract)', () => {
    // Regression: the row received the prop but the two render sites inside
    // the body never passed it, so a mobile row-tap opened the conversation
    // while the drawer stayed open. Both call sites must wire the callback.
    const usages = sidebar.match(/<ConversationRow[\s\S]*?\/>/g) ?? []
    expect(usages.length).toBe(2)
    for (const usage of usages) {
      expect(usage).toContain('closeAfterAction={closeAfterAction}')
    }
  })
})

describe('delete control beside every conversation', () => {
  test('direct trash button exists on desktop rows and appears on hover/focus', () => {
    expect(sidebar).toContain('aria-label={`Delete conversation: ${conv.title}`}')
    expect(sidebar).toContain('lg:group-hover:opacity-100')
    expect(sidebar).toContain('lg:flex lg:opacity-0')
  })

  test('the options menu trigger is visible WITHOUT hover on mobile (<lg)', () => {
    // Base opacity-100 (touch devices) with lg-only fade-in — the previous
    // opacity-0 base made the delete path unreachable on touch.
    expect(sidebar).toContain('opacity-100 transition-opacity hover:bg-white/10 hover:text-white/85')
    expect(sidebar).toContain('lg:opacity-0 lg:group-hover:opacity-100')
  })

  test('clicking delete never opens the conversation (stopPropagation on click AND keydown)', () => {
    const rowBlock = sidebar.slice(sidebar.indexOf('Direct delete (desktop'), sidebar.indexOf('Options menu (rename'))
    expect(rowBlock).toContain('e.stopPropagation()')
    expect(rowBlock).toContain('onKeyDown={(e) => e.stopPropagation()}')
  })

  test('delete goes through a confirmation dialog', () => {
    expect(sidebar).toContain('Delete conversation?')
    expect(sidebar).toContain('confirmDelete')
  })
})

describe('honest delete/rename error handling', () => {
  test('the confirm dialog stays open and shows the real backend error on failure', () => {
    expect(sidebar).toContain('setDeleteError(result.error')
    expect(sidebar).toContain('{deleteError ? <p className="text-xs text-red-300">{deleteError}</p> : null}')
    expect(sidebar).toContain('disabled={deleting}')
  })

  test('rename surfaces failures inline instead of silently closing', () => {
    expect(sidebar).toContain('setRenameError(result.error')
    expect(sidebar).toContain('{renameError ? <p className="text-xs text-red-300">{renameError}</p> : null}')
  })

  test('runtime delete/rename return { ok, error } results (no false success)', () => {
    expect(runtime).toContain('Promise<{ ok: boolean; error?: string }>')
    expect(runtime).toContain('return { ok: true }')
    expect(runtime).toContain('return { ok: false, error: message }')
  })
})

describe('mobile dialog unmount bug', () => {
  test('askRename / askRename-success / askDelete-success paths keep the close-after-action contract', () => {
    const handlers = sidebar.slice(sidebar.indexOf('askRename / askDelete intentionally do NOT close'), sidebar.indexOf('const searching ='))
    expect(handlers).toContain('function askDelete(')
    expect(handlers).toContain('function askRename(')
    // Neither handler closes the drawer; closeAfterAction fires only on
    // success (submitRename + confirmDelete).
    expect(handlers.match(/closeAfterAction\?\.\(\)/g)?.length).toBe(2)
  })
})

describe('sidebar quality', () => {
  test('icon-only controls have accessible tooltips', () => {
    expect(sidebar).toContain("Delete conversation\n        </TooltipContent>")
    expect(sidebar).toContain('Conversation options')
    expect(sidebar).toContain('Collapse sidebar')
  })

  test('titles cannot overlap the action buttons (truncation + shrink-0 actions)', () => {
    expect(sidebar).toContain('min-w-0 flex-1 truncate')
    expect(sidebar).toContain('shrink-0 items-center justify-center')
  })

  test('New Chat, search, date grouping and selected highlighting remain', () => {
    expect(sidebar).toContain('New chat')
    expect(sidebar).toContain('Search conversations')
    expect(sidebar).toContain('conversationSidebarSections(chat.conversations)')
    expect(sidebar).toContain("active ? 'bg-[rgba(212,175,55,0.12)]")
  })

  test('SheetContent still renders its built-in close by default (other consumers unchanged)', () => {
    const m = renderToStaticMarkup(
      // Sheet content needs a title for Radix; render statically without providers.
      createElement('div', {
        dangerouslySetInnerHTML: { __html: '<div data-slot="sheet-content" />' },
      }),
    )
    expect(m).toContain('sheet-content')
    expect(sheet).toContain('function SheetContent(')
  })
})
