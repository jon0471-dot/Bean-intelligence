/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: orchestration engine
 * (Phase 4 — detection, target resolution, selections, engine files, brief).
 */
import { describe, test, expect } from 'bun:test'
import {
  resolveFrontendPlan,
  finalizeFrontendTurn,
  detectBackgroundEffect,
  FRONTEND_BRIEF_MAX_CHARS,
} from '../../src/lib/frontend-intel/engine'
import { validateFrontendOutput } from '../../src/lib/frontend-intel/validate'
import type { FrontendSelection } from '../../src/lib/frontend-intel/types'

describe('frontend plan resolution', () => {
  test('non-frontend requests stay untouched: no brief, no engine files, no selections', () => {
    const plan = resolveFrontendPlan({ message: 'Write a python function that merges two sorted lists in O(n).' })
    expect(plan.enabled).toBe(false)
    expect(plan.brief).toBe('')
    expect(plan.engineFiles).toEqual([])
    expect(plan.componentIds).toEqual([])
    expect(plan.animationIds).toEqual([])
    expect(plan.vantaEffect).toBeNull()
  })

  test('a frontend request auto-detects: static target + minimal default animations, NO vanta, NO forced components', () => {
    const plan = resolveFrontendPlan({ message: 'Build a landing page for a coffee shop with a hero section.' })
    expect(plan.enabled).toBe(true)
    expect(plan.target).toBe('static')
    expect(plan.animationIds).toEqual(['entrance-timeline', 'scroll-reveal-batch'])
    expect(plan.vantaEffect).toBeNull()
    expect(plan.brief).toContain('FRONTEND INTELLIGENCE BRIEF')
    expect(plan.brief).toContain('NEVER reference CDN or remote URLs')
    // GSAP planned → GSAP vendor attached (offline preview contract).
    expect(plan.engineFiles.map((f) => f.path)).toContain('vendor/gsap.min.js')
    expect(plan.engineFiles.map((f) => f.path)).toContain('vendor/ScrollTrigger.min.js')
    expect(plan.engineFiles.map((f) => f.path)).toContain('NOTICES.md')
  })

  test('React intent flips the target; kit sources + pinned package.json + NOTICES are engine-attached', () => {
    const plan = resolveFrontendPlan({
      message: 'Create a React portfolio site with a spotlight card and a count-up stats section.',
    })
    expect(plan.enabled).toBe(true)
    expect(plan.target).toBe('react')
    expect(plan.componentIds).toContain('spotlight-card')
    expect(plan.componentIds).toContain('count-up')
    const paths = plan.engineFiles.map((f) => f.path)
    expect(paths).toContain('components/kit/SpotlightCard.tsx')
    expect(paths).toContain('components/kit/SpotlightCard.css')
    expect(paths).toContain('components/kit/CountUp.tsx')
    expect(paths).toContain('package.json')
    expect(paths).toContain('NOTICES.md')
    const pkg = JSON.parse(plan.engineFiles.find((f) => f.path === 'package.json')!.content) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['framer-motion']).toBe('12.26.2') // exact pin
    expect(pkg.dependencies['react']).toBe('^19.0.0')
    // React output is honestly labeled: no live preview.
    expect(plan.brief).toContain('NO live preview')
  })

  test('explicit selection wins: components are honored, unknown/not-installed ids ignored with a note', () => {
    const selection: FrontendSelection = {
      target: 'static',
      components: ['split-text', 'aurora', 'no-such-component'],
      background: 'none',
    }
    const plan = resolveFrontendPlan({ message: 'anything', selection })
    expect(plan.enabled).toBe(true)
    expect(plan.target).toBe('static')
    expect(plan.componentIds).toEqual(['split-text'])
    expect(plan.reason).toContain('no-such-component')
    expect(plan.vantaEffect).toBeNull()
  })

  test('explicit background attaches the vendored three.js + effect bundle (real, non-empty bytes)', () => {
    const plan = resolveFrontendPlan({
      message: 'Landing page with a hero',
      selection: { background: 'birds' },
    })
    expect(plan.vantaEffect).toBe('birds')
    const files = plan.engineFiles
    const three = files.find((f) => f.path === 'vendor/three.min.js')
    const bundle = files.find((f) => f.path === 'vendor/vanta.birds.min.js')
    expect(three?.content.length).toBeGreaterThan(100_000)
    expect(bundle?.content.length).toBeGreaterThan(10_000)
    expect(three?.content).toContain('Three.js Authors') // license banner inside the UMD build
    // The brief orders the script tags correctly.
    const t = plan.brief.indexOf('vendor/three.min.js')
    const b = plan.brief.indexOf('vendor/vanta.birds.min.js')
    expect(t).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(t)
  })

  test("background 'none' suppresses keyword detection; 'auto' maps request keywords to effects", () => {
    const none = resolveFrontendPlan({
      message: 'Build a landing page with birds flying in the background',
      selection: { background: 'none' },
    })
    expect(none.vantaEffect).toBeNull()
    const auto = resolveFrontendPlan({
      message: 'Build a landing page with birds in the background',
      selection: { background: 'auto' },
    })
    expect(auto.vantaEffect).toBe('birds')
  })

  test('brief is hard-capped at the budget', () => {
    const plan = resolveFrontendPlan({
      message: 'Build a huge landing page',
      selection: {
        components: ['split-text', 'text-type', 'blur-text', 'count-up', 'scroll-reveal'],
        animations: ['entrance-timeline', 'scroll-reveal-batch', 'text-reveal', 'hover-lift', 'svg-draw'],
        background: 'globe',
      },
    })
    expect(plan.brief.length).toBeLessThanOrEqual(FRONTEND_BRIEF_MAX_CHARS)
    if (plan.brief.length === FRONTEND_BRIEF_MAX_CHARS) {
      expect(plan.brief).toContain('truncated at the budget cap')
    }
  })

  test('background keyword detection is conservative (effect name only with background context)', () => {
    expect(detectBackgroundEffect('add a vanta background with waves')).toBe('waves')
    expect(detectBackgroundEffect('3d globe background for the hero')).toBe('globe')
    expect(detectBackgroundEffect('the birds argument in my javascript function is wrong')).toBeNull()
  })
})

