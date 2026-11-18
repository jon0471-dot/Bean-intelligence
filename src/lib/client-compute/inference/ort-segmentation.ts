/**
 * BEAN Intelligence — segmentation main-thread seam (Tier A: LAXII browser
 * background removal).
 *
 * ARCHITECTURE (2026-11-18): the heavy onnxruntime-web runtime runs ONLY in
 * the dedicated worker bundle (src/workers/segmentation-worker.ts, served
 * from public/workers/segmentation-worker.js, built by
 * scripts/build-workers.mjs). This seam:
 *   - decodes the image to RGBA pixels (main-thread ImageDecoder),
 *   - transfers them to the worker,
 *   - receives the matte (resampled to the ORIGINAL geometry) and composites
 *     it into the RGBA output.
 * The WebGPU→WASM provider decision happens inside the worker and is
 * reported back verbatim — never a claimed provider.
 *
 * Client-safe: no Node-only imports; no heavy runtime in this graph.
 */

import { AiErrorImpl, toAiError, type AiErrorCode } from './errors'
import { getDefaultModelRegistry } from '../model-registry'
import type { PixelPayload } from '../adapters/image-kernels'

const SEGMENTATION_MODEL_ID = 'laxii-bgremoval-modnet'

type WorkerEvent =
  | { type: 'state'; requestId: string; state: string }
  | { type: 'matte'; requestId: string; matte: Float32Array; width: number; height: number; provider: 'webgpu' | 'wasm' }
  | { type: 'error'; requestId: string; code: string; message: string }

export interface SegmentationResult {
  /** RGBA pixels with the matte applied as alpha (original geometry). */
  payload: PixelPayload
  /** The execution provider that ACTUALLY ran (never a claimed one). */
  provider: 'webgpu' | 'wasm'
  durationMs: number
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onState?: (state: string) => void
}

/** Which execution provider actually served the last session (honest GPU/CPU reporting). */
export function lastSegmentationProvider(): 'webgpu' | 'wasm' | null {
  return lastProvider
}

let lastProvider: 'webgpu' | 'wasm' | null = null
let worker: Worker | null = null
const pending = new Map<string, PendingCall>()
let seq = 0

function ensureWorker(): Worker {
  if (worker) return worker
  if (typeof Worker !== 'function') throw new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', 'This browser does not support Web Workers.')
  worker = new Worker('/workers/segmentation-worker.js', { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
    const call = pending.get(event.data.requestId)
    if (!call) return
    switch (event.data.type) {
      case 'state':
        call.onState?.(event.data.state)
        break
      case 'matte':
        lastProvider = event.data.provider
        call.resolve(event.data)
        pending.delete(event.data.requestId)
        break
      case 'error':
        call.reject(new AiErrorImpl((event.data.code as AiErrorCode) ?? 'AI_GENERATION_FAILED', event.data.message))
        pending.delete(event.data.requestId)
        break
    }
  })
  worker.addEventListener('error', (event) => {
    const error = new AiErrorImpl('AI_WORKER_CRASHED', event.message?.slice(0, 200))
    for (const [, call] of pending) call.reject(error)
    pending.clear()
  })
  return worker
}

export async function runModnetSegmentation(payload: PixelPayload, options: { signal?: AbortSignal } = {}): Promise<SegmentationResult> {
  if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
  // Honest model gate: refuse BEFORE any work when the verified artifact is
  // missing (the scheduler's model gate also enforces this upstream).
  const state = await getDefaultModelRegistry().getInstallState(SEGMENTATION_MODEL_ID)
  if (!state.installed) {
    throw new AiErrorImpl('AI_MODEL_NOT_INSTALLED', 'Download the background-removal model from AI Device settings first.')
  }
  const started = Date.now()
  const worker = ensureWorker()
  const requestId = `seg-${Date.now().toString(36)}-${(seq++).toString(36)}`
  const pixels = new Uint8ClampedArray(payload.pixels) // copy: transferred buffer

  const promise = new Promise<{ matte: Float32Array; width: number; height: number; provider: 'webgpu' | 'wasm' }>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, onState: undefined })
    worker.postMessage({ kind: 'segment', requestId, pixels, width: payload.width, height: payload.height }, [pixels.buffer])
  })
  try {
    const result = await promise
    if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
    // Composite the matte into the ORIGINAL-resolution RGBA output.
    const out = new Uint8ClampedArray(payload.pixels)
    for (let i = 0; i < payload.width * payload.height; i++) {
      const a = Math.max(0, Math.min(1, result.matte[i]))
      out[i * 4 + 3] = Math.round(a * 255)
    }
    return {
      payload: { pixels: out, width: payload.width, height: payload.height },
      provider: result.provider,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    if (error instanceof AiErrorImpl) throw error
    throw toAiError(error)
  }
}

/** Test seam. */
export function resetSegmentationForTests(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  lastProvider = null
}
