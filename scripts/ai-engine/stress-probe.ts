/**
 * Engine stress probe: reproduce the settle stall seen in live acceptance.
 * Runs claim→fail cycles against the REAL local DB (standalone process)
 * while parallel readers hammer the queue, and reports any cycle whose
 * settle exceeds 2s.
 */
import '../../src/lib/env'

async function main() {
  const { db } = await import('../../src/lib/db')
  const { claimNextJob, finishFailed } = await import('../../src/lib/ai-engine/queue')
  const { appendJobEvent } = await import('../../src/lib/ai-engine/events')

  const userId = 'stress-probe-user'
  // FK target: create the probe user if missing, remember to clean up.
  const existing = await db.user.findUnique({ where: { id: userId } })
  if (!existing) {
    await db.user.create({
      data: { id: userId, email: 'stress-probe@bean-test.local', passwordHash: 'x', name: 'Stress Probe' },
    })
  }
  const created: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const j = await db.generationJob.create({
      data: {
        userId,
        product: 'riishe',
        task: 'chat',
        capability: 'chat',
        status: 'queued',
        paramsJson: JSON.stringify({ n: i }),
      },
    })
    created.push(j.id)
  }

  // Parallel readers hammering (like polls + health do in production).
  const readers = Array.from({ length: 3 }, () =>
    (async () => {
      for (let i = 0; i < 400; i += 1) {
        await db.generationJob.findFirst({ where: { userId } })
        await new Promise((r) => setTimeout(r, 5))
      }
    })(),
  )

  // Event-append transactions in parallel (like a streaming chat).
  const appender = (async () => {
    for (let i = 0; i < 200; i += 1) {
      await appendJobEvent(created[0], 'stage', { i })
      await new Promise((r) => setTimeout(r, 10))
    }
  })()

  let slow = 0
  for (const id of created) {
    const t0 = Date.now()
    const claimed = await claimNextJob({ jobId: id, workerId: 'stress', workerKind: 'standalone' })
    if (!claimed) {
      console.log('CLAIM FAILED', id)
      continue
    }
    await appendJobEvent(id, 'stage', { stage: 'solving' })
    await finishFailed(id, 'stress', {
      errorClass: 'rate_limited',
      errorCode: 'UPSTREAM_RATE_LIMITED',
      errorMessage: 'stress probe throttle',
    })
    const dt = Date.now() - t0
    if (dt > 2_000) {
      slow += 1
      console.log(`SLOW CYCLE ${id}: ${dt}ms`)
    }
  }
  await Promise.all([...readers, appender])

  const stuck = await db.generationJob.findMany({ where: { id: { in: created }, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } } })
  console.log(`cycles=40 slowCycles=${slow} stillActive=${stuck.length}`)
  await db.jobEvent.deleteMany({ where: { jobId: { in: created } } })
  await db.generationJob.deleteMany({ where: { id: { in: created } } })
  if (!existing) await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  process.exit(0)
}

void main()
