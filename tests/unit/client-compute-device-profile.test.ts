/**
 * Client compute — device profile / tier derivation matrix.
 * Tiers are derived ONLY from the measured snapshot + optional benchmark.
 */
import { describe, test, expect } from 'bun:test'
import { deriveDeviceProfile } from '@/lib/client-compute/device-profile'
import type { BenchmarkResult, CapabilitySnapshot } from '@/lib/client-compute/types'

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    environment: 'browser',
    secureContext: true,
    webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
    webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
    wasm: { supported: true, simd: true },
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    hardwareConcurrency: 8,
    deviceMemoryGb: null,
    storage: null,
    browser: { family: 'Test', mobileHint: false },
    detectedAt: Date.now(),
    ...overrides,
  }
}

describe('client-compute device tiers', () => {
  test('non-browser → Tier 0', () => {
    const p = deriveDeviceProfile({ ...snapshot(), environment: 'non-browser' })
    expect(p.tier).toBe(0)
    expect(p.conservative).toBe(true)
  })

  test('nothing at all → Tier 0', () => {
    const p = deriveDeviceProfile(
      snapshot({
        wasm: { supported: false, simd: null },
        workers: false,
      }),
    )
    expect(p.tier).toBe(0)
  })

  test('WASM + Workers only → Tier 1 (basic CPU/WASM)', () => {
    const p = deriveDeviceProfile(snapshot())
    expect(p.tier).toBe(1)
    expect(p.tierReasons.join(' ')).toMatch(/WASM/)
  })

  test('WebGL2 present → Tier 2 (graphics lane only)', () => {
    const p = deriveDeviceProfile(snapshot({ webgl: { webgl2: true, webgl1: false, maxTextureSize: 8192 } }))
    expect(p.tier).toBe(2)
    expect(p.tierReasons.join(' ')).toMatch(/WebGL 2/)
  })

  test('WebGPU API without adapter → capped at Tier 2 (honest)', () => {
    const p = deriveDeviceProfile(snapshot({ webgpu: { supported: true, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null } }))
    expect(p.tier).toBe(2)
    expect(p.tierReasons.join(' ')).toMatch(/no adapter/)
  })

  test('WebGPU adapter → Tier 3 (capable WebGPU device)', () => {
    const p = deriveDeviceProfile(
      snapshot({
        webgpu: { supported: true, adapterAvailable: true, features: ['shader-f16'], limits: { maxComputeWorkgroupSizeX: 1024 }, fallbackAdapter: false },
      }),
    )
    expect(p.tier).toBe(3)
  })

  test('Tier 4 requires a REAL measured GPU compute round-trip', () => {
    const base = snapshot({
      webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: false },
    })
    const noBenchmark = deriveDeviceProfile(base, null)
    expect(noBenchmark.tier).toBe(3)
    const cpuOnlyBenchmark: BenchmarkResult = { cpuOpsPerSec: 100_000_000, gpuComputeOk: null, durationMs: 10, ranAt: Date.now() }
    expect(deriveDeviceProfile(base, cpuOnlyBenchmark).tier).toBe(3)
    const gpuOk: BenchmarkResult = { cpuOpsPerSec: 100_000_000, gpuComputeOk: true, durationMs: 12, ranAt: Date.now() }
    const p4 = deriveDeviceProfile(base, gpuOk)
    expect(p4.tier).toBe(4)
    expect(p4.tierReasons.join(' ')).toMatch(/round-trip/)
  })

  test('conservative mode: mobile hint, low memory bucket, insecure context, software adapter', () => {
    expect(deriveDeviceProfile(snapshot({ browser: { family: 'Test', mobileHint: true } })).conservative).toBe(true)
    expect(deriveDeviceProfile(snapshot({ deviceMemoryGb: 2 })).conservative).toBe(true)
    expect(deriveDeviceProfile(snapshot({ secureContext: false })).conservative).toBe(true)
    expect(
      deriveDeviceProfile(
        snapshot({ webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: true } }),
      ).conservative,
    ).toBe(true)
    // A healthy desktop-class snapshot is NOT conservative.
    expect(deriveDeviceProfile(snapshot({ deviceMemoryGb: 8 })).conservative).toBe(false)
  })

  test('tier reasons always cite real checks (derivation trail is honest)', () => {
    const p = deriveDeviceProfile(snapshot())
    expect(p.tierReasons.length).toBeGreaterThan(0)
    for (const reason of p.tierReasons) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(3)
    }
  })
})
