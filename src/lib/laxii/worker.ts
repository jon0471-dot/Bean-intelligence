/**
 * LAXII — Node-side client for the local Python Diffusers worker
 * (workers/laxii-diffusers/worker.py).
 *
 * Design rules (matching the BEAN honesty contract):
 *  - The worker is spawned ON DEMAND and treated as a real process: spawn
 *    failures, timeouts and crashes are reported as WORKER_UNAVAILABLE /
 *    WORKER_ERROR — never swallowed, never converted into success.
 *  - Progress events are forwarded to a callback so jobs can show real
 *    step counts.
 *  - Cancellation is cooperative: a `cancel` request flips a flag the
 *    worker checks at every diffusion step.
 *  - The singleton lives on globalThis because Next.js can instantiate a
 *    route's module graph more than once (same pattern as the health cache
 *    and the research breaker).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import { logger } from '@/lib/observability/logger'

export interface WorkerError extends Error {
  code: string
}

function workerError(code: string, message: string): WorkerError {
  const e = new Error(message) as WorkerError
  e.code = code
  return e
}

export interface PreflightReport {
  workerVersion: string
  ok: boolean
  python: { version: string; ok: boolean }
  packages: Record<string, { present: boolean; version?: string | null; purpose: string }>
  missingPackages: string[]
  cuda: {
    available: boolean
    device: string | null
    vramTotalGb: number | null
    vramFreeGb: number | null
    fp16: boolean
    bf16: boolean
    error?: string
  }
  disk: { modelsDir: string; freeGb: number | null; sufficient: boolean | null; error?: string }
  models: Array<{
    id: string
    present: boolean
    path?: string
    sizeGb?: number
    checksumVerified?: boolean | null
  }>
  notes: string[]
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: WorkerError) => void
  timer: ReturnType<typeof setTimeout>
  onProgress?: (step: number, total: number | null) => void
}

interface WorkerSingleton {
  proc: ChildProcessWithoutNullStreams | null
  starting: Promise<void> | null
  pending: Map<string, PendingRequest>
  nextId: number
  buffer: string
  crashed: boolean
}

const GLOBAL_KEY = '__bean_laxii_worker__'

function singleton(): WorkerSingleton {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      proc: null,
      starting: null,
      pending: new Map(),
      nextId: 1,
      buffer: '',
      crashed: false,
    } satisfies WorkerSingleton
  }
  return g[GLOBAL_KEY] as WorkerSingleton
}

function workerPath(): string {
  return path.join(process.cwd(), 'workers', 'laxii-diffusers', 'worker.py')
}

function modelsDir(): string {
  return process.env.LAXII_WORKER_MODELS_DIR
    ? path.resolve(process.env.LAXII_WORKER_MODELS_DIR)
    : path.join(process.cwd(), 'workers', 'laxii-diffusers', 'models')
}

function pythonBin(): string {
  return process.env.LAXII_WORKER_PYTHON || 'python3'
}

function killProc(state: WorkerSingleton, why: string): void {
  if (state.proc) {
    try {
      state.proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    state.proc = null
  }
  state.starting = null
  const err = workerError('WORKER_UNAVAILABLE', `Worker process unavailable (${why}).`)
  for (const [, p] of state.pending) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  state.pending.clear()
}

async function ensureWorker(state: WorkerSingleton): Promise<void> {
  if (state.proc) return
  if (state.starting) return state.starting
  state.starting = (async () => {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(workerError('WORKER_UNAVAILABLE', 'Worker did not signal readiness within 10s.')), 10_000)
      state.pending.set('__ready__', {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
        timer,
      })
    })
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(pythonBin(), [workerPath(), '--models-dir', modelsDir()], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
    } catch (e) {
      // Some runtimes (Bun) throw synchronously on ENOENT instead of
      // emitting the async 'error' event — convert to a truthful code.
      const message = e instanceof Error ? e.message : String(e)
      const err = workerError('WORKER_UNAVAILABLE', `Worker process could not start: ${message}.`)
      const readyEntry = state.pending.get('__ready__')
      state.pending.delete('__ready__')
      readyEntry?.reject(err)
      state.starting = null
      throw err
    }
    state.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => handleStdout(state, chunk))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (line) logger.debug('laxii.worker_stderr', { line: line.slice(0, 300) })
    })
    proc.on('exit', (code) => {
      logger.warn('laxii.worker_exit', { code })
      killProc(state, `process exited (code ${code})`)
      state.crashed = true
    })
    // Spawn failures (missing interpreter, bad cwd) arrive on the 'error'
    // event — without this handler the process throws an uncaught exception
    // instead of a truthful WORKER_UNAVAILABLE.
    proc.on('error', (e) => {
      logger.warn('laxii.worker_spawn_error', { message: e.message })
      const err = workerError('WORKER_UNAVAILABLE', `Worker process could not start: ${e.message}.`)
      killProc(state, e.message) // clears proc, starting, and all pending
      const ready = state.pending.get('__ready__')
      if (ready) {
        state.pending.delete('__ready__')
        ready.reject(err)
      }
    })
    proc.stdin.on('error', (e) => logger.warn('laxii.worker_stdin_error', { message: e.message }))
    await ready
  })()
  try {
    await state.starting
  } finally {
    if (!state.proc) state.starting = null
  }
}

function handleStdout(state: WorkerSingleton, chunk: string): void {
  state.buffer += chunk
  let idx: number
  while ((idx = state.buffer.indexOf('\n')) >= 0) {
    const line = state.buffer.slice(0, idx).trim()
    state.buffer = state.buffer.slice(idx + 1)
    if (!line) continue
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      logger.warn('laxii.worker_bad_line', { line: line.slice(0, 200) })
      continue
    }
    if (msg.type === 'ready') {
      const ready = state.pending.get('__ready__')
      if (ready) {
        state.pending.delete('__ready__')
        ready.resolve({})
      }
      continue
    }
    if (msg.type === 'progress') {
      const p = state.pending.get(String(msg.id))
      if (p?.onProgress) {
        p.onProgress(Number(msg.step ?? 0), msg.total == null ? null : Number(msg.total))
      }
      continue
    }
    const p = state.pending.get(String(msg.id))
    if (!p) continue
    state.pending.delete(String(msg.id))
    clearTimeout(p.timer)
    if (msg.ok === true) p.resolve((msg.result as Record<string, unknown>) ?? {})
    else {
      const err = msg.error as { code?: string; message?: string } | undefined
      p.reject(workerError(err?.code ?? 'WORKER_ERROR', err?.message ?? 'Worker returned an unspecified error.'))
    }
  }
}

/**
 * Issue one request to the worker. Throws WorkerError with truthful codes:
 *  WORKER_UNAVAILABLE (spawn/ready/timeout) or the worker's own code
 *  (UNAVAILABLE, MODEL_MISSING, CANCELLED, BACKEND_FAILURE, ...).
 */
