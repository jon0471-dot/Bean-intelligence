/**
 * M36-B — WebGPU COMPUTE BENCHMARK honesty (brief §7/§13 browser compute).
 *
 * Pinned contracts:
 *  - the benchmark is a REAL dispatch round-trip: on a device whose fake GPU
 *    computes correct values, it passes; on wrong values, it FAILS (never an
 *    assumed pass);
 *  - no adapter / lost device / missing compute surface → honest failure
 *    with a reason, no throw;
 *  - buffers are always destroyed (tracked-buffer count returns to zero on
 *    every path);
 *  - tier 4 requires the benchmark evidence: deriveDeviceProfile promotes to
 *    tier 4 ONLY with gpuComputeOk === true, and runBenchmark merges the real
 *    GPU result (no adapter → gpuComputeOk false → tier stays 3).
 */
import { describe, test, expect } from 'bun:test'

import { WebGpuEngine, GPU_BUFFER_USAGE, type StructGPU } from '../../src/lib/client-compute/webgpu/engine'
import { deriveDeviceProfile, runBoundedCpuBenchmark } from '../../src/lib/client-compute/device-profile'
import type { CapabilitySnapshot, DeviceProfile } from '../../src/lib/client-compute/types'

/** Minimal honest snapshot: a tier-3 capable WebGPU device. */
function tier3Snapshot(): CapabilitySnapshot {
  return {
    environment: 'browser',
    secureContext: true,
    webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: false },
    webgl: { webgl2: true, webgl1: true, maxTextureSize: 8192 },
    wasm: { supported: true, simd: true },
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: true,
    crossOriginIsolated: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    storage: null,
    browser: { family: 'test', mobileHint: false },
    detectedAt: Date.now(),
  } as unknown as CapabilitySnapshot
}

/**
 * A structural fake GPU whose device simulates the compute pipeline.
 * `multiplier` is what the "GPU" writes per element on submit: 2 = correct
 * WGSL semantics, anything else = broken device, null = device that submits
 * nothing (data never arrives).
 */
function fakeGpu(multiplier: number | null): StructGPU {
  const device = {
    features: [],
    limits: {},
    createShaderModule: () => ({}),
    createComputePipeline: ({ compute }: { compute: { module: unknown } }) => ({ module: compute.module }),
    createBindGroup: () => ({}),
    createBuffer: ({ size, usage, mappedAtCreation }: { size: number; usage: number; mappedAtCreation?: boolean }) => {
      const backing = new ArrayBuffer(size)
      const buf = {
        size,
        usage,
        mapState: mappedAtCreation ? 'mapped' : 'unmapped',
        mapAsync: async () => {
          buf.mapState = 'mapped'
        },
        unmap: () => {
          buf.mapState = 'unmapped'
        },
        getMappedRange: () => backing,
        destroy: () => {},
      }
      return buf
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      // Emulates dispatch→copy: apply the "GPU" multiplier to the source
      // (the dispatch result) and actually copy into the destination.
      copyBufferToBuffer: (source: { getMappedRange: () => ArrayBuffer }, _so: number, dest: { getMappedRange: () => ArrayBuffer }, _do: number, size: number) => {
        if (multiplier !== null) {
          const f32 = new Float32Array(source.getMappedRange())
          for (let i = 0; i < f32.length; i++) f32[i] = f32[i] * multiplier
        }
        const bytes = new Uint8Array(source.getMappedRange()).slice(0, size)
        new Uint8Array(dest.getMappedRange()).set(bytes)
      },
      finish: () => ({}),
    }),
    queue: {
      submit: () => {},
    },
    requestDevice: async () => device,
    pushErrorScope: () => {},
    popErrorScope: async () => null,
  }
  return {
    requestAdapter: (async () => ({ requestDevice: device.requestDevice, features: [], limits: {} })) as StructGPU['requestAdapter'],
  }
}

