/**
 * BEAN Intelligence — Transformers.js ASR worker (Tier A: browser speech-to-text).
 *
 * Runs a Whisper ONNX pipeline (@huggingface/transformers) OUTSIDE the main
 * UI thread for GANGZII live-voice transcription. The visitor's microphone
 * audio is decoded to 16 kHz mono PCM on the MAIN thread (AudioContext is
 * main-thread only) and transferred here; nothing is uploaded anywhere —
 * transcription happens on this device.
 *
 * Model integrity: the model id + revision are pinned by the caller (the
 * client model registry records the measured revision); the runtime fetches
 * weights from the pinned Hugging Face revision into its own browser cache.
 *
 * Protocol:
 *  -> {kind:'init', requestId, modelId, revision, device:'auto'|'webgpu'|'wasm'}
 *  -> {kind:'transcribe', requestId, pcm: Float32Array(16kHz mono), language?, task?, discard?: boolean}
 *  -> {kind:'cancel', requestId}  (marks the in-flight call discarded —
 *      transformers.js exposes no mid-call cancel; the result is dropped
 *      and reported honestly as cancelled)
 *  <- {type:'progress'|'ready'|'done'|'error'|'state', requestId}
 */

import type { AiErrorCode } from '@/lib/client-compute/inference/errors'

interface InitMsg { kind: 'init'; requestId: string; modelId: string; revision?: string; device?: 'auto' | 'webgpu' | 'wasm' }
interface TranscribeMsg {
  kind: 'transcribe'
  requestId: string
  pcm: Float32Array
  language?: string
  task?: 'transcribe' | 'translate'
  discard?: boolean
}
interface CancelMsg { kind: 'cancel'; requestId: string }
type WorkerMsg = InitMsg | TranscribeMsg | CancelMsg

function classify(error: unknown): { code: AiErrorCode; message: string; details?: string } {
  const raw = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  const text = raw.toLowerCase()
  const has = (...n: string[]) => n.some((x) => text.includes(x))
  if (has('webgpu', 'requestadapter', 'adapter')) return { code: 'AI_WEBGPU_UNAVAILABLE', message: 'WebGPU inference is unavailable; the pipeline falls back to CPU/WASM.' }
  if (has('out of memory', 'outofmemory', 'oom')) return { code: 'AI_OUT_OF_MEMORY', message: 'The device ran out of memory while running the model.' }
  if (has('fetch', 'network', 'Failed to download')) return { code: 'AI_NETWORK_INTERRUPTED', message: 'The model download hit a network interruption.' }
  if (has('timeout', 'timed out')) return { code: 'AI_TIMEOUT', message: 'The runtime took too long.' }
  if (has('not found', 'no such model')) return { code: 'AI_MODEL_UNSUPPORTED_DEVICE', message: 'The requested model is not available.' }
  return {
    code: 'AI_GENERATION_FAILED',
    message: 'On-device transcription failed.',
    details: raw.slice(0, 300),
  }
}

type PipelineLike = {
  (audio: Float32Array, opts?: { language?: string; task?: string; chunk_length_s?: number; stride_length_s?: number; return_timestamps?: boolean }): Promise<{ text?: string; chunks?: Array<{ text?: string }> }>
}

let pipelinePromise: Promise<PipelineLike> | null = null
let pipelineKey: string | null = null
/** Request ids discarded by cancel — their results resolve as cancelled. */
const discarded = new Set<string>()

function post(msg: Record<string, unknown>): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function ensurePipeline(modelId: string, revision: string | undefined, device: 'auto' | 'webgpu' | 'wasm', requestId: string): Promise<PipelineLike> {
  const key = `${modelId}@${revision ?? 'main'}#${device}`
  if (pipelinePromise && pipelineKey === key) return pipelinePromise
  pipelineKey = key
  pipelinePromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers')
    const tryOrder: Array<'webgpu' | 'wasm'> = device === 'wasm' ? ['wasm'] : device === 'webgpu' ? ['webgpu', 'wasm'] : ['webgpu', 'wasm']
    let lastError: unknown = null
    for (const dev of tryOrder) {
      try {
        post({ type: 'state', requestId, state: `initializing-${dev}` })
        // Quantized int8 weights: the measured download for this set is
        // pinned in the client model registry (~43.6 MB for whisper-tiny).
        return (await pipeline('automatic-speech-recognition', modelId, {
          ...(revision ? { revision } : {}),
          device: dev,
          dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
          progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              post({ type: 'progress', requestId, note: p.file ?? 'downloading model', progress: p.progress / 100 })
            }
          },
        })) as PipelineLike
      } catch (error) {
        lastError = error
        post({ type: 'state', requestId, state: `fallback-from-${dev}` })
      }
    }
    throw lastError ?? new Error('No usable execution provider for this device.')
  })()
  try {
    return await pipelinePromise
  } catch (error) {
    pipelinePromise = null
    pipelineKey = null
    throw error
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerMsg>) => {
  const msg = event.data
  void (async () => {
    try {
      if (msg.kind === 'init') {
        await ensurePipeline(msg.modelId, msg.revision, msg.device ?? 'auto', msg.requestId)
        post({ type: 'ready', requestId: msg.requestId, modelId: msg.modelId })
        return
      }
      if (msg.kind === 'cancel') {
        discarded.add(msg.requestId)
        return
      }
      // transcribe
      if (msg.discard) discarded.add(msg.requestId)
      const audio = msg.pcm
      if (!audio || audio.length === 0) {
        post({ type: 'error', requestId: msg.requestId, code: 'AI_INVALID_RESPONSE', message: 'No usable audio was provided.' })
        return
      }
      const started = Date.now()
      const asr = await ensurePipeline('Xenova/whisper-tiny', undefined, 'auto', msg.requestId)
      if (discarded.has(msg.requestId)) {
        post({ type: 'state', requestId: msg.requestId, state: 'cancelled' })
        return
      }
      post({ type: 'state', requestId: msg.requestId, state: 'transcribing' })
      const out = await asr(audio, {
        ...(msg.language ? { language: msg.language } : {}),
        task: msg.task ?? 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      })
      const text = (out?.text ?? '').trim()
      post({
        type: 'done',
        requestId: msg.requestId,
        text,
        durationMs: Date.now() - started,
        cancelled: discarded.has(msg.requestId),
      })
    } catch (error) {
      const mapped = classify(error)
      post({ type: 'error', requestId: (msg as { requestId?: string }).requestId ?? '', ...mapped })
    } finally {
      discarded.delete((msg as { requestId?: string }).requestId ?? '')
    }
  })()
})
