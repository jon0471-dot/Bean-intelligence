/**
 * Client compute — product adapters, kernels and validators.
 *
 * Covers: preprocess math correctness, chroma-cutout behavior (port of the
 * LAXII deterministic stage), the CODE GIFTZ analysis kernel, built-in
 * output validators, the JAZMII bounds parity against the SERVER module
 * (source-of-truth regex check), adapter kind metadata, GPU compatibility
 * registry honesty, and one end-to-end LAXII preprocess flow through the
 * scheduler with injected decode/encode + a protocol-faithful fake worker.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { preprocessImageKernel, chromaCutoutKernel } from '@/lib/client-compute/adapters/image-kernels'
import { codeAnalysisKernel } from '@/lib/client-compute/adapters/code-giftz'
import { buildLaxiiKinds, PREPROCESS_KIND, SEGMENTATION_KIND, scheduleImagePreprocess } from '@/lib/client-compute/adapters/laxii'
import { registerImageDecoder, registerImageEncoder } from '@/lib/client-compute/adapters/image-io'
import { JAZMII_REFERENCE_BOUNDS, buildJazmiiKinds } from '@/lib/client-compute/adapters/jazmii'
import { checkGpuOperationSupport } from '@/lib/client-compute/webgpu/compatibility'
import { validateOutput } from '@/lib/client-compute/validate'
import { getClientCompute } from '@/lib/client-compute'
import { setConsent } from '@/lib/client-compute/privacy'
import { CpuEngine } from '@/lib/client-compute/cpu/engine'
import { ComputeScheduler } from '@/lib/client-compute/scheduler'
import { ResourceManager } from '@/lib/client-compute/resource-manager'
import type { CapabilitySnapshot, RegisteredTaskKind } from '@/lib/client-compute/types'

beforeEach(() => {
  registerImageDecoder(null)
  registerImageEncoder(null)
  setConsent(false, false)
})

describe('image kernels (deterministic math)', () => {
  test('preprocessImageKernel downscales correctly and never upscales', () => {
    // 4x4 gradient, downscale to 2x2.
    const w = 4
    const h = 4
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        pixels[i] = x * 60
        pixels[i + 1] = y * 60
        pixels[i + 2] = 100
        pixels[i + 3] = 255
      }
    }
    const out = preprocessImageKernel({ pixels, width: w, height: h, maxWidth: 2, maxHeight: 2 })
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(out.scaleApplied).toBeCloseTo(0.5, 10)
    expect(out.originalWidth).toBe(4)
    // Corner value interpolation stays within the source range.
    const outFirst = out.pixels[0]
    expect(outFirst).toBeGreaterThanOrEqual(0)
    expect(outFirst).toBeLessThanOrEqual(60)
    // No upscale.
    const bigger = preprocessImageKernel({ pixels, width: 4, height: 4, maxWidth: 100, maxHeight: 100 })
    expect(bigger.width).toBe(4)
    expect(bigger.scaleApplied).toBe(1)
  })

  test('chromaCutoutKernel: green border keyed out, object interior kept', () => {
    const w = 32
    const h = 32
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const isCenter = x > 8 && x < 24 && y > 8 && y < 24
        if (isCenter) {
          pixels[i] = 200
          pixels[i + 1] = 30
          pixels[i + 2] = 30
        } else {
          pixels[i] = 30
          pixels[i + 1] = 200
          pixels[i + 2] = 50
        }
        pixels[i + 3] = 255
      }
    }
    const out = chromaCutoutKernel({ pixels, width: w, height: h })
    expect(out.keySamples).toBeGreaterThan(8)
    expect(out.keyHue).not.toBeNull()
    // Border is keyed out; interior stays opaque.
    const centerIdx = (16 * w + 16) * 4
    expect(out.pixels[centerIdx + 3]).toBe(255)
    expect(out.transparentFraction).toBeGreaterThan(0.1)
    expect(out.transparentFraction).toBeLessThan(0.9)
  })

  test('chromaCutoutKernel refuses when no key can be measured (honest failure)', () => {
    expect(() => chromaCutoutKernel({ pixels: new Uint8ClampedArray(4), width: 1, height: 1 })).toThrow(/border/i)
  })
})

describe('code analysis kernel (advisory, self-contained)', () => {
  test('delimiter imbalance and missing relative imports are reported', () => {
    const out = codeAnalysisKernel({
      files: [
        { path: 'src/app.ts', content: 'import { b } from "./lib/b"\nconst f = (() => { return 1 }' },
        { path: 'src/lib/b.ts', content: 'export const b = 1' },
        { path: 'src/other.ts', content: "import { x } from './missing-file'" },
      ],
    })
    const kinds = out.issues.map((i) => i.kind)
    expect(kinds).toContain('unbalanced-delimiters')
    expect(kinds).toContain('missing-relative-import')
    expect(out.issues.find((i) => i.kind === 'missing-relative-import')?.path).toBe('src/other.ts')
    expect(out.note).toMatch(/advisory/i)
    expect(out.note).toMatch(/server/i)
  })

  test('strings and comments never trigger false delimiter issues', () => {
    const out = codeAnalysisKernel({
      files: [{ path: 'ok.ts', content: 'const s = ")}]" // )}\n/* ) } */ const t = `}`' }],
    })
    expect(out.issues.filter((i) => i.kind === 'unbalanced-delimiters')).toHaveLength(0)
  })

  test('resolved relative imports (including index files) are not flagged', () => {
    const out = codeAnalysisKernel({
      files: [
        { path: 'src/a.ts', content: 'import "./util/index"\nimport "../lib/mod.js"' },
        { path: 'src/util/index.ts', content: '' },
        { path: 'lib/mod.js', content: '' },
      ],
    })
    expect(out.issues.filter((i) => i.kind === 'missing-relative-import')).toHaveLength(0)
  })
})

