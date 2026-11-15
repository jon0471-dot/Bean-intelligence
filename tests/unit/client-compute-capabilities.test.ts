/**
 * Client compute — capability detection honesty tests.
 *
 * Verifies that detection never invents values and degrades honestly in
 * non-DOM environments (bun test = no window/document). A mocked minimal
 * DOM exercises the browser guards. These tests do NOT assert what a real
 * GPU reports — real-browser measurement is recorded separately in
 * docs/BEAN-CLIENT-COMPUTE-IMPLEMENTATION-REPORT.md.
 */
import { describe, test, expect } from 'bun:test'
import { detectCapabilities } from '@/lib/client-compute/capabilities'
import { deriveDeviceProfile } from '@/lib/client-compute/device-profile'

describe('client-compute capability detection', () => {
  test('non-DOM environment reports an honest non-browser snapshot', async () => {
    const snapshot = await detectCapabilities()
    expect(snapshot.environment).toBe('non-browser')
    expect(snapshot.webgpu.supported).toBe(false)
    expect(snapshot.webgpu.adapterAvailable).toBe(false)
    expect(snapshot.webgpu.adapterAvailable).not.toBe(true)
    expect(snapshot.webgl.maxTextureSize).toBeNull()
    expect(snapshot.workers).toBe(false)
    expect(snapshot.offscreenCanvas).toBe(false)
    expect(snapshot.sharedArrayBuffer).toBe(false)
    expect(snapshot.hardwareConcurrency).toBeNull()
    expect(snapshot.deviceMemoryGb).toBeNull()
    expect(snapshot.storage).toBeNull()
    expect(snapshot.browser.family).toBe('non-browser')
  })

  test('non-DOM snapshot derives Tier 0 (unsupported client compute)', async () => {
    const snapshot = await detectCapabilities()
    const profile = deriveDeviceProfile(snapshot)
    expect(profile.tier).toBe(0)
    expect(profile.conservative).toBe(true)
    expect(profile.tierReasons.length).toBeGreaterThan(0)
    expect(profile.tierReasons.some((r) => /no DOM environment/i.test(r))).toBe(true)
  })

  test('WASM probe is a REAL WebAssembly.validate result (never invented)', async () => {
    const snapshot = await detectCapabilities()
    // bun ships WebAssembly — the probe must reflect that truthfully.
    expect(snapshot.wasm.supported).toBe(typeof WebAssembly !== 'undefined')
    expect([true, false, null]).toContain(snapshot.wasm.simd)
  })

  test('minimal DOM stub: browser path runs all guards without crashing', async () => {
    // Minimal document/window stubs — no WebGL context, no navigator.gpu.
    const canvasStub = {
      width: 0,
      height: 0,
      getContext: () => null, // no GPU contexts at all
    }
    const docStub = {
      createElement: (tag: string) => (tag === 'canvas' ? canvasStub : {}),
      visibilityState: 'visible',
    }
    const nav = {
      userAgent: 'TestRunner/1.0',
      hardwareConcurrency: 8,
    }
    const originalDoc = (globalThis as Record<string, unknown>).document
    const originalWindow = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).document = docStub
    ;(globalThis as Record<string, unknown>).window = { localStorage: null }
    ;(globalThis as Record<string, unknown>).navigator = nav
    ;(globalThis as Record<string, unknown>).isSecureContext = true
    try {
      const snapshot = await detectCapabilities()
      expect(snapshot.environment).toBe('browser')
      expect(snapshot.webgpu.supported).toBe(false)
      expect(snapshot.webgl.webgl2).toBe(false)
      expect(snapshot.webgl.webgl1).toBe(false)
      expect(snapshot.webgl.maxTextureSize).toBeNull()
      expect(snapshot.hardwareConcurrency).toBe(8) // reported verbatim
      expect(snapshot.browser.family).toBe('Unknown')
      // Tier: WASM + Workers only → Tier 1 (no GPU lane)
      const profile = deriveDeviceProfile(snapshot)
      expect(profile.tier).toBeGreaterThanOrEqual(1)
    } finally {
      ;(globalThis as Record<string, unknown>).document = originalDoc
      ;(globalThis as Record<string, unknown>).window = originalWindow
      delete (globalThis as Record<string, unknown>).navigator
      delete (globalThis as Record<string, unknown>).isSecureContext
    }
  })
})
