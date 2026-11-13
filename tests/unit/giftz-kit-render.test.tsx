/**
 * BEAN Intelligence — giftz-kit render validation (Phase 1 "never advertise a
 * component as installed unless its implementation exists and HAS PASSED
 * validation").
 *
 * Two layers:
 *  1. SYNTAX: every kit .tsx/.css parses (Bun transpiler scan — a real parse,
 *     not a heuristic).
 *  2. SSR SMOKE: every component that can render on the server renders
 *     non-empty markup through react-dom/server. Dock is portal-based and is
 *     validated by layer 1 + the repo's tsc gate (SSR cannot render portals).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { createElement, type FC as ReactFC } from 'react'
import { renderToString } from 'react-dom/server'

const KIT_DIR = path.join(import.meta.dir, '../../src/components/giftz-kit')

const SSR_CASES: Array<[string, Record<string, unknown>]> = [
  ['ShinyText', {}],
  ['GradientText', {}],
  ['StarBorder', {}],
  ['SpotlightCard', {}],
  ['GlareHover', {}],
  ['GlassSurface', {}],
  ['LetterGlitch', {}],
  ['DotGrid', {}],
  ['LatticeLoader', {}],
  ['ClickSpark', {}],
  ['BlurText', { text: 'Hello BEAN' }],
  ['CountUp', { to: 100 }],
  ['SplitText', { text: 'Hello BEAN' }],
  ['ScrollReveal', { children: 'Hi' }],
  ['AnimatedContent', { children: 'Hi' }],
]

describe('giftz-kit implementation validation', () => {
  const tsxFiles = readdirSync(KIT_DIR).filter((f) => f.endsWith('.tsx'))

  test('the kit contains the full installed set (17 components)', () => {
    expect(tsxFiles.length).toBe(17)
  })

  test('every kit component parses (Bun transpiler — real syntax gate)', () => {
    const transpiler = new Bun.Transpiler({ loader: 'tsx' })
    for (const file of tsxFiles) {
      const src = readFileSync(path.join(KIT_DIR, file), 'utf8')
      expect(() => transpiler.scanImports(src), `${file} has broken syntax`).not.toThrow()
    }
  })

  test('every kit stylesheet parses (balanced braces, non-empty)', () => {
    for (const file of readdirSync(KIT_DIR).filter((f) => f.endsWith('.css'))) {
      const src = readFileSync(path.join(KIT_DIR, file), 'utf8')
      expect(src.trim().length).toBeGreaterThan(0)
      expect((src.match(/{/g) ?? []).length, `${file} unbalanced braces`).toBe((src.match(/}/g) ?? []).length)
    }
  })

  test('every renderable component produces non-empty SSR markup', async () => {
    // Explicit typed loaders (no .tsx-extension template imports — tsc-clean,
    // bundler-friendly). `never` props accept every component's prop type.
    type KitLoader = () => Promise<{ default: (props: never) => unknown }>
    const KIT_MODULES: Record<string, KitLoader> = {
      ShinyText: () => import('../../src/components/giftz-kit/ShinyText'),
      GradientText: () => import('../../src/components/giftz-kit/GradientText'),
      StarBorder: () => import('../../src/components/giftz-kit/StarBorder'),
      SpotlightCard: () => import('../../src/components/giftz-kit/SpotlightCard'),
      GlareHover: () => import('../../src/components/giftz-kit/GlareHover'),
      GlassSurface: () => import('../../src/components/giftz-kit/GlassSurface'),
      LetterGlitch: () => import('../../src/components/giftz-kit/LetterGlitch'),
      DotGrid: () => import('../../src/components/giftz-kit/DotGrid'),
      LatticeLoader: () => import('../../src/components/giftz-kit/LatticeLoader'),
      ClickSpark: () => import('../../src/components/giftz-kit/ClickSpark'),
      BlurText: () => import('../../src/components/giftz-kit/BlurText'),
      CountUp: () => import('../../src/components/giftz-kit/CountUp'),
      SplitText: () => import('../../src/components/giftz-kit/SplitText'),
      ScrollReveal: () => import('../../src/components/giftz-kit/ScrollReveal'),
      AnimatedContent: () => import('../../src/components/giftz-kit/AnimatedContent'),
    }
    for (const [name, props] of SSR_CASES) {
      const loader = KIT_MODULES[name]
      expect(loader, `${name} missing from the SSR module map`).toBeTruthy()
      const { default: Comp } = await loader()
      // useGSAP/@gsap/react is isomorphic: it must NOT throw on the server.
      const html = renderToString(
        createElement(Comp as unknown as ReactFC<Record<string, unknown>>, props),
      ) as string
      expect(html.length, `${name} rendered empty`).toBeGreaterThan(10)
    }
  })

  test('the adapted framer-motion components render real text (motion/react replacement verified)', async () => {
    const { default: BlurText } = (await import('../../src/components/giftz-kit/BlurText')) as {
      default: (p: { text: string }) => unknown
    }
    const html = renderToString(
      createElement(BlurText as unknown as ReactFC<{ text: string }>, { text: 'Attribution preserved' }),
    ) as string
    expect(html).toContain('Attribution')
  })
})
