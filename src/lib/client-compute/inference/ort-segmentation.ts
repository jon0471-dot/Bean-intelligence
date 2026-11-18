/**
 * BEAN Intelligence — onnxruntime-web segmentation runtime (Tier A: LAXII
 * browser background removal).
 *
 * Runs the PINNED MODNet artifact (bean-managed cache, SHA-256 verified at
 * download) through onnxruntime-web, entirely on the visitor's device:
 *  - WebGPU execution provider attempted first (real GPU acceleration),
 *  - WASM/SIMD fallback (honest CPU mode),
 *  - preprocessing exactly as the pinned preprocessor_config declares:
 *    shortest-edge 512 resize with divisibility 32, rescale 1/255,
 *    normalize mean/std 0.5.
 *
 * The alpha matte is composited onto the ORIGINAL-resolution pixels, so the
 * output keeps the input's geometry. Nothing is uploaded anywhere.
 *
 * Client-safe: no Node-only imports; onnxruntime-web is imported lazily.
 */

import { AiErrorImpl, toAiError } from './errors'
import { getDefaultModelRegistry } from '../model-registry'
import type { PixelPayload } from '../adapters/image-kernels'

const SEGMENTATION_MODEL_ID = 'laxii-bgremoval-modnet'

type OrtTensor = { data: Float32Array; dims: number[] }
type OrtSession = {
  inputNames: string[]
  outputNames: string[]
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>
  release?: () => Promise<void>
}
type OrtModule = {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor
  InferenceSession: {
    create: (
      uriOrBytes: Uint8Array,
      options?: { executionProviders?: Array<'webgpu' | 'wasm'> },
    ) => Promise<OrtSession>
  }
  env: {
    wasm: {
      wasmPaths?: string
      numThreads?: number
      simd?: boolean
    }
  }
}

let ortModulePromise: Promise<OrtModule> | null = null
let sessionPromise: Promise<OrtSession> | null = null
let sessionEp: 'webgpu' | 'wasm' | null = null

/** Which execution provider actually served the last session (honest GPU/CPU reporting). */
export function lastSegmentationProvider(): 'webgpu' | 'wasm' | null {
  return sessionEp
}

async function loadOrt(): Promise<OrtModule> {
  ortModulePromise ??= (async () => {
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule
    // The WASM/JS assets are served from BEAN's own origin (copied into
    // /public/ort at install/build time) — no third-party CDN dependency.
    ort.env.wasm.wasmPaths = '/ort/'
    try {
      const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 1 : 1
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, hc))
    } catch {
      /* default threading */
    }
    return ort
  })()
  return ortModulePromise
}

async function ensureSession(): Promise<OrtSession> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const registry = getDefaultModelRegistry()
    const state = await registry.getInstallState(SEGMENTATION_MODEL_ID)
    if (!state.installed) {
      throw new AiErrorImpl('AI_MODEL_NOT_INSTALLED', 'Download the background-removal model from AI Device settings first.')
    }
    const artifact = await registry.getArtifact(SEGMENTATION_MODEL_ID)
    if (!artifact) {
      throw new AiErrorImpl('AI_MODEL_NOT_INSTALLED', 'The verified model artifact could not be read from the browser cache.')
    }
    const ort = await loadOrt()
    // WebGPU first, honest WASM fallback — the chosen EP is reported.
    try {
      const session = await ort.InferenceSession.create(artifact, { executionProviders: ['webgpu'] })
      sessionEp = 'webgpu'
      return session
    } catch {
      const session = await ort.InferenceSession.create(artifact, { executionProviders: ['wasm'] })
      sessionEp = 'wasm'
      return session
    }
  })()
  try {
    return await sessionPromise
  } catch (error) {
    sessionPromise = null
    sessionEp = null
    throw error
  }
}

/** Bilinear resample of an RGBA buffer. */
function resampleBilinear(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels: 3 | 4,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * channels)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, ((y + 0.5) * srcH) / dstH - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, ((x + 0.5) * srcW) / dstW - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0
      for (let c = 0; c < channels; c++) {
        const v00 = pixels[(y0 * srcW + x0) * channels + c]
        const v01 = pixels[(y0 * srcW + x1) * channels + c]
        const v10 = pixels[(y1 * srcW + x0) * channels + c]
        const v11 = pixels[(y1 * srcW + x1) * channels + c]
        out[(y * dstW + x) * channels + c] =
          v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy
      }
    }
  }
  return out
}

