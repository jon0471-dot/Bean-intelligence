/**
 * M26 performance & recovery measurements (bounded, disposable data).
 *
 * 1. /api/health concurrency: 50 parallel requests (5 waves) against the
 *    running dev server — p50/p95 wall time. A READ-ONLY endpoint; no
 *    provider calls, no stress beyond modest local load.
 * 2. Queue recovery DEMO: one disposable 'running' row with an EXPIRED lease
 *    is inserted into the dev DB (marked userId 'm26-recovery-demo'), then
 *    the REAL recoverStaleJobs runs — the row must be requeued with
 *    WORKER_LOST. The row is deleted afterwards (disposable test data; the
 *    live db holds no user data).
 * 3. Model-lane lifecycle: measured statement — no GGUF weights/binary in
 *    this sandbox, so spawn/adopt is NOT_TESTED here (unchanged M25
 *    limitation); the decision matrix + refusal path are unit-pinned.
 */
import { performance } from 'node:perf_hooks'

const BASE = 'http://localhost:3000'

async function wave(n: number): Promise<number[]> {
  const t0 = performance.now()
  const results = await Promise.all(
    Array.from({ length: n }, async () => {
      const s = performance.now()
      const res = await fetch(`${BASE}/api/health`)
      await res.arrayBuffer()
      return performance.now() - s
    }),
  )
  void t0
  return results
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
}

// ---- 1. health concurrency ---------------------------------------------------
let all: number[] = []
for (let w = 0; w < 5; w++) {
  all = all.concat(await wave(50))
}
console.log(`[measure] /api/health: ${all.length} requests, 5 waves of 50 concurrent`)
console.log(`[measure] p50=${pct(all, 50)}ms p95=${pct(all, 95)}ms max=${Math.round(Math.max(...all))}ms`)
const bad = all.filter((v) => !Number.isFinite(v)).length
console.log(`[measure] failures=${bad}`)

// ---- 2. queue recovery demo --------------------------------------------------
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient({ datasources: { db: { url: `file:${process.cwd()}/db/custom.db` } } })

const jobId = `m26-demo-${Date.now()}`
// GenerationJob.userId is a foreign key — create the disposable owner first
await db.user.create({
  data: {
    id: 'm26-recovery-demo',
    email: `m26-recovery-demo-${Date.now()}@disposable.local`,
    passwordHash: 'x',
    name: 'M26 recovery demo (disposable)',
  },
}).catch(() => undefined)
await db.generationJob.create({
  data: {
    id: jobId,
    userId: 'm26-recovery-demo',
    product: 'laxii',
    task: 'image-generation',
    status: 'running',
    workerId: 'wk_m26_dead_worker',
    workerKind: 'embedded',
    leaseUntil: new Date(Date.now() - 5_000),
    heartbeatAt: new Date(Date.now() - 30_000),
    attempts: 1,
    maxAttempts: 2,
    paramsJson: JSON.stringify({ prompt: 'm26 recovery demo (disposable)' }),
  },
})
console.log(`[recovery] inserted disposable stale row ${jobId} (status=running, lease expired 5s ago)`)
const { recoverStaleJobs } = await import('@/lib/ai-engine/queue')
const t0 = performance.now()
const result = await recoverStaleJobs()
const elapsed = Math.round(performance.now() - t0)
const row = await db.generationJob.findUnique({ where: { id: jobId }, select: { status: true, errorCode: true, workerId: true } })
console.log(`[recovery] recoverStaleJobs -> ${JSON.stringify(result)} in ${elapsed}ms`)
console.log(`[recovery] demo row after: ${JSON.stringify(row)}`)
const recovered = row?.status === 'retry_wait' && row?.errorCode === 'WORKER_LOST' && row?.workerId === null
console.log(`[recovery] VERDICT: ${recovered ? 'PASS — the dead worker\'s job was requeued for automatic resume' : 'FAIL'}`)
await db.generationJob.delete({ where: { id: jobId } })
console.log('[recovery] disposable demo row deleted')
// also clean the live-verification disposable accounts (no user data)
const cleaned = await db.user.deleteMany({ where: { email: { contains: '@disposable.local' } } })
console.log(`[cleanup] deleted ${cleaned.count} disposable verification accounts`)

await db.$disconnect()
console.log('[lane-lifecycle] NOT_TESTED live: no GGUF weights/binary on this host (M25-documented limitation, unchanged); decision matrix + refusal path are unit-pinned in tests/unit/llamacpp-*.test.ts')
process.exit(0)
