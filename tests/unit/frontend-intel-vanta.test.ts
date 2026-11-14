/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: Vanta background engine
 * (Phase 3 — lifecycle contract, fallbacks, per-effect options; expanded to
 * all compatible effects in the pinned vanta package, including the p5-based
 * ones, with the incompatible effect honestly excluded).
 */
import { describe, test, expect } from 'bun:test'
import { existsSync } from 'fs'
import path from 'path'
import {
  VANTA_EFFECTS,
  DEFAULT_VANTA_CONFIG,
  buildStaticVantaTemplate,
  buildVantaBrief,
  getVantaEffect,
  vantaOptionsFor,
  VANTA_REACT_COMPONENT_SOURCE,
  VANTA_AMBIENT_TYPES_SOURCE,
  VANTA_FALLBACK_CSS,
} from '../../src/lib/frontend-intel/vanta'
import { VANTA_P5_EFFECTS } from '../../src/lib/frontend-intel/vendor'

/** All 13 compatible effects: the original 7 + cells/dots/halo/ripple (three)
 *  + trunk/topology (p5). clouds2 is deliberately NOT here (external texture). */
const ALL_EFFECTS = [
  'birds', 'waves', 'net', 'globe', 'fog', 'clouds', 'rings',
  'cells', 'dots', 'halo', 'ripple', 'trunk', 'topology',
]
const P5_EFFECTS = ['trunk', 'topology']

