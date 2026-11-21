/**
 * Client compute — CPU engine: pool bounds, cancellation, crash honesty,
 * and kernel-serialization parity (the worker-lane safety contract).
 *
 * HONESTY LABEL: worker-concurrency logic is tested with injected fake
 * workers. Kernel parity is verified IN-PROCESS (serialized source vs direct
 * call). Real browser worker execution is verified separately and recorded
 * in the implementation report — these tests never claim it passed here.
 */
import { describe, test, expect } from 'bun:test'
import { CpuEngine, safeSerializeKernel, WORKER_SOURCE } from '@/lib/client-compute/cpu/engine'
import { preprocessImageKernel, chromaCutoutKernel } from '@/lib/client-compute/adapters/image-kernels'
import { codeAnalysisKernel } from '@/lib/client-compute/adapters/code-giftz'
import type { WorkerLike } from '@/lib/client-compute/cpu/engine'

/** Fake worker that runs the generic kernel protocol synchronously. */
function fakeWorkerFactory(options: { crash?: boolean; ignore?: boolean } = {}) {
  return (): WorkerLike | null => {
    const handlers: Array<(ev: { data?: unknown }) => void> = []
    const worker: WorkerLike = {
      postMessage: (data) => {
        const msg = data as { type: string; id: string; fnSource: string; payload: unknown }
        if (msg.type !== 'run') return
        if (options.crash) {
          setTimeout(() => worker.onerror?.({ message: 'fake crash' }), 0)
          return
        }
        setTimeout(() => {
          try {
            const fn = (new Function(`return (${msg.fnSource})`)()) as (payload: unknown, ctx: unknown) => unknown
            // Mirror the REAL worker protocol: await the kernel result and
            // forward progress messages.
            Promise.resolve(fn(msg.payload, {
              reportProgress: (fraction: number, note?: string) => {
                handlers.forEach((h) => h({ data: { type: 'progress', id: msg.id, fraction, note } }))
              },
            })).then(
              (result) => handlers.forEach((h) => h({ data: { type: 'done', id: msg.id, result } })),
              (error) => handlers.forEach((h) => h({ data: { type: 'error', id: msg.id, message: error instanceof Error ? error.message : 'failed' } })),
            )
          } catch (error) {
            handlers.forEach((h) => h({ data: { type: 'error', id: msg.id, message: error instanceof Error ? error.message : 'failed' } }))
          }
        }, 0)
      },
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }
    // Route worker.onmessage assignments into our handler list.
    Object.defineProperty(worker, 'onmessage', {
      get: () => handlers[0] ?? null,
      set: (fn) => {
        handlers.length = 0
        if (fn) handlers.push(fn)
      },
      configurable: true,
    })
    return worker
  }
}

describe('client-compute cpu engine', () => {
  test('runs a kernel through the worker protocol and resolves the result', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory(), concurrency: 2 })
    const out = await engine.runFunction((payload: { n: number }) => ({ doubled: payload.n * 2 }), { n: 21 })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.output.doubled).toBe(42)
      expect(out.mainThread).toBe(false)
      expect(out.state).toBe('CLIENT_CPU_AVAILABLE')
    }
  })

  test('kernel crash → honest CLIENT_EXECUTION_FAILED (never a fake success)', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory(), concurrency: 1 })
    const out = await engine.runFunction(() => {
      throw new Error('kernel exploded')
    }, {})
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.state).toBe('CLIENT_EXECUTION_FAILED')
      expect(out.reason).toMatch(/kernel exploded/)
    }
  })

  test('worker crash (onerror) → honest failure', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory({ crash: true }), concurrency: 1 })
    const out = await engine.runFunction(() => ({ ok: true }), {})
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/crashed/)
  })

  test('concurrency cap is enforced by the pool (serialized wall-clock)', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory(), concurrency: 1 })
    expect(engine.getConcurrency()).toBe(1)
    // Self-contained kernels (worker-lane contract): each sleeps ~15ms.
    const sleepKernel = (payload: { ms: number }) => new Promise((r) => setTimeout(() => r({}), payload.ms))
    const started = Date.now()
    await Promise.all([
      engine.runFunction(sleepKernel, { ms: 15 }),
      engine.runFunction(sleepKernel, { ms: 15 }),
      engine.runFunction(sleepKernel, { ms: 15 }),
    ])
    const elapsed = Date.now() - started
    // With concurrency 1 the three 15ms tasks must serialize (>= ~45ms).
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  test('cancellation: aborting the signal fails the task honestly', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory(), concurrency: 1 })
    const controller = new AbortController()
    // Abort mid-flight (the kernel sleeps 200ms).
    setTimeout(() => controller.abort(), 20)
    const out = await engine.runFunction(
      (payload: { ms: number }) => new Promise((r) => setTimeout(() => r({ ok: true }), payload.ms)),
      { ms: 200 },
      { signal: controller.signal },
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/cancel/i)
  })

  test('no workers + main-thread fallback refused → honest refusal (heavy work never blocks main thread by default)', async () => {
    const engine = new CpuEngine({ workerFactory: () => null, concurrency: 1 })
    const refused = await engine.runFunction(() => ({ ok: true }), {})
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/Workers are unavailable/)
    const allowed = await engine.runFunction(() => ({ ok: true }), {}, { allowMainThreadFallback: true })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.mainThread).toBe(true)
  })

  test('progress events forwarded through the protocol', async () => {
    const engine = new CpuEngine({ workerFactory: fakeWorkerFactory(), concurrency: 1 })
    const fractions: number[] = []
    const out = await engine.runFunction(
      (_payload: unknown, ctx: { reportProgress: (f: number) => void }) => {
        ctx.reportProgress(0.42)
        return {}
      },
      {},
      { onProgress: (f) => fractions.push(f) },
    )
    expect(out.ok).toBe(true)
    expect(fractions).toContain(0.42)
  })

  test('WORKER_SOURCE protocol is well-formed JS (generic kernel host)', () => {
    expect(WORKER_SOURCE).toContain('self.onmessage')
    expect(WORKER_SOURCE).toContain("'run'")
    expect(WORKER_SOURCE).toContain("'done'")
    expect(WORKER_SOURCE).toContain("'progress'")
    expect(WORKER_SOURCE).toContain("'error'")
  })
})

