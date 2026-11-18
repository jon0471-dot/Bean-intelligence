/**
 * BEAN Intelligence — browser ASR client (Tier A speech-to-text lane).
 *
 * GANGZII live-voice local transcription: microphone audio NEVER leaves the
 * device — decode (main-thread AudioContext, resampled to 16 kHz mono) and
 * Whisper inference (worker, Transformers.js ONNX) both happen here.
 *
 * Model facts (pinned, measured 2026-11-18 from the Hugging Face API):
 *  - Xenova/whisper-tiny @ 5332fcc35e32a33b86612b9a57a89be7906102b1
 *  - q8 weight set ≈ 43.6 MB download (encoder q8 10.1 MB + decoder-merged
 *    q8 30.7 MB + tokenizer/config ~2.8 MB) — recorded in the client model
 *    registry; the runtime fetches from the pinned revision.
 *
 * Client-safe: no Node-only imports.
 */

import { AiErrorImpl, toAiError, type AiErrorCode } from './errors'

type WorkerEvent =
  | { type: 'progress'; requestId: string; note: string; progress: number | null }
  | { type: 'ready'; requestId: string; modelId: string }
  | { type: 'state'; requestId: string; state: string }
  | { type: 'done'; requestId: string; text: string; durationMs: number; cancelled: boolean }
  | { type: 'error'; requestId: string; code: string; message: string; details?: string }

export const BROWSER_ASR_MODEL_ID = 'Xenova/whisper-tiny'
/** Measured revision (HF API, 2026-11-18) — pinned for integrity. */
export const BROWSER_ASR_MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onProgress?: (p: { note: string; progress: number | null }) => void
  onState?: (state: string) => void
}

const INIT_TIMEOUT_MS = 3 * 60_000

/** Decode a media blob to 16 kHz mono PCM on the main thread. */
async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  if (typeof AudioContext !== 'function') {
    throw new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', 'Audio decoding is not available in this browser context.')
  }
  const ctx = new AudioContext({ sampleRate: 16_000 })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const channel = buf.numberOfChannels > 0 ? buf.getChannelData(0) : new Float32Array(0)
    return new Float32Array(channel) // copy so it can be transferred
  } finally {
    void ctx.close().catch(() => undefined)
  }
}

export class BrowserAsrClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingCall>()
  private seq = 0

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    if (typeof Worker !== 'function') throw new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', 'This browser does not support Web Workers.')
    this.worker = new Worker(new URL('../../../workers/asr-worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => this.onEvent(event.data))
    this.worker.addEventListener('error', (event) => {
      const error = new AiErrorImpl('AI_WORKER_CRASHED', event.message?.slice(0, 200))
      for (const [, call] of this.pending) call.reject(error)
      this.pending.clear()
    })
    return this.worker
  }

  private onEvent(event: WorkerEvent): void {
    const call = this.pending.get(event.requestId)
    if (!call) return
    switch (event.type) {
      case 'progress':
        call.onProgress?.({ note: event.note, progress: event.progress })
        break
      case 'ready':
        call.resolve(event.modelId)
        this.pending.delete(event.requestId)
        break
      case 'state':
        call.onState?.(event.state)
        break
      case 'done':
        if (event.cancelled) {
          call.reject(new AiErrorImpl('AI_GENERATION_CANCELLED'))
        } else {
          call.resolve({ text: event.text, durationMs: event.durationMs })
        }
        this.pending.delete(event.requestId)
        break
      case 'error':
        call.reject(new AiErrorImpl((event.code as AiErrorCode) ?? 'AI_GENERATION_FAILED', event.details ?? event.message))
        this.pending.delete(event.requestId)
        break
    }
  }

  private post(msg: Record<string, unknown>, call: PendingCall, transfer?: Transferable[]): Promise<unknown> {
    const worker = this.ensureWorker()
    const requestId = `asr-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
    this.pending.set(requestId, call)
    return new Promise((resolve, reject) => {
      call.resolve = resolve
      call.reject = reject
      worker.postMessage({ ...msg, requestId }, transfer ?? [])
    })
  }

  /** Warm the pipeline (download + compile) without audio. */
  async ensureLoaded(options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal } = {}): Promise<string> {
    const call: PendingCall = { resolve: () => undefined, reject: () => undefined, onProgress: options.onProgress }
    try {
      const model = (await Promise.race([
        this.post({ kind: 'init', modelId: BROWSER_ASR_MODEL_ID, revision: BROWSER_ASR_MODEL_REVISION, device: 'auto' }, call),
        new Promise((_, reject) => setTimeout(() => reject(new AiErrorImpl('AI_INIT_TIMEOUT', 'Model load exceeded the time budget.')), INIT_TIMEOUT_MS)),
      ])) as string
      return model
    } catch (error) {
      throw toAiError(error)
    }
  }

  /**
   * Transcribe one recording locally. The audio is decoded on-device and
   * transferred to the worker; the transcript resolves only from a real
   * pipeline result (cancellation surfaces AI_GENERATION_CANCELLED).
   */
  async transcribe(
    blob: Blob,
    options: {
      language?: string
      onProgress?: (p: { note: string; progress: number | null }) => void
      onState?: (state: string) => void
      signal?: AbortSignal
      timeoutMs?: number
    } = {},
  ): Promise<{ text: string; durationMs: number }> {
    if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
    const pcm = await decodeTo16kMono(blob)
    if (pcm.length === 0) throw new AiErrorImpl('AI_INVALID_RESPONSE', 'The recording decoded to silence.')
    const call: PendingCall = { resolve: () => undefined, reject: () => undefined, onProgress: options.onProgress, onState: options.onState }
    const timer = setTimeout(() => this.cancel(), options.timeoutMs ?? 2 * 60_000)
    try {
      const result = (await this.post(
        {
          kind: 'transcribe',
          pcm,
          ...(options.language ? { language: options.language } : {}),
          task: 'transcribe',
        },
        call,
        [pcm.buffer],
      )) as { text: string; durationMs: number }
      return result
    } catch (error) {
      throw toAiError(error)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Cancel an in-flight transcription (result discarded honestly). */
  cancel(): void {
    for (const [requestId] of this.pending) {
      try {
        this.worker?.postMessage({ kind: 'cancel', requestId })
      } catch {
        /* best-effort */
      }
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const [, call] of this.pending) call.reject(new AiErrorImpl('AI_WORKER_CRASHED', 'Worker disposed.'))
    this.pending.clear()
  }
}

let shared: BrowserAsrClient | null = null
export function getSharedBrowserAsrClient(): BrowserAsrClient {
  if (!shared) shared = new BrowserAsrClient()
  return shared
}
