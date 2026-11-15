/**
 * BEAN Intelligence — client compute: CPU/WASM execution engine (Phase 4).
 *
 * Bounded, cancellable, progress-reporting CPU lane built on Web Workers:
 *  - Worker-pool concurrency limits (never saturate the device).
 *  - Task cancellation (worker terminated) and honest crash mapping.
 *  - Progress events forwarded from the worker protocol.
 *  - Memory-aware admission is the SCHEDULER's job; this engine enforces
 *    only the concurrency bound and per-task timeout.
 *  - When Workers are unavailable, tasks can run on the main thread ONLY if
 *    the caller explicitly accepts main-thread blocking (result is marked
 *    honestly; the scheduler refuses this for heavy workloads).
 *
 * Kernel contract: `runFunction` serializes a SELF-CONTAINED pure function
 * (no closure references, no imports) plus a JSON-serializable payload into
 * a worker. Adapter tests verify that the serialized kernel behaves
 * identically to the direct call — a kernel that cannot be serialized
 * safely must not be registered for the worker lane.
 *
 * HONESTY LABEL: unit tests exercise pool/concurrency/cancel logic with
 * injected fake workers, plus kernel-serialization parity in-process. Real
 * browser worker execution is verified separately (see implementation report).
 *
 * Client-safe: no Node-only imports.
 */
import { mapCpuErrorToState } from '../fallback'
import type { ComputeTaskState } from '../types'

export interface WorkerLike {
  postMessage: (data: unknown) => void
  terminate: () => void
  onmessage: ((ev: { data?: unknown }) => void) | null
  onerror: ((ev: { message?: string }) => void) | null
}

export type WorkerFactory = () => WorkerLike | null

export interface CpuEngineDeps {
  /** Injectable worker factory (tests pass fakes; production uses the
   * browser Blob-URL worker factory below). */
  workerFactory?: WorkerFactory
  /** Max simultaneous workers (default 2; conservative mode should pass 1). */
  concurrency?: number
  now?: () => number
}

export interface CpuRunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (fraction: number, note?: string) => void
  /** Explicitly allow main-thread execution when workers are unavailable. */
  allowMainThreadFallback?: boolean
}

export type CpuRunResult<T> =
  | { ok: true; output: T; state: ComputeTaskState; durationMs: number; mainThread: boolean }
  | { ok: false; state: ComputeTaskState; reason: string; durationMs: number; mainThread: boolean }

interface PendingTask {
  id: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  worker: WorkerLike
  timedOut: boolean
  cancelled: boolean
  timeoutHandle: ReturnType<typeof setTimeout> | null
  onProgress?: (fraction: number, note?: string) => void
}

const DEFAULT_CONCURRENCY = 2
const DEFAULT_TASK_TIMEOUT_MS = 60_000

let taskSeq = 0
function nextTaskId(): string {
  taskSeq += 1
  return `cc-cpu-${Date.now().toString(36)}-${taskSeq}`
}

/** Default production worker factory: a Blob-URL Worker running the generic
 * kernel protocol. Returns null when Workers are unavailable. */
export function defaultWorkerFactory(): WorkerLike | null {
  try {
    if (typeof Worker !== 'function' || typeof URL?.createObjectURL !== 'function' || typeof Blob !== 'function') {
      return null
    }
    const source = WORKER_SOURCE
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = new Worker(url) as unknown as WorkerLike
    // The URL can be revoked immediately after construction in browsers.
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* revocation timing is not critical */
    }
    return worker
  } catch {
    return null
  }
}

