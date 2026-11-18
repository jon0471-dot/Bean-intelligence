/**
 * BEAN Intelligence — segmentation worker (Tier A: LAXII browser background
 * removal, fully off the main thread).
 *
 * Bundled by scripts/build-workers.mjs into public/workers/ (NOT part of the
 * Next.js compile graph). Runs the PINNED, SHA-256-verified MODNet artifact
 * through onnxruntime-web entirely on the visitor's device:
 *   - reads the verified artifact from the BEAN cache (Cache API),
 *   - WebGPU execution provider attempted first, honest WASM/SIMD fallback,
 *   - preprocessing per the pinned preprocessor config (shortest edge 512,
 *     divisibility 32, rescale 1/255, mean/std 0.5),
 *   - returns the matte resampled to the ORIGINAL geometry; compositing into
 *     RGBA happens on the main thread seam (ort-segmentation.ts).
 *
 * Protocol:
 *  -> {kind:'segment', requestId, pixels: Uint8ClampedArray(transfer), width, height}
 *  -> {kind:'cancel', requestId}
 *  <- {type:'matte'|'progress'|'error'|'state', requestId}
 */

type OrtTensor = { data: Float32Array; dims: number[] }
type OrtSession = {
  inputNames: string[]
  outputNames: string[]
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>
}
type OrtModule = {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor
  InferenceSession: {
    create: (bytes: Uint8Array, options?: { executionProviders?: Array<'webgpu' | 'wasm'> }) => Promise<OrtSession>
  }
  env: { wasm: { wasmPaths?: string; numThreads?: number } }
}

const MODEL_ID = 'laxii-bgremoval-modnet'
const CACHE_NAME = 'bean-client-models-v1'

let sessionPromise: Promise<{ session: OrtSession; provider: 'webgpu' | 'wasm' }> | null = null

function post(msg: Record<string, unknown>): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function ensureSession(requestId: string): Promise<{ session: OrtSession; provider: 'webgpu' | 'wasm' }> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    post({ type: 'state', requestId, state: 'opening-model-cache' })
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(`${MODEL_ID}@1`)
    if (!res || res.headers.get('x-bean-model') !== MODEL_ID) {
      throw new Error('AI_MODEL_NOT_INSTALLED: download the background-removal model first.')
    }
    const buf = await res.arrayBuffer()
    post({ type: 'state', requestId, state: 'loading-runtime' })
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule
    ort.env.wasm.wasmPaths = '/ort/'
    try {
      const hc = navigator.hardwareConcurrency ?? 1
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, hc))
    } catch {
      /* default threading */
    }
    try {
      const session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['webgpu'] })
      return { session, provider: 'webgpu' as const }
    } catch {
      const session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'] })
      return { session, provider: 'wasm' as const }
    }
  })()
  try {
    return await sessionPromise
  } catch (error) {
    sessionPromise = null
    throw error
  }
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
function preprocess(pixels: Uint8ClampedArray, width: number, height: number): { data: Float32Array; height: number; width: number } {
  const scale = 512 / Math.min(width, height)
  const w = Math.max(32, Math.round((width * scale) / 32) * 32)
  const h = Math.max(32, Math.round((height * scale) / 32) * 32)
  // Bilinear resample (RGBA source).
  const rgb = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, ((y + 0.5) * height) / h - 0.5)
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, ((x + 0.5) * width) / w - 0.5)
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(width - 1, x0 + 1)
      const fx = sx - x0
      for (let c = 0; c < 4; c++) {
        const v00 = pixels[(y0 * width + x0) * 4 + c]
        const v01 = pixels[(y0 * width + x1) * 4 + c]
        const v10 = pixels[(y1 * width + x0) * 4 + c]
        const v11 = pixels[(y1 * width + x1) * 4 + c]
        rgb[(y * w + x) * 4 + c] =
          v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy
      }
    }
  }
  const data = new Float32Array(3 * h * w)
  const rescale = 0.00392156862745098
  let o = 0
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data[o++] = (rgb[(y * w + x) * 4 + c] * rescale - 0.5) / 0.5
      }
    }
  }
  return { data, height: h, width: w }
}

function classify(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  const text = raw.toLowerCase()
  if (text.includes('ai_model_not_installed')) return { code: 'AI_MODEL_NOT_INSTALLED', message: 'The background-removal model is not downloaded yet.' }
  if (text.includes('out of memory') || text.includes('oom')) return { code: 'AI_OUT_OF_MEMORY', message: 'The device ran out of memory while running the model.' }
  if (text.includes('webgpu') || text.includes('adapter')) return { code: 'AI_WEBGPU_UNAVAILABLE', message: 'WebGPU inference unavailable (WASM fallback attempted).' }
  if (text.includes('timeout')) return { code: 'AI_TIMEOUT', message: 'The runtime took too long.' }
  return { code: 'AI_GENERATION_FAILED', message: raw.slice(0, 300) }
}

const cancelled = new Set<string>()

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | { kind: 'segment'; requestId: string; pixels: Uint8ClampedArray; width: number; height: number }
    | { kind: 'cancel'; requestId: string }
  void (async () => {
    try {
      if (msg.kind === 'cancel') {
        cancelled.add(msg.requestId)
        return
      }
      const { requestId, pixels, width, height } = msg
      const { session, provider } = await ensureSession(requestId)
      if (cancelled.has(requestId)) {
        post({ type: 'state', requestId, state: 'cancelled' })
        return
      }
      const input = preprocess(pixels, width, height)
      post({ type: 'state', requestId, state: `running-${provider}` })
      const ort = (await import('onnxruntime-web')) as unknown as OrtModule
      const feeds: Record<string, OrtTensor> = {}
      feeds[session.inputNames[0]] = new ort.Tensor('float32', input.data, [1, 3, input.height, input.width])
      const results = await session.run(feeds)
      const matte = results[session.outputNames[0]]
      if (!matte || matte.dims.length < 2) {
        throw new Error('AI_INVALID_RESPONSE: the segmentation model returned no usable matte.')
      }
      const mH = matte.dims[matte.dims.length - 2]
      const mW = matte.dims[matte.dims.length - 1]
      const resized = resampleMatte(matte.data, mW, mH, width, height)
      ;(self as unknown as Worker).postMessage(
        { type: 'matte', requestId, matte: resized, width, height, provider },
        [resized.buffer],
      )
    } catch (error) {
      const mapped = classify(error)
      post({ type: 'error', requestId: (msg as { requestId?: string }).requestId ?? '', ...mapped })
    } finally {
      cancelled.delete((msg as { requestId?: string }).requestId ?? '')
    }
  })()
})
