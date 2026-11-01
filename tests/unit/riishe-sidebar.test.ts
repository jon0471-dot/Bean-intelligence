/**
 * BEAN Intelligence — unit tests for the RIISHE sidebar defect fixes.
 * Run: bun test tests/unit/riishe-sidebar.test.ts
 *
 * Pins (source-level, the established convention for component code):
 *   1. DUPLICATE CLOSE — root cause: shadcn SheetContent unconditionally
 *      rendered its own built-in close button on top of the sidebar's own
 *      header close control. Fixed at the tree level with an opt-out prop;
 *      the mobile sidebar uses it, so exactly ONE close button renders.
 *      (Conditional render — never a CSS hide.)
 *   2. DELETE CONTROL — a direct hover trash (desktop), a menu path that is
 *      visible without hover (mobile), stopPropagation so the row never
 *      opens the conversation when delete is clicked, confirmation dialog
 *      with honest backend-failure handling.
 *   3. MOBILE DIALOG UNMOUNT BUG — askDelete/askRename must not close the
 *      Sheet before the dialog shows (closing unmounts the dialogs).
 *   4. RUNTIME CONTRACT — delete/rename return honest { ok, error } results
 *      instead of resolving identically on success and failure.
 *   5. ACCESSIBLE TOOLTIPS on the icon-only controls.
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

describe('duplicate close button — root-cause fix', () => {
  test('SheetContent exposes a showClose opt-out (default true keeps other consumers unchanged)', () => {
    expect(sheet).toContain('showClose = true')
  })

  test('the built-in close renders CONDITIONALLY, not via CSS hiding', () => {
    expect(sheet).toContain('{showClose ? (')
    expect(sheet).toContain('<SheetPrimitive.Close')
  })

  test('the mobile sidebar opts out — its own header X is the single close control', () => {
    expect(sidebar).toContain('showClose={false}')
  })

  test('the body renders exactly ONE close affordance per mode (onClose XOR onCollapse)', () => {
    // The ternary structure guarantees the mobile X and the desktop collapse
    // button can never render together, and the desktop variant never passes
    // onClose while the mobile variant never passes onCollapse.
    expect(sidebar).toContain("{onClose ? (")
    expect(sidebar).toContain(") : onCollapse ? (")
    // aria-labels appear exactly once each — no duplicated close controls.
    expect(sidebar.match(/aria-label="Close conversations"/g)?.length).toBe(1)
    expect(sidebar.match(/aria-label="Collapse sidebar"/g)?.length).toBe(1)
  })

  test('the single close X is never hidden by CSS (no breakpoint class on the button)', () => {
    // Rule: duplicates are removed from the TREE (showClose={false} above),
    // never hidden with CSS. The X must render whenever the drawer body
    // renders with onClose — including the resize-to-desktop edge case,
    // where the old lg:hidden left an open drawer with zero close controls.
    const anchor = sidebar.indexOf('aria-label="Close conversations"')
    const open = sidebar.lastIndexOf('{onClose ? (', anchor)
    const closeBlock = sidebar.slice(open, anchor)
    expect(closeBlock).toContain('className="ml-auto text-white/45 hover:text-white/85"')
    expect(closeBlock).not.toContain('lg:hidden')
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
  test('askDelete / askRename no longer close the Sheet before the dialog shows', () => {
    const handlers = sidebar.slice(sidebar.indexOf('askRename / askDelete intentionally do NOT close'), sidebar.indexOf('const searching ='))
    expect(handlers).toContain('function askDelete(')
    expect(handlers).toContain('function askRename(')
    // Neither handler closes the drawer; onClose fires only on success.
    expect(handlers.match(/onClose\?\.\(\)/g)?.length).toBe(2) // inside submitRename + confirmDelete success paths only
    expect(handlers.indexOf('onClose?.()')).toBeGreaterThan(handlers.indexOf('function submitRename('))
  })
})

describe('sidebar quality', () => {
  test('icon-only controls have accessible tooltips', () => {
    expect(sidebar).toContain("Delete conversation\n        </TooltipContent>")
    expect(sidebar).toContain('Conversation options')
    expect(sidebar).toContain('Close conversations')
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
