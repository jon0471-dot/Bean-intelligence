/**
 * Renders the actual RiisheIcon component (SSR via react-dom/server) into a
 * static contact-sheet HTML on BEAN's dark surfaces: both canonical variants
 * (tile / transparent mark) at every placement size used in the app, plus
 * in-context mockups (welcome hero, chat header, nav item, sidebar branding,
 * assistant avatar, dashboard card chip). Asset srcs are inlined as data
 * URIs so the sheet also works offline from file://. Development
 * verification tool only — not part of the app.
 *
 * Run: bun scripts/riishe-icon-render.tsx
 * Out: scripts/riishe-icon-preview.html
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { RiisheIcon } from '../src/components/riishe/RiisheIcon'

const dataUri = (rel: string) =>
  `data:image/webp;base64,${readFileSync(new URL(rel, import.meta.url)).toString('base64')}`
const MARK = dataUri('../public/brand/riishe/riishe-mark.webp')
const TILE = dataUri('../public/brand/riishe/riishe-tile.webp')

const icon = (props: Record<string, unknown>, size?: number) => {
  let m = renderToStaticMarkup(React.createElement(RiisheIcon, props as never))
  if (size) m = m.replace('<img ', `<img width="${size}" height="${size}" `)
  return m.replace('src="/brand/riishe/riishe-mark.webp"', `src="${MARK}"`)
          .replace('src="/brand/riishe/riishe-tile.webp"', `src="${TILE}"`)
}

const cell = (px: number, label: string, inner: string) => `
  <div class="cell">
    <div class="icon-slot" style="width:${px}px;height:${px}px">${inner}</div>
    <div class="label">${label}</div>
  </div>`

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; background: #080808; font-family: ui-sans-serif, system-ui, sans-serif; color: #f5f5f5; }
  .row { display: flex; align-items: flex-end; gap: 30px; padding: 26px 32px; flex-wrap: wrap; }
  .row.context { background: #0d0d10; border-top: 1px solid rgba(212,175,55,0.12); }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .icon-slot { display: flex; align-items: center; justify-content: center; flex: none; }
  .icon-slot img { width: 100%; height: 100%; }
  img { image-rendering: auto; }
  .label { font-size: 11px; color: #b7b7b7; letter-spacing: 0.06em; text-align: center; }
  .hero { display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; }
  .hero h1 { margin: 0; font-size: 28px; font-weight: 600; color: rgba(255,255,255,0.92); }
  .gold { color: #f0c75e; }
  .headerbar { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
  .navitem { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px;
             background: rgba(212,175,55,0.12); color: #f0c75e; font-size: 13px;
             box-shadow: inset 0 0 0 1px rgba(212,175,55,0.22); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .t1 { font-size: 14px; font-weight: 600; letter-spacing: 0.18em; color: #f0c75e; }
  .brand .t2 { font-size: 9px; letter-spacing: 0.22em; color: rgba(255,255,255,0.35); }
  .avatar { width: 28px; height: 28px; border-radius: 9999px; border: 1px solid rgba(212,175,55,0.4);
            background: rgba(212,175,55,0.1); display: flex; align-items: center; justify-content: center; }
  .cardchip { width: 40px; height: 40px; border-radius: 8px; border: 1px solid rgba(212,175,55,0.25);
              background: rgba(212,175,55,0.07); display: flex; align-items: center; justify-content: center; }
  .landingcard { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 12px;
                 background: rgba(255,255,255,0.03); border: 1px solid rgba(212,175,55,0.12); font-size: 13px; }
</style>
</head>
<body>
  <div class="row">
    ${cell(96, 'tile 96px', icon({ variant: 'tile' }))}
    ${cell(56, 'tile 56px (welcome)', icon({ variant: 'tile' }))}
    ${cell(40, 'tile 40px', icon({ variant: 'tile' }))}
    ${cell(256, 'mark 256px', icon({ variant: 'mark' }))}
  </div>
  <div class="row">
    ${cell(48, 'mark 48px', icon({ variant: 'mark' }))}
    ${cell(32, 'mark 32px', icon({ variant: 'mark' }))}
    ${cell(28, 'mark 28px (sidebar/avatar)', icon({ variant: 'mark' }))}
    ${cell(24, 'mark 24px', icon({ variant: 'mark' }))}
    ${cell(18, 'mark 18px (header)', icon({ variant: 'mark' }))}
    ${cell(16, 'mark 16px (nav)', icon({ variant: 'mark' }))}
  </div>
  <div class="row context">
    <div class="cell"><div class="hero">${icon({ variant: 'tile' }, 56)}<h1>Hello! I&apos;m <span class="gold">RIISHE</span>, How can I help you today?</h1></div><div class="label">welcome hero context</div></div>
    <div class="cell"><div class="headerbar">${icon({ variant: 'mark' }, 18)}<span>RIISHE</span></div><div class="label">chat header context</div></div>
    <div class="cell"><div class="navitem">${icon({ variant: 'mark' }, 16)}RIISHE</div><div class="label">nav item context</div></div>
    <div class="cell"><div class="brand">${icon({ variant: 'mark' }, 28)}<div><div class="t1">RIISHE</div><div class="t2">BEAN CONVERSATIONAL AI</div></div></div><div class="label">sidebar branding context</div></div>
    <div class="cell"><div class="avatar">${icon({ variant: 'mark' }, 18)}</div><div class="label">assistant avatar context</div></div>
    <div class="cell"><div class="cardchip">${icon({ variant: 'mark' }, 20)}</div><div class="label">dashboard card chip</div></div>
    <div class="cell"><div class="landingcard">${icon({ variant: 'mark' }, 16)}<span class="gold">RIISHE</span></div><div class="label">landing product card</div></div>
  </div>
</body>
</html>`

const out = new URL('./riishe-icon-preview.html', import.meta.url).pathname
await Bun.write(out, html)
console.log(`written: ${out}`)
