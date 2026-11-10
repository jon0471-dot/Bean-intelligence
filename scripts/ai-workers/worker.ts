/**
 * BEAN Intelligence — standalone background AI worker process.
 *
 * Runs one product's worker pool as a SEPARATE OS process (process
 * isolation, dedicated GPU hosts, ops-controlled scaling). Claims are CAS'd
 * in the database so this can run beside the embedded engine safely —
 * first claim wins, leases recover crashes, exactly-once execution.
 *
 * Usage:
 *   bun scripts/ai-workers/worker.ts --product riishe   [--concurrency 2]
 *   bun scripts/ai-workers/worker.ts --product laxii
 *   bun scripts/ai-workers/worker.ts --product jazmii
 *   bun scripts/ai-workers/worker.ts --product code-giftz
 *   bun scripts/ai-workers/worker.ts --all              (all four pools)
 *
 * Stop: SIGINT/SIGTERM (graceful — in-flight jobs finish, then exit).
 */

import '../../src/lib/env' // DATABASE_URL default for standalone execution

async function main() {
  const args = process.argv.slice(2)
  const getArg = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const product = getArg('--product')
  const all = args.includes('--all')
  const concurrency = getArg('--concurrency') ? Number(getArg('--concurrency')) : undefined
  if (!product && !all) {
    console.error('usage: worker.ts --product <riishe|laxii|jazmii|code-giftz> [--concurrency N] | --all')
    process.exit(2)
  }

  const { startWorkerPool } = await import('../../src/lib/ai-engine/runner')
  const { engineConfig } = await import('../../src/lib/ai-engine/config')
  const cfg = engineConfig()

  const products = all
    ? (['riishe', 'laxii', 'jazmii', 'code-giftz'] as const)
    : [product as 'riishe' | 'laxii' | 'jazmii' | 'code-giftz']

  const handles: Array<{ stop: () => Promise<void> }> = []
  for (const p of products) {
    const handle = startWorkerPool(p, 'standalone', concurrency)
    if (handle) {
      console.log(`[worker] pool started product=${p} concurrency=${concurrency ?? cfg.concurrency[p]} id=${handle.workerId}`)
      handles.push(handle)
    } else {
      console.error(`[worker] pool for ${p} is already running in this process`)
    }
  }
  if (handles.length === 0) process.exit(1)

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    console.log('[worker] stopping gracefully (in-flight jobs finish first)…')
    await Promise.all(handles.map((h) => h.stop()))
    process.exit(0)
  }
  // Bun implements Node's signal API; the shared tsconfig's bun types only
  // enumerate 'memoryPressure', so route through a narrow structural cast.
  const proc = process as unknown as { on: (signal: string, cb: () => void) => void }
  proc.on('SIGINT', () => void stop())
  proc.on('SIGTERM', () => void stop())
  console.log('[worker] running — Ctrl+C to stop')
}

void main()
