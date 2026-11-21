/**
 * Test helper — a protocol-faithful FAKE worker factory for client-compute
 * CPU-engine tests. It mirrors the real WORKER_SOURCE protocol exactly
 * (run → progress/done/error, awaiting kernel results) so engine and
 * adapter flows can be tested in-process.
 *
 * HONESTY LABEL: this is a fake worker for LOGIC tests only. It never
 * counts as real browser worker execution — that is verified separately
 * (see docs/BEAN-CLIENT-COMPUTE-IMPLEMENTATION-REPORT.md).
 */
import type { WorkerLike } from '@/lib/client-compute/cpu/engine'

export function fakeWorkerFromSource(): WorkerLike | null {
  const handlers: Array<(ev: { data?: unknown }) => void> = []
  const worker: WorkerLike = {
    postMessage: (data) => {
      const msg = data as { type: string; id: string; fnSource: string; payload: unknown }
      if (msg.type !== 'run') return
      setTimeout(() => {
        try {
          const fn = new Function(`return (${msg.fnSource})`)() as (
            payload: unknown,
            ctx: { reportProgress: (fraction: number, note?: string) => void },
          ) => unknown
          Promise.resolve(
            fn(msg.payload, {
              reportProgress: (fraction: number, note?: string) => {
                handlers.forEach((h) => h({ data: { type: 'progress', id: msg.id, fraction, note } }))
              },
            }),
          ).then(
            (result) => handlers.forEach((h) => h({ data: { type: 'done', id: msg.id, result } })),
            (error) =>
              handlers.forEach((h) =>
                h({ data: { type: 'error', id: msg.id, message: error instanceof Error ? error.message : 'kernel failed' } }),
              ),
          )
        } catch (error) {
          handlers.forEach((h) =>
            h({ data: { type: 'error', id: msg.id, message: error instanceof Error ? error.message : 'kernel failed to load' } }),
          )
        }
      }, 0)
    },
    terminate: () => {},
    onmessage: null,
    onerror: null,
  }
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
