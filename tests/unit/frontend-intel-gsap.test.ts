/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: GSAP animation engine
 * (Phase 2 — patterns, reduced-motion discipline, React lifecycle cleanup).
 */
import { describe, test, expect } from 'bun:test'
import {
  GSAP_PATTERNS,
  DEFAULT_ANIMATION_IDS,
  STATIC_PATTERN_CODE,
  REACT_PATTERN_CODE,
  buildAnimationsBrief,
  getAnimation,
  patternCode,
  REDUCED_MOTION_MARKER,
} from '../../src/lib/frontend-intel/gsap-patterns'

describe('GSAP animation patterns registry', () => {
  test('ships the five reusable patterns for BOTH targets', () => {
    expect(GSAP_PATTERNS.map((p) => p.id).sort()).toEqual(
      ['entrance-timeline', 'hover-lift', 'scroll-reveal-batch', 'svg-draw', 'text-reveal'].sort(),
    )
    for (const p of GSAP_PATTERNS) {
      for (const target of p.targets) {
        expect(patternCode(p.id, target), `${p.id} missing ${target} code`).toBeTruthy()
      }
    }
  })

  test('every STATIC pattern guards prefers-reduced-motion and never hides content unconditionally', () => {
    for (const [id, code] of Object.entries(STATIC_PATTERN_CODE)) {
      expect(code.includes(REDUCED_MOTION_MARKER), `${id} missing reduced-motion guard`).toBe(true)
      expect(code.includes('reduceMotion'), `${id} guard not consulted`).toBe(true)
    }
  })

  test('every REACT pattern uses the official useGSAP integration with scoped cleanup', () => {
    for (const [id, code] of Object.entries(REACT_PATTERN_CODE)) {
      expect(code.includes('useGSAP('), `${id} missing official useGSAP integration`).toBe(true)
      expect(code.includes('{ scope'), `${id} missing scope binding`).toBe(true)
      expect(code.includes(REDUCED_MOTION_MARKER), `${id} missing reduced-motion guard`).toBe(true)
    }
    // ScrollTrigger-based react patterns register the plugin INSIDE the
    // useGSAP-scoped setup with dependencies so revert cleans them up.
    expect(REACT_PATTERN_CODE['scroll-reveal-batch']).toContain('dependencies: [ScrollTrigger]')
    expect(REACT_PATTERN_CODE['svg-draw']).toContain('dependencies: [ScrollTrigger]')
  })

  test('the auto/default set is intentionally minimal (never every pattern)', () => {
    expect(DEFAULT_ANIMATION_IDS).toEqual(['entrance-timeline', 'scroll-reveal-batch'])
    expect(DEFAULT_ANIMATION_IDS.length).toBeLessThan(GSAP_PATTERNS.length)
  })

  test('getAnimation resolves ids and rejects unknown ones', () => {
    expect(getAnimation('entrance-timeline')?.requires).toContain('gsap')
    expect(getAnimation('made-up')).toBeUndefined()
  })

  test('brief builder renders selected patterns and stays silent on empty selection', () => {
    const brief = buildAnimationsBrief('static', ['entrance-timeline', 'text-reveal'])
    expect(brief).toContain('GSAP ANIMATION PATTERNS')
    expect(brief).toContain('entrance-timeline')
    expect(brief).toContain('prefers-reduced-motion')
    expect(buildAnimationsBrief('static', [])).toBe('')
    expect(buildAnimationsBrief('static', ['made-up'])).toBe('')
  })
})
