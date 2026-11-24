/**
 * BEAN Intelligence — WASM (CPU) chat client (M39 §B).
 *
 * Main-thread seam over the wasm-chat worker: engine lifecycle (load with
 * progress from the VERIFIED bean-managed artifact, unload), streaming
 * generation with cancellation, init timeout, one-engine-per-tab policy,
 * and error mapping into the stable BEAN AI error catalog.
 *
 * The client NEVER claims execution that did not happen: the loaded model id
 * is reported by the worker, and every failure carries its honest code. The
 * artifact blob handed to load() MUST come from the model registry's
 * verified cache (SHA-256-pinned) — the client never fetches weights itself.
 *
 * Client-safe: no Node-only imports. The worker file imports @wllama/wllama
 * lazily (inside the worker bundle). A workerFactory seam exists for tests
 * (same pattern as CpuEngine); production uses the real Worker.
 */

import { AiErrorImpl, aiError, toAiError } from './errors'

type WorkerEvent =
  | { type: 'progress'; requestId: string; note: string; progress: number | null }
  | { type: 'ready'; requestId: string; modelId: string | null }
  | { type: 'delta'; requestId: string; delta: string }
  | { type: 'done'; requestId: string; text: string; finishReason: string }
  | { type: 'error'; requestId: string; code: string; message: string; details?: string }
  | { type: 'unloaded'; requestId: string }
  | { type: 'state'; requestId: string; state: string; modelId?: string | null }

export type WasmChatRole = 'system' | 'user' | 'assistant'
export interface WasmChatMessage {
  role: WasmChatRole
  content: string
}

export interface WasmLoadProgress {
  note: string
  progress: number | null
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onProgress?: (p: WasmLoadProgress) => void
  onDelta?: (delta: string) => void
}

const INIT_TIMEOUT_MS = 3 * 60_000 // wasm compile + model read into the heap