/** The generic kernel protocol source. Executed inside the worker. */
export const WORKER_SOURCE = `
self.onmessage = function (event) {
  var msg = event.data;
  if (!msg || msg.type !== 'run') return;
  try {
    var fn = (new Function('return (' + msg.fnSource + ')'))();
    var postProgress = function (fraction, note) {
      self.postMessage({ type: 'progress', id: msg.id, fraction: fraction, note: note });
    };
    Promise.resolve(fn(msg.payload, { reportProgress: postProgress })).then(
      function (result) { self.postMessage({ type: 'done', id: msg.id, result: result }); },
      function (error) {
        self.postMessage({ type: 'error', id: msg.id, message: error && error.message ? String(error.message) : 'kernel failed' });
      }
    );
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, message: error && error.message ? String(error.message) : 'kernel failed to load' });
  }
};
`

export class CpuEngine {
  private readonly workerFactory: WorkerFactory
  private readonly concurrency: number
  private readonly now: () => number
  private active = 0
  private readonly queue: Array<() => void> = []
  private readonly pending = new Map<string, PendingTask>()

  constructor(deps: CpuEngineDeps = {}) {
    this.workerFactory = deps.workerFactory ?? defaultWorkerFactory
    this.concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY)
    this.now = deps.now ?? (() => Date.now())
  }

  /** Whether the worker lane exists in this environment. */
  workersAvailable(): boolean {
    return this.workerFactory() !== null
  }

  /** Current concurrency bound (diagnostics). */
  getConcurrency(): number {
    return this.concurrency
  }

  /** Number of tasks currently executing (diagnostics). */
  activeCount(): number {
    return this.active
  }

  /** Execute a self-contained kernel function in a worker (or, only when
   * explicitly allowed and workers are unavailable, on the main thread). */
  async runFunction<TInput, TOutput>(
    kernel: (payload: TInput, ctx: { reportProgress: (fraction: number, note?: string) => void }) => TOutput | Promise<TOutput>,
    payload: TInput,
    options: CpuRunOptions = {},
  ): Promise<CpuRunResult<TOutput>> {
    const started = this.now()
    const workerAvailable = this.workersAvailable()
    if (!workerAvailable) {
      if (options.allowMainThreadFallback !== true) {
        return { ok: false, state: 'CLIENT_CPU_AVAILABLE', reason: 'Web Workers are unavailable; heavy CPU work was refused to avoid blocking the main thread.', durationMs: 0, mainThread: false }
      }
      return this.runOnMainThread(kernel, payload, options, started)
    }
    return this.runInWorker(kernel, payload, options, started)
  }

  private async runOnMainThread<TInput, TOutput>(
    kernel: (payload: TInput, ctx: { reportProgress: (fraction: number, note?: string) => void }) => TOutput | Promise<TOutput>,
    payload: TInput,
    options: CpuRunOptions,
    started: number,
  ): Promise<CpuRunResult<TOutput>> {
    try {
      const output = await kernel(payload, { reportProgress: options.onProgress ?? (() => {}) })
      return { ok: true, output, state: 'CLIENT_CPU_AVAILABLE', durationMs: this.now() - started, mainThread: true }
    } catch (error) {
      const mapped = mapCpuErrorToState(error)
      return { ok: false, state: mapped.state, reason: mapped.reason, durationMs: this.now() - started, mainThread: true }
    }
  }

  private async runInWorker<TInput, TOutput>(
    kernel: (payload: TInput, ctx: { reportProgress: (fraction: number, note?: string) => void }) => TOutput | Promise<TOutput>,
    payload: TInput,
    options: CpuRunOptions,
    started: number,
  ): Promise<CpuRunResult<TOutput>> {
    // Acquire a concurrency slot (bounded pool).
    if (this.active >= this.concurrency) {
      await new Promise<void>((release) => this.queue.push(release))
    }
    this.active += 1
    const done = () => {
      this.active = Math.max(0, this.active - 1)
      const release = this.queue.shift()
      if (release) release()
    }

    const worker = this.workerFactory()
    if (!worker) {
      done()
      return { ok: false, state: 'CLIENT_EXECUTION_FAILED', reason: 'Worker creation failed.', durationMs: this.now() - started, mainThread: false }
    }

    const id = nextTaskId()
    const fnSource = safeSerializeKernel(kernel)
    if (fnSource === null) {
      done()
      return { ok: false, state: 'CLIENT_EXECUTION_FAILED', reason: 'Kernel could not be serialized for worker execution.', durationMs: this.now() - started, mainThread: false }
    }

    return await new Promise<CpuRunResult<TOutput>>((resolve) => {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
      const pending: PendingTask = {
        id,
        resolve: () => {},
        reject: () => {},
        worker,
        timedOut: false,
        cancelled: false,
        timeoutHandle: null,
        onProgress: options.onProgress,
      }
      const finish = (result: CpuRunResult<TOutput>) => {
        if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle)
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        try {
          worker.terminate()
        } catch {
          /* termination failures are not actionable */
        }
        this.pending.delete(id)
        done()
        resolve(result)
      }
      const fail = (state: ComputeTaskState, reason: string): void => {
        finish({ ok: false, state, reason, durationMs: this.now() - started, mainThread: false })
      }
      const onAbort = () => {
        pending.cancelled = true
        fail('CLIENT_EXECUTION_FAILED', 'The task was cancelled.')
      }

      worker.onmessage = (ev: { data?: unknown }) => {
        const msg = ev?.data as { type?: string; id?: string; fraction?: number; note?: string; result?: unknown; message?: string } | undefined
        if (!msg || msg.id !== id) return
        if (msg.type === 'progress') {
          const fraction = typeof msg.fraction === 'number' && Number.isFinite(msg.fraction) ? Math.min(1, Math.max(0, msg.fraction)) : 0
          pending.onProgress?.(fraction, typeof msg.note === 'string' ? msg.note : undefined)
          return
        }
        if (msg.type === 'done') {
          finish({ ok: true, output: msg.result as TOutput, state: 'CLIENT_CPU_AVAILABLE', durationMs: this.now() - started, mainThread: false })
          return
        }
        if (msg.type === 'error') {
          fail('CLIENT_EXECUTION_FAILED', msg.message ? `Worker kernel failed: ${msg.message}` : 'Worker kernel failed.')
        }
      }
      worker.onerror = (ev: { message?: string }) => {
        fail('CLIENT_EXECUTION_FAILED', ev?.message ? `Worker crashed: ${ev.message}` : 'Worker crashed before completing the task.')
      }

      pending.timeoutHandle = setTimeout(() => {
        pending.timedOut = true
        fail('CLIENT_EXECUTION_FAILED', 'CPU execution exceeded its time budget.')
      }, timeoutMs)

      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.pending.set(id, pending)
      try {
        worker.postMessage({ type: 'run', id, fnSource, payload })
      } catch (error) {
        fail('CLIENT_EXECUTION_FAILED', `Posting the task to the worker failed: ${describeError(error)}`)
      }
    })
  }

  /** Cancel every pending task and release slots (page shutdown handling). */
  releaseAll(): void {
    for (const pending of this.pending.values()) {
      pending.cancelled = true
      if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle)
      try {
        pending.worker.terminate()
      } catch {
        /* not actionable */
      }
    }
    this.pending.clear()
    this.active = 0
    for (const release of this.queue.splice(0)) release()
  }
}

/** Serialize a kernel for the worker lane. Returns null when the function
 * is not safely serializable (native/bound functions). */
export function safeSerializeKernel(kernel: unknown): string | null {
  try {
    if (typeof kernel !== 'function') return null
    const source = Function.prototype.toString.call(kernel)
    if (!source || source.length === 0) return null
    if (/\{\s*\[native code\]\s*\}/.test(source)) return null
    return source
  } catch {
    return null
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

let defaultEngine: CpuEngine | null = null
export function getDefaultCpuEngine(options?: CpuEngineDeps): CpuEngine {
  if (!defaultEngine) defaultEngine = new CpuEngine(options)
  return defaultEngine
}
