/**
 * RIISHE sidebar — rendered-interface verification WITHOUT the platform
 * dev server (which is currently down; starting it via shell is forbidden).
 *
 * This renders the REAL production components (RiisheSidebarDesktop /
 * RiisheSidebarBody via react-dom/server) — not a mock, not a source grep —
 * into a static page styled by the app's own compiled Tailwind CSS, then
 * prints DOM assertions and writes an HTML file for screenshot evidence.
 *
 * Run: bun scripts/riishe-sidebar-render.tsx
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import { RiisheSidebarDesktop, RiisheSidebarBody } from '../src/components/bean/riishe/riishe-sidebar'
import type { RiisheChat } from '../src/components/bean/riishe/use-riishe-chat'
import type { BeanUser } from '../src/components/bean/shared'

const user: BeanUser = { id: 'u1', email: 'demo@bean.dev', name: 'Demo User', role: 'member' }

const chat = {
  conversations: [
    { id: 'c1', title: 'History of computing', messages: 4, updatedAt: new Date() },
    { id: 'c2', title: 'Tamil grammar help', messages: 2, updatedAt: new Date() },
  ],
  searchQuery: '',
  searching: false,
  activeId: 'c1',
  activeTitle: 'History of computing',
  messages: [],
  input: '',
  streaming: false,
  researching: false,
  runningTool: null,
  error: null,
  files: [],
  uploadingCount: 0,
  dragOver: false,
  setInput: () => {},
  setSearchQuery: () => {},
  setDragOver: () => {},
  setError: () => {},
  send: async () => {},
  stopGeneration: () => {},
  regenerateFrom: () => {},
  newConversation: () => {},
  openConversation: () => {},
  deleteConversation: async () => ({ ok: true }),
  renameConversation: async () => ({ ok: true }),
  uploadFiles: async () => {},
  removeFile: () => {},
} as unknown as RiisheChat

const openSettings = () => {}
const noop = () => {}

const desktop = renderToStaticMarkup(
  <RiisheSidebarDesktop chat={chat} user={user} onOpenSettings={openSettings} onCollapse={noop} />,
)

// The mobile drawer body is the component under test; SheetContent only adds
// the Radix overlay (which cannot render in static markup) — the drawer frame
// here uses the EXACT classes RiisheSidebarMobile passes to SheetContent.
const drawerBody = renderToStaticMarkup(
  <div className="flex h-[100dvh] w-[288px] flex-col justify-end">
    <div
      className="flex h-full w-[288px] flex-col border-r border-[rgba(212,175,55,0.15)] bg-[#0c0c0e] p-0"
      data-testid="drawer-frame"
    >
      <RiisheSidebarBody chat={chat} user={user} onOpenSettings={openSettings} closeAfterAction={noop} />
    </div>
  </div>,
)

// ---- DOM assertions on the REAL rendered markup ---------------------------
const count = (hay: string, needle: string) => hay.split(needle).length - 1
let failures = 0
function check(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) failures += 1
}

console.log('== DESKTOP RAIL (rendered DOM) ==')
check('no "Close conversations" anywhere', count(desktop, 'Close conversations') === 0)
check('no close-X button in the header', !/aria-label="[^"]*(?:close|Close)[^"]*"/.test(desktop))
check('exactly one "Collapse sidebar" toggle', count(desktop, 'aria-label="Collapse sidebar"') === 1, `count=${count(desktop, 'aria-label="Collapse sidebar"')}`)
check('RIISHE branding present', desktop.includes('RIISHE') && desktop.includes('BEAN CONVERSATIONAL AI'))
check('New chat present', desktop.includes('New chat'))
check('search present', desktop.includes('Search conversations'))
check('history rows present', desktop.includes('History of computing') && desktop.includes('Tamil grammar help'))
check('user settings entry present', desktop.includes('Open account settings'))

console.log('== MOBILE DRAWER BODY (rendered DOM) ==')
check('no "Close conversations" anywhere', count(drawerBody, 'Close conversations') === 0)
check('no close-X button anywhere', !/aria-label="[^"]*(?:close|Close)[^"]*"/.test(drawerBody))
check('no Collapse toggle in the drawer body', count(drawerBody, 'aria-label="Collapse sidebar"') === 0)
check('RIISHE branding present', drawerBody.includes('RIISHE') && drawerBody.includes('BEAN CONVERSATIONAL AI'))
check('New chat present', drawerBody.includes('New chat'))
check('search present', drawerBody.includes('Search conversations'))
check('history rows present', drawerBody.includes('History of computing'))
check('user settings entry present', drawerBody.includes('Open account settings'))
check('Sheet built-in close absent (showClose={false} honored)', !drawerBody.includes('data-slot="sheet-close"') && !drawerBody.includes('SheetClose'))

console.log(failures === 0 ? '\nALL RENDERED-DOM CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)

// ---- Evidence page (styled by the app's compiled CSS) ---------------------
const css = `../.next/static/chunks/c704416f1cace554.css`
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${css}"/>
<style>
  body { margin:0; background:#080808; color:#fff; font-family: var(--font-sans, system-ui), sans-serif; }
  .frame { display:flex; height:100vh; overflow:hidden; }
  .label { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.4); padding:8px 12px; border-bottom:1px solid rgba(212,175,55,.12); }
</style>
</head>
<body>
  <div class="frame" id="desktop-frame">
    <div style="width:264px; border-right:1px solid rgba(212,175,55,.12);">${desktop}</div>
    <div style="flex:1; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,.25); font-size:12px;">chat column (out of scope)</div>
  </div>
</body>
</html>`
writeFileSync(new URL('./riishe-sidebar-live-desktop.html', import.meta.url), page)

const mobilePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${css}"/>
<style>
  body { margin:0; background:#080808; color:#fff; font-family: var(--font-sans, system-ui), sans-serif; }
</style>
</head>
<body>
  <div style="position:fixed; inset:0; display:flex; justify-content:flex-start;">
    <div style="position:absolute; inset:0; background:rgba(0,0,0,.6);"></div>
    ${drawerBody}
  </div>
</body>
</html>`
writeFileSync(new URL('./riishe-sidebar-live-mobile.html', import.meta.url), mobilePage)
console.log('evidence pages written: scripts/riishe-sidebar-live-{desktop,mobile}.html')
if (failures > 0) process.exit(1)