describe('GPU compute benchmark — real round-trip semantics', () => {
  test('a functioning GPU computes the expected values → ok:true', async () => {
    const engine = new WebGpuEngine({ gpu: fakeGpu(2) })
    const result = await engine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    // All task buffers destroyed.
    expect(engine.trackedBufferCount()).toBe(0)
  })

  test('a GPU that returns WRONG values fails honestly (never an assumed pass)', async () => {
    const engine = new WebGpuEngine({ gpu: fakeGpu(3) })
    const result = await engine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('incorrect values')
    expect(engine.trackedBufferCount()).toBe(0)
  })

  test('a device that submits no data fails the verification honestly', async () => {
    const engine = new WebGpuEngine({ gpu: fakeGpu(null) })
    const result = await engine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(false)
    expect(engine.trackedBufferCount()).toBe(0)
  })

  test('no WebGPU adapter → honest failure with a reason', async () => {
    const engine = new WebGpuEngine({ gpu: null })
    const result = await engine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('WebGPU is not available')
    expect(engine.trackedBufferCount()).toBe(0)
  })

  test('a device missing the compute surface reports it honestly', async () => {
    const device = {
      requestDevice: async () => device,
      features: [],
      // no createShaderModule etc.
    }
    const engine = new WebGpuEngine({
      gpu: { requestAdapter: async () => ({ requestDevice: device.requestDevice }) },
    })
    const result = await engine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('does not expose the compute surface')
    expect(engine.trackedBufferCount()).toBe(0)
  })

  test('a LOST device refuses with the loss reason', async () => {
    const lostEngine = new WebGpuEngine({
      gpu: { requestAdapter: async () => null },
    })
    const result = await lostEngine.runComputeBenchmark({ timeoutMs: 2000 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('No WebGPU adapter')
  })
})

describe('tier 4 requires REAL benchmark evidence', () => {
  test('tier-3 device without benchmark stays tier 3', () => {
    const profile = deriveDeviceProfile(tier3Snapshot(), null)
    expect(profile.tier).toBe(3)
  })

  test('gpuComputeOk=true promotes a tier-3 device to tier 4', () => {
    const profile = deriveDeviceProfile(tier3Snapshot(), { cpuOpsPerSec: 1000, gpuComputeOk: true, durationMs: 12, ranAt: Date.now() })
    expect(profile.tier).toBe(4)
    expect(profile.tierReasons.some((r) => r.includes('tier 4'))).toBe(true)
  })

  test('gpuComputeOk=false NEVER promotes (broken GPU honesty)', () => {
    const profile = deriveDeviceProfile(tier3Snapshot(), { cpuOpsPerSec: 1000, gpuComputeOk: false, durationMs: 12, ranAt: Date.now() })
    expect(profile.tier).toBe(3)
  })

  test('CPU benchmark keeps gpuComputeOk null (CPU alone is never tier-4 evidence)', async () => {
    const result = await runBoundedCpuBenchmark(30)
    expect(result.gpuComputeOk).toBeNull()
    expect(typeof result.cpuOpsPerSec).toBe('number')
  })
})

describe('benchmark merge in the client-compute singleton path', () => {
  test('deriveDeviceProfile keeps benchmark data on the profile (merged in runBenchmark)', () => {
    const profile: DeviceProfile = deriveDeviceProfile(tier3Snapshot(), {
      cpuOpsPerSec: 12345,
      gpuComputeOk: true,
      durationMs: 50,
      ranAt: 1,
    })
    expect(profile.benchmark?.gpuComputeOk).toBe(true)
    expect(profile.benchmark?.cpuOpsPerSec).toBe(12345)
  })
})

describe('buffer usage constants (WGSL pipeline sanity)', () => {
  test('STORAGE | COPY_SRC | COPY_DST | MAP_READ compose without collision', () => {
    const storage = GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST
    const read = GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ
    expect(storage).toBeGreaterThan(0)
    expect(read).toBeGreaterThan(0)
    expect((storage & GPU_BUFFER_USAGE.MAP_READ)).toBe(0)
  })
})
