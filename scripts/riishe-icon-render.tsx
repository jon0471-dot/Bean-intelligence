/**
 * Renders the actual RiisheIcon component (SSR via react-dom/server) into a
 * static contact-sheet HTML on dark BEAN-style backgrounds, at the sizes the
 * brand spec requires (24/32/48/96) plus the compact 18px header size and a
 * mono variant. Purely a development verification tool — not part of the app.
 *
 * Run: bun scripts/riishe-icon-render.tsx
 * Out: scripts/riishe-icon-preview.html
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RiisheIcon } from '../src/components/riishe/RiisheIcon'

function cell(px: number, label: string, slotClass: string, extraStyle = '') {
  const icon = renderToStaticMarkup(React.createElement(RiisheIcon))
  return `
    <div class="cell">
      <div class="${slotClass}" style="width:${px}px;height:${px}px;${extraStyle}">${icon}</div>
      <div class="label">${label}</div>
    </div>`
}

function slot(px: number, inner: string, extraStyle = '') {
  return `<div class="icon-slot" style="width:${px}px;height:${px}px;${extraStyle}">${inner}</div>`
}

const monoIcon = renderToStaticMarkup(React.createElement(RiisheIcon, { mono: true }))
const plainIcon = renderToStaticMarkup(React.createElement(RiisheIcon))

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; background: #080808; font-family: ui-sans-serif, system-ui, sans-serif; color: #f5f5f5; }
  .row { display: flex; align-items: flex-end; gap: 28px; padding: 28px 32px 10px; flex-wrap: wrap; }
  .row.secondary { background: #0d0d0d; margin-top: 18px; padding-top: 22px; padding-bottom: 26px; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .icon-slot { display: flex; align-items: center; justify-content: center; }
  .icon-slot svg { width: 100%; height: 100%; display: block; }
  .label { font-size: 11px; color: #b7b7b7; letter-spacing: 0.06em; }
  .tile { border-radius: 16px; border: 1px solid rgba(212,175,55,0.35); background: #0e0e10;
          box-shadow: 0 0 40px -12px rgba(212,175,55,0.5); }
  .chip { border-radius: 8px; border: 1px solid rgba(212,175,55,0.25); background: rgba(212,175,55,0.07); }
  .incontext { display: flex; align-items: center; gap: 8px; color: #f5f5f5; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
  <div class="row">
    ${cell(96, '96px', 'icon-slot')}
    ${cell(48, '48px', 'icon-slot')}
    ${cell(32, '32px', 'icon-slot')}
    ${cell(24, '24px', 'icon-slot')}
    ${cell(96, '96px in dark tile', 'icon-slot tile', 'padding:8px')}
    <div class="cell">
      ${slot(48, monoIcon, 'color:#d4af37')}
      <div class="label">mono 48px (currentColor #d4af37)</div>
    </div>
  </div>
  <div class="row secondary">
    <div class="cell">
      <div class="incontext">${slot(18, plainIcon)} Chat header chip 18px</div>
      <div class="label">header context</div>
    </div>
    <div class="cell">
      ${slot(20, plainIcon, 'border-radius:8px;border:1px solid rgba(212,175,55,0.25);background:rgba(212,175,55,0.07)')}
      <div class="label">operational-card chip 20px</div>
    </div>
    <div class="cell">
      <div class="incontext">${slot(16, plainIcon)} stress 16px</div>
      <div class="label">smallest readable</div>
    </div>
  </div>
</body>
</html>`

const out = new URL('./riishe-icon-preview.html', import.meta.url).pathname
await Bun.write(out, html)
console.log(`written: ${out}`)
