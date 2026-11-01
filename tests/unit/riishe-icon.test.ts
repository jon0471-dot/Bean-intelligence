/**
 * BEAN Intelligence — unit tests for the RIISHE brand emblem component.
 * Run: bun test tests/unit/riishe-icon.test.ts
 *
 * Under test (src/components/riishe/RiisheIcon.tsx):
 *   - the emblem is pure vector artwork (no <text>, no external refs)
 *   - the champagne-gold gradient (#FFE9A6 / #F5CB55 / #DDAA32) is present
 *   - every instance generates unique gradient/filter ids (no aliasing)
 *   - mono mode switches to currentColor and drops the ambient halo
 *   - glow={false} drops the glow filter
 *   - the three scoped UI locations (welcome greeting, chat header,
 *     dashboard operational card) all import the SAME component
 */
import { describe, test, expect } from 'bun:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { RiisheIcon } from '../../src/components/riishe/RiisheIcon'

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(RiisheIcon, props as never))

const src = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('RiisheIcon artwork', () => {
  const markup = render()

  test('renders a scalable, decorative SVG with the 64x64 emblem geometry', () => {
    expect(markup).toContain('viewBox="0 0 64 64"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('<svg')
  })

  test('uses the champagne-gold gradient stops (#FFE9A6, #F5CB55, #DDAA32)', () => {
    expect(markup).toContain('#FFE9A6')
    expect(markup).toContain('#F5CB55')
    expect(markup).toContain('#DDAA32')
    expect(markup).toContain('linearGradient')
  })

  test('is pure vector art — no text nodes, no external image or font refs', () => {
    expect(markup).not.toContain('<text')
    expect(markup).not.toContain('<image')
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('@font-face')
  })

  test('includes the robot-head features: hair, face frame, eyes, headphone cups', () => {
    expect(markup).toContain('rx="8"') // symmetrical rounded face frame
    expect(markup).toContain('<ellipse') // oval eyes
    expect(markup.match(/<rect/g)?.length ?? 0).toBeGreaterThanOrEqual(3) // face + 2 cups
    expect(markup).toContain('A7 7 0 0 1 38 12.5') // crown arc of the hair cloud
  })

  test('keeps a subtle controlled glow (gaussian blur merged under the source)', () => {
    expect(markup).toContain('feGaussianBlur')
    expect(markup).toContain('feMerge')
  })
})

describe('RiisheIcon instance safety', () => {
  test('two instances in one tree get unique gradient/filter ids', () => {
    // Both emblems must live in the SAME React tree — that is how the app
    // renders them — so useId assigns distinct ids within one document.
    const pair = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(RiisheIcon),
        createElement(RiisheIcon),
      ),
    )
    const ids = [...pair.matchAll(/id="(riishe-[a-z-]+-[^"]+)"/g)].map((m) => m[1])
    // 5 defs per instance (hair, frame, eye, halo, glow) — all distinct
    expect(ids.length).toBe(10)
    expect(new Set(ids).size).toBe(10)
    // and each painted element references ids that exist in this document
    expect(pair.match(/url\(#riishe-[a-z-]+-[^)]+\)/g)?.length).toBeGreaterThan(0)
  })

  test('mono mode uses currentColor and drops the ambient halo and gradients', () => {
    const m = render({ mono: true })
    expect(m).toContain('currentColor')
    expect(m).not.toContain('linearGradient')
    expect(m).not.toContain('radialGradient')
    expect(m).not.toContain('riishe-halo-')
    expect(m).not.toContain('#FFE9A6')
  })

  test('glow={false} removes the glow filter reference', () => {
    const m = render({ glow: false })
    expect(m).not.toContain('filter=')
  })

  test('accepts a className for sizing', () => {
    expect(render({ className: 'h-9 w-9' })).toContain('class="h-9 w-9"')
  })
})

describe('RiisheIcon adoption — the three scoped locations share one component', () => {
  test('welcome greeting imports and renders RiisheIcon', () => {
    const messages = src('../../src/components/bean/riishe/riishe-messages.tsx')
    expect(messages).toContain("import { RiisheIcon } from '@/components/riishe/RiisheIcon'")
    expect(messages).toMatch(/<RiisheIcon className="h-9 w-9" \/>/)
  })

  test('chat header imports and renders RiisheIcon instead of the generic icon', () => {
    const workspace = src('../../src/components/bean/riishe.tsx')
    expect(workspace).toContain("import { RiisheIcon } from '@/components/riishe/RiisheIcon'")
    expect(workspace).toContain('<RiisheIcon')
    expect(workspace).not.toContain('MessageSquareText')
  })

  test('dashboard operational card maps riishe to RiisheIcon, others unchanged', () => {
    const dashboard = src('../../src/components/bean/dashboard.tsx')
    expect(dashboard).toContain("import { RiisheIcon } from '@/components/riishe/RiisheIcon'")
    expect(dashboard).toMatch(/riishe:\s*RiisheIcon,/)
    expect(dashboard).not.toContain('MessageSquareText')
    expect(dashboard).toMatch(/laxii:\s*ImageIcon,/)
    expect(dashboard).toMatch(/jazmii:\s*Video,/)
    expect(dashboard).toMatch(/'code-giftz':\s*Code2,/)
  })
})