describe('client-compute kernel serialization parity (worker-lane contract)', () => {
  function serializeAndRun<TIn, TOut>(kernel: (payload: TIn, ctx: { reportProgress: (f: number, n?: string) => void }) => TOut, payload: TIn): TOut {
    const source = safeSerializeKernel(kernel)
    expect(source).not.toBeNull()
    const restored = new Function(`return (${source})`)() as typeof kernel
    return restored(payload, { reportProgress: () => {} })
  }

  test('preprocessImageKernel: serialized source behaves identically to direct call', () => {
    const payload = { pixels: new Uint8ClampedArray(8 * 8 * 4).fill(128), width: 8, height: 8, maxWidth: 4, maxHeight: 4 }
    const direct = preprocessImageKernel(payload)
    const viaWorker = serializeAndRun(preprocessImageKernel, payload)
    expect(viaWorker.width).toBe(direct.width)
    expect(viaWorker.height).toBe(direct.height)
    expect(viaWorker.scaleApplied).toBe(direct.scaleApplied)
    expect(Array.from(viaWorker.pixels)).toEqual(Array.from(direct.pixels))
  })

  test('chromaCutoutKernel: serialized source behaves identically to direct call', () => {
    const payload = greenCenterFixture()
    const direct = chromaCutoutKernel(payload)
    const viaWorker = serializeAndRun(chromaCutoutKernel, payload)
    expect(viaWorker.transparentFraction).toBeCloseTo(direct.transparentFraction, 10)
    expect(viaWorker.keyHue).toBe(direct.keyHue)
  })

  test('codeAnalysisKernel: serialized source behaves identically to direct call', () => {
    const payload = {
      files: [
        { path: 'a.ts', content: 'import { b } from "./b"\nexport const x = ((1 + 2))' },
        { path: 'b.ts', content: 'export const b = 2' },
        { path: 'c.ts', content: 'import { missing } from "./nowhere"' },
      ],
    }
    const direct = codeAnalysisKernel(payload)
    const viaWorker = serializeAndRun(codeAnalysisKernel, payload)
    expect(viaWorker.issues.length).toBe(direct.issues.length)
    expect(viaWorker.issues.map((i) => `${i.kind}:${i.path}`)).toEqual(direct.issues.map((i) => `${i.kind}:${i.path}`))
  })

  test('native/bound functions are refused (not serializable) honestly', () => {
    expect(safeSerializeKernel(Math.max)).toBeNull()
    expect(safeSerializeKernel('not a function')).toBeNull()
  })
})

function greenCenterFixture(): { pixels: Uint8ClampedArray; width: number; height: number } {
  const w = 32
  const h = 32
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const isCenter = x > 8 && x < 24 && y > 8 && y < 24
      if (isCenter) {
        pixels[i] = 200 // red object
        pixels[i + 1] = 30
        pixels[i + 2] = 30
      } else {
        pixels[i] = 30 // green screen border
        pixels[i + 1] = 200
        pixels[i + 2] = 50
      }
      pixels[i + 3] = 255
    }
  }
  return { pixels, width: w, height: h }
}