export async function workerRequest(
  method: string,
  params: Record<string, unknown>,
  opts: { timeoutMs?: number; onProgress?: (step: number, total: number | null) => void } = {},
): Promise<Record<string, unknown>> {
  const state = singleton()
  try {
    await ensureWorker(state)
  } catch (e) {
    killProc(state, e instanceof Error ? e.message : String(e))
    throw e
  }
  const id = `r${state.nextId++}`
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id)
      // The worker may be wedged on a long model load; fail this request
      // without killing the process — the next request reuses it if alive.
      reject(workerError('WORKER_TIMEOUT', `Worker method '${method}' exceeded ${opts.timeoutMs ?? 120_000}ms.`))
    }, opts.timeoutMs ?? 120_000)
    state.pending.set(id, { resolve, reject, timer, onProgress: opts.onProgress })
    state.proc!.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}

/** Ask the worker what is missing on THIS host. Never fabricates. */
export async function workerPreflight(timeoutMs = 20_000): Promise<PreflightReport> {
  const result = await workerRequest('preflight', { modelsDir: modelsDir() }, { timeoutMs })
  return result as unknown as PreflightReport
}

export async function workerCancel(targetId: string): Promise<Record<string, unknown>> {
  return workerRequest('cancel', { targetId }, { timeoutMs: 5_000 })
}

export async function workerUnload(): Promise<void> {
  await workerRequest('unload', {}, { timeoutMs: 15_000 })
}

/** Terminate the worker process (used by tests and graceful shutdown). */
export function workerStop(): void {
  killProc(singleton(), 'stopped')
}