/** Bilinear resample of a single-channel matte. */
function resampleMatte(matte: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number): Float32Array {
  const out = new Float32Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, ((y + 0.5) * srcH) / dstH - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, ((x + 0.5) * srcW) / dstW - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0
      const v00 = matte[y0 * srcW + x0]
      const v01 = matte[y0 * srcW + x1]
      const v10 = matte[y1 * srcW + x0]
      const v11 = matte[y1 * srcW + x1]
      out[y * dstW + x] = v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy
    }
  }
  return out
}

/** MODNet preprocessing, exactly as the pinned preprocessor_config declares. */
function preprocess(payload: PixelPayload): { data: Float32Array; height: number; width: number } {
  const { pixels, width, height } = payload
  // shortest edge -> 512, divisibility 32 (round up to the next multiple).
  const scale = 512 / Math.min(width, height)
  let w = Math.max(32, Math.round((width * scale) / 32) * 32)
  let h = Math.max(32, Math.round((height * scale) / 32) * 32)
  w = Math.min(w, width)
  h = Math.min(h, height)
  // Re-derive without shrinking below the target when the source is smaller:
  // MODNet accepts dynamic sizes; keep the resized geometry from the scale.
  if (width * scale >= 32) {
    w = Math.max(32, Math.round((width * scale) / 32) * 32)
    h = Math.max(32, Math.round((height * scale) / 32) * 32)
  }
  const rgb = resampleBilinear(pixels, width, height, w, h, 4)
  const data = new Float32Array(3 * h * w)
  const rescale = 0.00392156862745098
  const mean = 0.5
  const std = 0.5
  let o = 0
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data[o++] = ((rgb[(y * w + x) * 4 + c] * rescale) - mean) / std
      }
    }
  }
  return { data, height: h, width: w }
}

export interface SegmentationResult {
  /** RGBA pixels with the matte applied as alpha (original geometry). */
  payload: PixelPayload
  /** The execution provider that ACTUALLY ran (never a claimed one). */
  provider: 'webgpu' | 'wasm'
  durationMs: number
}

/** Run MODNet segmentation on device. Throws typed AiErrors on failure. */
export async function runModnetSegmentation(payload: PixelPayload, options: { signal?: AbortSignal } = {}): Promise<SegmentationResult> {
  if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
  const started = Date.now()
  try {
    const ort = await loadOrt()
    const session = await ensureSession()
    const input = preprocess(payload)
    const tensor = new ort.Tensor('float32', input.data, [1, 3, input.height, input.width])
    const feeds: Record<string, OrtTensor> = {}
    feeds[session.inputNames[0]] = tensor
    const results = await session.run(feeds)
    const outName = session.outputNames[0]
    const matte = results[outName]
    if (!matte || matte.dims.length < 2) {
      throw new AiErrorImpl('AI_INVALID_RESPONSE', 'The segmentation model returned no usable matte.')
    }
    const [mH, mW] = [matte.dims[matte.dims.length - 2], matte.dims[matte.dims.length - 1]]
    const matteResized = resampleMatte(matte.data, mW, mH, payload.width, payload.height)
    // Composite: alpha = clamp(matte) onto the original RGBA pixels.
    const out = new Uint8ClampedArray(payload.pixels)
    for (let i = 0; i < payload.width * payload.height; i++) {
      const a = Math.max(0, Math.min(1, matteResized[i]))
      out[i * 4 + 3] = Math.round(a * 255)
    }
    if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
    return {
      payload: { pixels: out, width: payload.width, height: payload.height },
      provider: sessionEp ?? 'wasm',
      durationMs: Date.now() - started,
    }
  } catch (error) {
    if (error instanceof AiErrorImpl) throw error
    // ORT aborts on cancellation with 'Aborted' — map through the catalog.
    throw toAiError(error)
  }
}

/** Test seam: drop the cached session (tests use injected artifacts). */
export function resetSegmentationForTests(): void {
  sessionPromise = null
  sessionEp = null
  ortModulePromise = null
}