describe('built-in output validators (no completion without validation)', () => {
  test('image.preprocess validator', () => {
    expect(validateOutput('image.preprocess', { width: 10, height: 10, blob: new Blob(['x']), bytes: 1 }).valid).toBe(true)
    expect(validateOutput('image.preprocess', { width: 0, height: 10, bytes: 1 }).valid).toBe(false)
    expect(validateOutput('image.preprocess', { width: 10, height: 10 }).valid).toBe(false)
  })
  test('image.chroma-cutout validator mirrors the server coverage gate', () => {
    expect(validateOutput('image.chroma-cutout', { width: 2, height: 2, transparentFraction: 0.4 }).valid).toBe(true)
    expect(validateOutput('image.chroma-cutout', { width: 2, height: 2, transparentFraction: 0.001 }).valid).toBe(false)
    expect(validateOutput('image.chroma-cutout', { width: 2, height: 2, transparentFraction: 0.999 }).valid).toBe(false)
    expect(validateOutput('image.chroma-cutout', { width: 2, height: 2 }).valid).toBe(false)
  })
  test('video.thumbnail validator', () => {
    expect(validateOutput('video.thumbnail', { blob: new Blob(['x']), width: 100, height: 50 }).valid).toBe(true)
    expect(validateOutput('video.thumbnail', { blob: new Blob([]), width: 100, height: 50 }).valid).toBe(false)
  })
  test('unvalidated kinds fail honestly', () => {
    expect(validateOutput('no.such.kind', { anything: true }).valid).toBe(false)
  })
})

describe('JAZMII reference bounds parity with the SERVER module', () => {
  test('client bounds mirror src/lib/jazmii/reference-image.ts (drift check)', async () => {
    const source = await readFile('src/lib/jazmii/reference-image.ts', 'utf8')
    expect(source).toMatch(new RegExp(`\\b${JAZMII_REFERENCE_BOUNDS.minSidePx}\\b`))
    expect(source).toMatch(new RegExp(`\\b${JAZMII_REFERENCE_BOUNDS.maxSidePx}\\b`))
    // Server writes 16_777_216 with a numeric separator; 15 MB as 15 * 1024 * 1024.
    expect(source).toMatch(/16_?777_?216/)
    expect(source).toMatch(/REFERENCE_IMAGE_MAX_BYTES = 15 \* 1024 \* 1024/)
    // allowed MIME types map onto the server's sharp format names (jpeg/png/webp)
    for (const type of JAZMII_REFERENCE_BOUNDS.allowedTypes) {
      expect(type).toMatch(/^image\/(jpeg|png|webp)$/)
      expect(source).toContain(type.replace('image/', ''))
    }
  })

  test('jazmii kinds: both are local-only (nothing leaves the device)', () => {
    const kinds = buildJazmiiKinds()
    for (const kind of kinds) {
      expect(kind.privacy).toBe('local-only')
      expect(kind.handlers['client-cpu']).toBeDefined()
      expect(kind.handlers['client-gpu']).toBeUndefined()
    }
  })
})

