/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: Vanta background engine
 * (Phase 3 — 7 effects, lifecycle contract, fallbacks, per-effect options).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
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

const REQUIRED_EFFECTS = ['birds', 'waves', 'net', 'globe', 'fog', 'clouds', 'rings']

describe('Vanta background engine registry', () => {
  test('registers exactly the seven required effects, each needing three.js + its own bundle', () => {
    expect(VANTA_EFFECTS.map((e) => e.id).sort()).toEqual([...REQUIRED_EFFECTS].sort())
    for (const e of VANTA_EFFECTS) {
      expect(e.vendorFiles).toEqual(['vendor/three.min.js', `vendor/vanta.${e.id}.min.js`])
    }
    for (const id of REQUIRED_EFFECTS) expect(getVantaEffect(id)).toBeTruthy()
    expect(getVantaEffect('halo')).toBeUndefined()
  })

  test('the vendored effect bundles actually exist in the pinned vanta package', () => {
    const dist = path.join(import.meta.dir, '../../node_modules/vanta/dist')
    for (const id of REQUIRED_EFFECTS) {
      expect(existsSync(path.join(dist, `vanta.${id}.min.js`)), `vanta.${id}.min.js missing`).toBe(true)
    }
    expect(existsSync(path.join(import.meta.dir, '../../node_modules/three/build/three.min.js'))).toBe(true)
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
    // universal knobs
    expect(birds.mouseControls).toBe(true)
    expect(birds.touchControls).toBe(true)
    expect(birds.gyroControls).toBe(false)
    expect(birds.backgroundColor).toBe('#0b0d12')
  })

  describe('STATIC template contract', () => {
    const template = buildStaticVantaTemplate('birds', DEFAULT_VANTA_CONFIG)

    test('initializes only after DOM readiness and destroys before re-init (single renderer)', () => {
      expect(template).toContain("document.getElementById('vanta-bg')")
      expect(template).toContain('window.__beanVanta.destroy()')
      expect(template).toContain('VANTA.BIRDS')
      expect(template).toContain("window.addEventListener('pagehide'")
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
    test('lazy-loads one static specifier per effect and destroys on unmount', () => {
      for (const id of REQUIRED_EFFECTS) {
        expect(VANTA_REACT_COMPONENT_SOURCE).toContain(`vanta/dist/vanta.${id}.min.js`)
      }
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('instanceRef.current.destroy()')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('EFFECT_LOADERS[effect]')
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain("await import('three')")
      // Vanta's global effect keys are ALL-UPPERCASE (VANTA.BIRDS, …).
      expect(VANTA_REACT_COMPONENT_SOURCE).toContain('VANTA[effect.toUpperCase()]')
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

  test('brief builder emits the vendor script order (three BEFORE the effect bundle) for static output', () => {
    const brief = buildVantaBrief('static', 'birds', DEFAULT_VANTA_CONFIG)
    const threeIdx = brief.indexOf('vendor/three.min.js')
    const birdsIdx = brief.indexOf('vendor/vanta.birds.min.js')
    expect(threeIdx).toBeGreaterThan(-1)
    expect(birdsIdx).toBeGreaterThan(threeIdx)
    expect(brief).toContain('prefers-reduced-motion')
    const reactBrief = buildVantaBrief('react', 'net', DEFAULT_VANTA_CONFIG)
    expect(reactBrief).toContain("import VantaBackground from './components/kit/VantaBackground'")
    expect(reactBrief).toContain('Do NOT call VANTA.* yourself')
  })
})