describe('Vanta background engine registry (expanded)', () => {
  test('registers exactly the 13 compatible effects with correct runtime bundles', () => {
    expect(VANTA_EFFECTS.map((e) => e.id).sort()).toEqual([...ALL_EFFECTS].sort())
    for (const e of VANTA_EFFECTS) {
      const runtime = VANTA_P5_EFFECTS.has(e.id) ? 'vendor/p5.min.js' : 'vendor/three.min.js'
      expect(e.vendorFiles, `${e.id} vendor files`).toEqual([runtime, `vendor/vanta.${e.id}.min.js`])
    }
    for (const id of ALL_EFFECTS) expect(getVantaEffect(id)).toBeTruthy()
  })

  test('clouds2 is honestly excluded: it needs an external texture that cannot be vendored offline', () => {
    expect(getVantaEffect('clouds2')).toBeUndefined()
    // The vanta package does not ship the texture it fetches at runtime.
    expect(existsSync(path.join(import.meta.dir, '../../node_modules/vanta/gallery/noise.png'))).toBe(false)
    // The p5-based effects are p5-based in the real sources (verified there).
    expect(VANTA_P5_EFFECTS.has('trunk')).toBe(true)
    expect(VANTA_P5_EFFECTS.has('topology')).toBe(true)
  })

  test('the vendored effect bundles + both runtimes actually exist on disk', () => {
    const dist = path.join(import.meta.dir, '../../node_modules/vanta/dist')
    for (const id of ALL_EFFECTS) {
      expect(existsSync(path.join(dist, `vanta.${id}.min.js`)), `vanta.${id}.min.js missing`).toBe(true)
    }
    expect(existsSync(path.join(import.meta.dir, '../../node_modules/three/build/three.min.js'))).toBe(true)
    // p5.js 0.6.1 ships INSIDE the vanta package — the exact build Vanta renders with.
    expect(existsSync(path.join(import.meta.dir, '../../node_modules/vanta/vendor/p5.min.js'))).toBe(true)
  })

  test('per-effect option mapping follows Vanta option names and whitelists speed/zoom', () => {
    const birds = vantaOptionsFor('birds', DEFAULT_VANTA_CONFIG)
    expect(birds.color1).toBe('#d4af37')
    expect(birds.color2).toBe('#8a6d1f')
    expect(birds.speed).toBe(1)
    expect('zoom' in birds).toBe(false) // birds has no documented zoom
    const waves = vantaOptionsFor('waves', { ...DEFAULT_VANTA_CONFIG, speed: 1.5, zoom: 1.2 })
    expect(waves.color).toBe('#d4af37')
    expect(waves.speed).toBe(1.5)
    expect(waves.zoom).toBe(1.2)
    const net = vantaOptionsFor('net', DEFAULT_VANTA_CONFIG)
    expect(net.color).toBe('#d4af37')
    expect('speed' in net).toBe(false)
    // New effects follow their own documented option keys.
    const cells = vantaOptionsFor('cells', DEFAULT_VANTA_CONFIG)
    expect(cells.color1).toBe('#d4af37')
    expect(cells.color2).toBe('#8a6d1f')
    expect(cells.speed).toBe(1)
    const halo = vantaOptionsFor('halo', DEFAULT_VANTA_CONFIG)
    expect(halo.baseColor).toBe('#d4af37')
    expect(halo.color2).toBe('#8a6d1f')
    expect(halo.speed).toBe(1)
    const ripple = vantaOptionsFor('ripple', DEFAULT_VANTA_CONFIG)
    expect(ripple.color1).toBe('#d4af37')
    expect(ripple.speed).toBe(1)
    const trunk = vantaOptionsFor('trunk', DEFAULT_VANTA_CONFIG)
    expect(trunk.color).toBe('#d4af37')
    expect('speed' in trunk).toBe(false)
    // universal knobs
    expect(birds.mouseControls).toBe(true)
    expect(birds.touchControls).toBe(true)
    expect(birds.gyroControls).toBe(false)
    expect(birds.backgroundColor).toBe('#0b0d12')
  })

  describe('STATIC template contract', () => {
    const template = buildStaticVantaTemplate('birds', DEFAULT_VANTA_CONFIG)
    const trunkTemplate = buildStaticVantaTemplate('trunk', DEFAULT_VANTA_CONFIG)

    test('initializes only after DOM readiness and destroys before re-init (single renderer)', () => {
      expect(template).toContain("document.getElementById('vanta-bg')")
      expect(template).toContain('window.__beanVanta.destroy()')
      expect(template).toContain('VANTA.BIRDS')
      expect(template).toContain("window.addEventListener('pagehide'")
    })

    test('guards the CORRECT runtime per effect family (THREE vs p5)', () => {
      expect(template).toContain('!window.THREE')
      expect(trunkTemplate).toContain('!window.p5')
      expect(trunkTemplate).toContain('VANTA.TRUNK')
      // p5-based effects pass the p5 constructor, not THREE, and skip the
      // WebGL probe (p5 renders without WebGL).
      expect(trunkTemplate).toContain('p5: window.p5')
      expect(trunkTemplate).not.toContain('THREE: window.THREE')
      expect(trunkTemplate).not.toContain('getContext(')
      expect(template).toContain('getContext(')
    })

    test('falls back to a static gradient when WebGL is unavailable', () => {
      expect(template).toContain('WebGLRenderingContext')
      expect(template).toContain('vanta-fallback')
      expect(VANTA_FALLBACK_CSS).toContain('linear-gradient')
    })

    test('respects reduced motion BEFORE any renderer is created', () => {
      const guardIdx = template.indexOf('prefers-reduced-motion')
      const initIdx = template.indexOf('VANTA.BIRDS')
      expect(guardIdx).toBeGreaterThan(-1)
      expect(guardIdx).toBeLessThan(initIdx)
    })

    test('embeds the exact effect options (deterministic JSON)', () => {
      expect(template).toContain('"backgroundColor":"#0b0d12"')
      expect(template).toContain('"color1":"#d4af37"')
    })
  })

  describe('REACT component contract', () => {
    test('lazy-loads one static specifier per effect (all 13) and destroys on unmount', () => {
      for (const id of ALL_EFFECTS) {
        expect(VANTA_REACT_COMPONENT_SOURCE).toContain(`vanta/dist/vanta.${id}.min.js`)
      }
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('instanceRef.current.destroy()')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('EFFECT_LOADERS[effect]')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain("await import('three')")
      // Vanta's global effect keys are ALL-UPPERCASE (VANTA.BIRDS, …).
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('VANTA[effect.toUpperCase()]')
      // p5-based effects import p5 and pass the constructor explicitly
      // (bundlers do not set window.p5); three.js effects pass THREE.
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain("const P5 = isP5 ? await import('p5') : undefined")
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('p5: isP5 ? ((P5 as { default?: unknown }).default ?? P5) : undefined')
    })

    test('guards reduced motion + WebGL with an honest fallback, keeps children accessible', () => {
      const rmIdx = VANTA_REACT_COMPONENT_SOURCE.indexOf('prefers-reduced-motion')
      const loadIdx = VANTA_REACT_COMPONENT_SOURCE.indexOf('EFFECT_LOADERS[effect]')
      expect(rmIdx).toBeGreaterThan(-1)
      expect(rmIdx).toBeLessThan(loadIdx)
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('WebGLRenderingContext')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('setFallback(true)')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('aria-hidden="true"')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('zIndex: 1')
    })

    test('ambient type declaration covers all effect bundle specifiers', () => {
      expect(VANTA_AMBIENT_TYPES_SOURCE).toContain("declare module 'vanta/dist/*'")
    })
  })

  test('brief builder emits the vendor script order (runtime BEFORE the effect bundle) for static output', () => {
    const brief = buildVantaBrief('static', 'birds', DEFAULT_VANTA_CONFIG)
    const threeIdx = brief.indexOf('vendor/three.min.js')
    const birdsIdx = brief.indexOf('vendor/vanta.birds.min.js')
    expect(threeIdx).toBeGreaterThan(-1)
    expect(birdsIdx).toBeGreaterThan(threeIdx)
    expect(brief).toContain('prefers-reduced-motion')
    // p5-based effect: p5 runtime ordered before its bundle.
    const trunkBrief = buildVantaBrief('static', 'trunk', DEFAULT_VANTA_CONFIG)
    const p5Idx = trunkBrief.indexOf('vendor/p5.min.js')
    const trunkIdx = trunkBrief.indexOf('vendor/vanta.trunk.min.js')
    expect(p5Idx).toBeGreaterThan(-1)
    expect(trunkIdx).toBeGreaterThan(p5Idx)
    const reactBrief = buildVantaBrief('react', 'net', DEFAULT_VANTA_CONFIG)
    expect(reactBrief).toContain("import VantaBackground from './components/kit/VantaBackground'")
    expect(reactBrief).toContain('Do NOT call VANTA.* yourself')
  })
})
