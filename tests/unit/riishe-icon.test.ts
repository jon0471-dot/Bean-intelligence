/**
 * BEAN Intelligence — unit tests for the official RIISHE brand icon.
 * Run: bun test tests/unit/riishe-icon.test.ts
 *
 * Under test (src/components/riishe/RiisheIcon.tsx + /public/brand/riishe/*):
 *   - canonical assets exist and are valid WebP with alpha (tile + mark)
 *   - the centralized component renders the right asset per variant
 *   - every RIISHE branding location uses the SAME component (source pins)
 *   - the old generic icons are gone from RIISHE placements (repo-wide pin)
 *   - BeanMark intentionally remains ONLY as the BEAN platform logo
 *   - the exact welcome greeting is untouched
 */
import { describe, test, expect } from 'bun:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RiisheIcon } from '../../src/components/riishe/RiisheIcon'

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(RiisheIcon, props as never))

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const isWebP = (buf: Buffer) =>
  buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP'

const ASSETS = [
  '../../public/brand/riishe/riishe-mark.webp',
  '../../public/brand/riishe/riishe-tile.webp',
]

describe('RIISHE canonical brand assets', () => {
  for (const asset of ASSETS) {
    test(`${asset.replace('../../public/', '')} exists and is a valid WebP`, () => {
      const buf = readFileSync(new URL(asset, import.meta.url))
      expect(isWebP(buf)).toBe(true)
      expect(buf.length).toBeGreaterThan(10 * 1024) // real artwork, not a placeholder
    })
  }
})

describe('RiisheIcon component', () => {
  test('defaults to the transparent gold mark', () => {
    const m = render()
    expect(m).toContain('src="/brand/riishe/riishe-mark.webp"')
    expect(m).toContain('aria-hidden="true"')
    expect(m).toContain('draggable="false"')
    expect(m).toContain('<img')
  })

  test('variant="tile" renders the glossy app icon', () => {
    expect(render({ variant: 'tile' })).toContain('src="/brand/riishe/riishe-tile.webp"')
  })

  test('passes sizing/spacing through via className', () => {
    expect(render({ className: 'h-14 w-14 mb-5' })).toContain('class="inline-block select-none h-14 w-14 mb-5"')
  })
})

describe('RiisheIcon adoption — every RIISHE branding location', () => {
  test('welcome screen: glossy tile icon above the EXACT greeting', () => {
    const messages = src('../../src/components/bean/riishe/riishe-messages.tsx')
    expect(messages).toContain('<RiisheIcon variant="tile" className="mb-5 h-14 w-14" />')
    expect(messages).toContain('Hello! I&apos;m <span className="bean-gold-text">RIISHE</span>, How can I help you today?')
    // assistant (agent) avatar also carries the official mark
    expect(messages).toMatch(/<RiisheIcon className="h-4\.5 w-4\.5" \/>/)
    expect(messages).not.toContain('BeanMark')
  })

  test('chat header keeps the compact mark', () => {
    const workspace = src('../../src/components/bean/riishe.tsx')
    expect(workspace).toContain('<RiisheIcon')
    expect(workspace).not.toContain('MessageSquareText')
  })

  test('dashboard workspace/operational card maps riishe to RiisheIcon', () => {
    const dashboard = src('../../src/components/bean/dashboard.tsx')
    expect(dashboard).toMatch(/riishe:\s*RiisheIcon,/)
    expect(dashboard).not.toContain('MessageSquareText')
    expect(dashboard).toMatch(/laxii:\s*ImageIcon,/)
    expect(dashboard).toMatch(/jazmii:\s*Video,/)
    expect(dashboard).toMatch(/'code-giftz':\s*Code2,/)
  })

  test('shell navigation (sidebar + mobile drawer) uses RiisheIcon for RIISHE', () => {
    const shell = src('../../src/components/bean/shell.tsx')
    expect(shell).toMatch(/id:\s*'riishe',\s*label:\s*'RIISHE',\s*icon:\s*RiisheIcon/)
    expect(shell).not.toContain('MessageSquareText')
    // BeanMark intentionally retained: it is the BEAN platform logo there
    expect(shell).toContain('BeanMark')
  })

  test('landing product card uses RiisheIcon for RIISHE only', () => {
    const landing = src('../../src/components/bean/landing.tsx')
    expect(landing).toMatch(/name:\s*'RIISHE'.*icon:\s*RiisheIcon/)
    expect(landing).not.toContain('MessageSquareText')
    expect(landing).toContain('BeanMark') // BEAN header logo — intentional
  })

  test('RIISHE conversation sidebar branding uses RiisheIcon', () => {
    const sidebar = src('../../src/components/bean/riishe/riishe-sidebar.tsx')
    expect(sidebar).toContain('<RiisheIcon className="h-7 w-7" />')
    expect(sidebar).not.toContain('BeanMark')
  })

  test('repo-wide: no generic MessageSquareText placeholder remains anywhere in src', () => {
    const root = join(import.meta.dir, '../../src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(tsx|ts)$/.test(full) && readFileSync(full, 'utf8').includes('MessageSquareText')) {
          offenders.push(full)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
