/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: GSAP animation engine
 * (Phase 2 — patterns, reduced-motion discipline, React lifecycle cleanup;
 * expanded to the full free GSAP 3.13 plugin set).
 */
import { describe, test, expect } from 'bun:test'
import { existsSync } from 'fs'
import path from 'path'
import {
  GSAP_PATTERNS,
  DEFAULT_ANIMATION_IDS,
  STATIC_PATTERN_CODE,
  REACT_PATTERN_CODE,
  buildAnimationsBrief,
  getAnimation,
  patternCode,
  requiredPluginBuilds,
  PATTERN_PLUGIN_BUILDS,
  GSAP_PLUGIN_ORDER,
  REDUCED_MOTION_MARKER,
} from '../../src/lib/frontend-intel/gsap-patterns'
import { GSAP_PLUGIN_FILES } from '../../src/lib/frontend-intel/vendor'

const NODE_MODULES = path.join(import.meta.dir, '../../node_modules')

/** Patterns that create non-tween handles in React and therefore MUST return
 *  an explicit cleanup (context revert alone does not kill them). */
const REQUIRES_EXPLICIT_REACT_CLEANUP = ['split-text', 'draggable', 'observer', 'scroll-scrub']

describe('GSAP animation patterns registry (expanded plugin set)', () => {
  test('ships the full 15-pattern library for BOTH targets', () => {
    expect(GSAP_PATTERNS.map((p) => p.id).sort()).toEqual(
      [
        'entrance-timeline',
        'hover-lift',
        'scroll-reveal-batch',
        'svg-draw',
        'text-reveal',
        'split-text',
        'morph-svg',
        'motion-path',
        'flip',
        'draggable',
        'observer',
        'custom-ease',
        'scroll-scrub',
        'draw-svg',
        'scramble-text',
      ].sort(),
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

  test('every plugin a pattern requires is a real, free dist build inside the installed gsap package', () => {
    for (const [id, plugins] of Object.entries(PATTERN_PLUGIN_BUILDS)) {
      for (const plugin of plugins) {
        const spec = GSAP_PLUGIN_FILES[plugin]
        expect(spec, `${id} requires unknown plugin build ${plugin}`).toBeTruthy()
        expect(existsSync(path.join(NODE_MODULES, spec!.source)), `${plugin}.min.js missing from node_modules`).toBe(true)
      }
    }
    // The official formerly-premium plugins the work order names are all present.
    for (const plugin of ['SplitText', 'MorphSVGPlugin', 'MotionPathPlugin', 'Flip', 'Draggable', 'Observer', 'CustomEase', 'DrawSVGPlugin', 'ScrambleTextPlugin']) {
      expect((GSAP_PLUGIN_ORDER as readonly string[])).toContain(plugin)
      expect(existsSync(path.join(NODE_MODULES, `gsap/dist/${plugin}.min.js`)), `${plugin} dist build missing`).toBe(true)
    }
  })

  test('requiredPluginBuilds derives the canonical vendor set from selected patterns', () => {
    expect(requiredPluginBuilds(['entrance-timeline'])).toEqual([])
    expect(requiredPluginBuilds(['scroll-reveal-batch'])).toEqual(['ScrollTrigger'])
    expect(requiredPluginBuilds(['split-text', 'draggable'])).toEqual(['SplitText', 'Draggable'])
    expect(requiredPluginBuilds(['draw-svg'])).toEqual(['ScrollTrigger', 'DrawSVGPlugin'])
    expect(requiredPluginBuilds(['made-up'])).toEqual([])
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
    // Non-tween handles return an explicit cleanup function.
    for (const id of REQUIRES_EXPLICIT_REACT_CLEANUP) {
      expect(REACT_PATTERN_CODE[id], `${id} must return an explicit cleanup`).toContain('return () =>')
    }
  })

  test('the auto/default set is intentionally minimal (never every pattern)', () => {
    expect(DEFAULT_ANIMATION_IDS).toEqual(['entrance-timeline', 'scroll-reveal-batch'])
    expect(DEFAULT_ANIMATION_IDS.length).toBeLessThan(GSAP_PATTERNS.length)
  })

  test('getAnimation resolves ids and rejects unknown ones', () => {
    expect(getAnimation('entrance-timeline')?.requires).toContain('gsap')
    expect(getAnimation('split-text')?.requires).toEqual(['gsap', 'SplitText'])
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