describe('LAXII adapter kind metadata (honest capability surface)', () => {
  const cpu = new CpuEngine({ workerFactory: () => null })
  const kinds: Array<RegisteredTaskKind<unknown, unknown>> = buildLaxiiKinds(cpu)

  test('preprocess + cutout are CPU-only kinds with handlers', () => {
    const preprocess = kinds.find((k) => k.kind === PREPROCESS_KIND)!
    expect(preprocess.handlers['client-cpu']).toBeDefined()
    expect(preprocess.feasibility?.gpuSupported).toBe(false)
    expect(preprocess.productId).toBe('laxii')
    const cutout = kinds.find((k) => k.kind === 'image.chroma-cutout')!
    expect(cutout.handlers['client-cpu']).toBeDefined()
  })

  test('segmentation is registered model-gated with NO handlers (honest placeholder)', () => {
    const seg = kinds.find((k) => k.kind === SEGMENTATION_KIND)!
    expect(Object.keys(seg.handlers)).toHaveLength(0)
    expect(seg.feasibility?.requiredModelId).toBe('laxii-bgremoval-modnet')
    expect(seg.resourceClass).toBe('heavy')
  })
})

describe('GPU compatibility registry (never silently permissive)', () => {
  const noGpu: CapabilitySnapshot = {
    environment: 'browser',
    secureContext: true,
    webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
    webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
    wasm: { supported: true, simd: true },
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    hardwareConcurrency: 4,
    deviceMemoryGb: null,
    storage: null,
    browser: { family: 'Test', mobileHint: false },
    detectedAt: 0,
  }

  test('unknown operation → refused', () => {
    const res = checkGpuOperationSupport('totally.unknown', noGpu)
    expect(res.supported).toBe(false)
    expect(res.reason).toMatch(/no GPU registry entry/)
  })

  test('registered operation without adapter → refused with reason', () => {
    const res = checkGpuOperationSupport('image.chroma-cutout', noGpu)
    expect(res.supported).toBe(false)
    expect(res.reason).toMatch(/WebGPU is not available/)
  })
})

describe('end-to-end: LAXII preprocess through the scheduler (injected IO + protocol-faithful fake worker)', () => {
  test('full flow produces a validated, compressed output', async () => {
    setConsent(true, false)
    // Synthetic 8x8 decoder payload; encoder captures what the handler encodes.
    let decodedPayload: { pixels: Uint8ClampedArray; width: number; height: number } | null = null
    registerImageDecoder(async () => {
      const w = 8
      const h = 8
      const pixels = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 200
        pixels[i + 1] = 40
        pixels[i + 2] = 60
        pixels[i + 3] = 255
      }
      decodedPayload = { pixels, width: w, height: h }
      return decodedPayload
    })
    let encodedType = ''
    registerImageEncoder(async (payload, type) => {
      encodedType = type
      return new Blob([payload.pixels.slice().buffer], { type })
    })

    // Engine with a protocol-faithful fake worker (mirrors cpu-engine tests).
    const { fakeWorkerFromSource } = await import('../helpers/client-compute-fake-worker')
    const cpu = new CpuEngine({ workerFactory: fakeWorkerFromSource, concurrency: 1 })
    const resources = new ResourceManager({ conservative: false })
    const snap: CapabilitySnapshot = {
      environment: 'browser',
      secureContext: true,
      webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
      webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
      wasm: { supported: true, simd: true },
      workers: true,
      offscreenCanvas: true,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      hardwareConcurrency: 4,
      deviceMemoryGb: null,
      storage: null,
      browser: { family: 'Test', mobileHint: false },
      detectedAt: Date.now(),
    }
    const scheduler = new ComputeScheduler({
      capabilities: async () => snap,
      profile: () => ({ tier: 3, tierReasons: ['test'], conservative: false, benchmark: null, derivedAt: Date.now() }),
      resources,
      cpu,
    })
    // Register the real LAXII adapter kinds against this scheduler.
    const kinds = buildLaxiiKinds(cpu)
    scheduler.registerProductAdapter({ productId: 'laxii', summary: 'test', kinds })

    const blob = new Blob([new Uint8Array(1000)], { type: 'image/png' })
    const out = await scheduleImagePreprocess({ scheduler }, { blob, maxWidth: 4, maxHeight: 4, quality: 0.9 })
    expect(out.phase).toBe('completed')
    expect(out.state).toBe('CLIENT_CPU_AVAILABLE')
    expect(out.outputValidated).toBe(true)
    expect(out.output?.width).toBe(4)
    expect(out.output?.height).toBe(4)
    expect(out.output?.bytes).toBeGreaterThan(0)
    expect(out.output?.originalBytes).toBe(1000)
    expect(encodedType).toBe('image/jpeg')
  })
})