export class WasmChatClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingCall>()
  private seq = 0
  private loadedModelId: string | null = null
  private readonly workerFactory: () => Worker

  constructor(options: { workerFactory?: () => Worker } = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
  }

  /** Is a model currently loaded (and which)? Honest state, not a claim. */
  getLoadedModel(): string | null {
    return this.loadedModelId
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = this.workerFactory()
    this.worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => this.onEvent(event.data))
    this.worker.addEventListener('error', (event) => {
      // Worker-level crash: fail every pending call honestly.
      const error = aiError('AI_WORKER_CRASHED', event.message?.slice(0, 200))
      for (const [, call] of this.pending) call.reject(new AiErrorImpl(error.code, error.details))
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
        this.loadedModelId = event.modelId ?? null
        call.resolve(event.modelId ?? null)
        this.pending.delete(event.requestId)
        break
      case 'unloaded':
        this.loadedModelId = null
        call.resolve(null)
        this.pending.delete(event.requestId)
        break
      case 'state':
        if (event.state === 'loaded' && event.modelId) this.loadedModelId = event.modelId
        call.resolve(event.state)
        this.pending.delete(event.requestId)
        break
      case 'delta':
        call.onDelta?.(event.delta)
        break
      case 'done':
        call.resolve({ text: event.text, finishReason: event.finishReason })
        this.pending.delete(event.requestId)
        break
      case 'error':
        call.reject(new AiErrorImpl(
          (event.code as Parameters<typeof aiError>[0]) ?? 'AI_GENERATION_FAILED',
          event.details ?? event.message,
        ))
        this.pending.delete(event.requestId)
        break
    }
  }

  private post(msg: Record<string, unknown>, call: PendingCall): Promise<unknown> {
    const worker = this.ensureWorker()
    const requestId = `wc-${Date.now().toString(36)}-${(this.seq++).toString(36)}`
    this.pending.set(requestId, call)
    return new Promise((resolve, reject) => {
      call.resolve = resolve
      call.reject = reject
      worker.postMessage({ ...msg, requestId })
    })
  }

  /**
   * Load the verified GGUF artifact into the CPU runtime. `blob` MUST be the
   * registry-verified artifact (SHA-256 checked) — never a fresh fetch.
   * Resolves with the loaded model id ONLY when the engine reports ready.
   */
  async load(modelId: string, blob: Blob, options: { nCtx?: number; onProgress?: (p: WasmLoadProgress) => void; signal?: AbortSignal } = {}): Promise<string> {
    const call: PendingCall = {
      resolve: () => undefined,
      reject: () => undefined,
      onProgress: options.onProgress,
    }
    if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
    const onLoadAbort = () => void this.interruptLoad()
    options.signal?.addEventListener('abort', onLoadAbort, { once: true })
    try {
      const loaded = (await Promise.race([
        this.post({ kind: 'init', modelId, blob, ...(typeof options.nCtx === 'number' ? { nCtx: options.nCtx } : {}) }, call),
        new Promise((_, reject) => setTimeout(() => reject(new AiErrorImpl('AI_INIT_TIMEOUT', 'Model load exceeded the time budget.')), INIT_TIMEOUT_MS)),
      ])) as string | null
      this.loadedModelId = loaded ?? modelId
      return this.loadedModelId
    } catch (error) {
      throw toAiError(error)
    } finally {
      options.signal?.removeEventListener('abort', onLoadAbort)
    }
  }

  /** Signal an in-flight load/generation to stop (best-effort interrupt). */
  async interruptLoad(): Promise<void> {
    try {
      this.worker?.postMessage({ kind: 'interrupt', requestId: `wc-int-${Date.now().toString(36)}` })
    } catch {
      /* best-effort */
    }
  }

  /** Stream one chat completion. Resolves with the full text when the engine
   * finished; every delta already passed through onDelta. */
  async streamChat(
    messages: WasmChatMessage[],
    options: {
      onDelta?: (delta: string) => void
      signal?: AbortSignal
      maxTokens?: number
      temperature?: number
      topP?: number
      timeoutMs?: number
    } = {},
  ): Promise<{ text: string; finishReason: string }> {
    if (!this.loadedModelId) throw new AiErrorImpl('AI_MODEL_NOT_INSTALLED', 'Load a model before generating.')
    const call: PendingCall = { resolve: () => undefined, reject: () => undefined, onDelta: options.onDelta }
    const onExternalAbort = () => void this.interruptLoad()
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
    const timer = setTimeout(() => void this.interruptLoad(), options.timeoutMs ?? 5 * 60_000)
    try {
      const result = (await this.post(
        {
          kind: 'generate',
          messages,
          ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
          ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
          ...(typeof options.topP === 'number' ? { topP: options.topP } : {}),
        },
        call,
      )) as { text: string; finishReason: string }
      return result
    } catch (error) {
      throw toAiError(error)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  /** Unload the model (frees the wasm heap; the verified cache stays). */
  async unload(): Promise<void> {
    if (!this.worker || !this.loadedModelId) return
    await this.post({ kind: 'unload' }, { resolve: () => undefined, reject: () => undefined })
    this.loadedModelId = null
  }

  /** Terminate the worker (page teardown). Cached artifacts are preserved. */
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.loadedModelId = null
    for (const [, call] of this.pending) call.reject(new AiErrorImpl('AI_WORKER_CRASHED', 'Worker disposed.'))
    this.pending.clear()
  }
}

function defaultWorkerFactory(): Worker {
  if (typeof Worker !== 'function') throw new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', 'This browser does not support Web Workers.')
  // The WASM runtime lives in a self-hosted worker bundle (public/workers,
  // built by scripts/build-workers.mjs) OUTSIDE the Next compile graph —
  // same-origin, no third-party CDN.
  return new Worker('/workers/wasm-chat-worker.js', { type: 'module' })
}

let shared: WasmChatClient | null = null
/** One large generative model per tab: a single shared client instance. */
export function getSharedWasmChatClient(): WasmChatClient {
  if (!shared) shared = new WasmChatClient()
  return shared
}