describe('finalizeFrontendTurn (checks + summary, pure — no DB)', () => {
  const plan = resolveFrontendPlan({
    message: 'Landing page with hero',
    selection: { background: 'none' },
  })

  test('attaches the deterministic check report to the wire summary', () => {
    const files = [
      {
        path: 'index.html',
        content:
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="vendor/gsap.min.js"></script><script src="vendor/ScrollTrigger.min.js"></script></head><body><h1 data-animate>Hi</h1><section data-reveal>S</section><script src="app.js"></script></body></html>',
      },
      {
        path: 'styles.css',
        content: 'body { color: #eee } @media (max-width: 640px) { h1 { font-size: 2rem } }',
      },
      {
        path: 'app.js',
        content:
          "var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; if (!reduceMotion) { gsap.from('[data-animate]', {opacity:0}); gsap.registerPlugin(ScrollTrigger); ScrollTrigger.batch('[data-reveal]', {start:'top 85%', once:true, onEnter: function(b){ gsap.to(b,{opacity:1}) }}) }",
      },
    ]
    const result = finalizeFrontendTurn(files, plan)
    expect(result.enabled).toBe(true)
    expect(result.checks.passed).toBe(true)
    expect(result.checks.blocking).toBe(0)
    expect(result.engineFiles.length).toBeGreaterThan(0)
    expect(result.notices).toContain('React Bits')
  })

  test('validateFrontendOutput is exported through the engine (single import surface)', () => {
    expect(validateFrontendOutput).toBeTypeOf('function')
  })
})
