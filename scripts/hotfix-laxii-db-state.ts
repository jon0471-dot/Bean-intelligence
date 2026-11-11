/**
 * HOTFIX (LAXII T2I rate-limited) — evidence dump of the persisted state
 * that feeds the Text-to-Image capability verdict.
 * Read-only: queries GenerationJob rows + UsageRecord + SystemSetting.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const now = new Date()
  console.log('== NOW (UTC) ==', now.toISOString())

  const jobs = await db.generationJob.findMany({
    where: { product: 'laxii', task: 'image-generation' },
    orderBy: [{ queuedAt: 'desc' }],
    take: 15,
    select: {
      id: true, status: true, backendId: true, errorClass: true,
      errorCode: true, errorMessage: true, queuedAt: true, startedAt: true,
      finishedAt: true, attempts: true, paramsJson: true, resultJson: true,
    },
  })
  console.log(`== LAXII image-generation jobs (latest 15) ==`)
  for (const j of jobs) {
    console.log(JSON.stringify({
      id: j.id.slice(0, 8), status: j.status, backend: j.backendId,
      errorClass: j.errorClass, errorCode: j.errorCode,
      errorMessage: j.errorMessage?.slice(0, 140),
      queuedAt: j.queuedAt, finishedAt: j.finishedAt, attempts: j.attempts,
      params: j.paramsJson?.slice(0, 90),
    }))
  }

  // The exact rows the evidence chain reads:
  const latestFailed = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-generation', status: 'failed', backendId: 'bean-image-hosted-primary' },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, errorClass: true, errorCode: true, errorMessage: true },
  })
  console.log('\n== persistedUpstreamFailure source row (latest FAILED hosted T2I) ==')
  console.log(JSON.stringify(latestFailed, null, 2))

  const latestCompleted = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-generation', status: 'completed', backendId: 'bean-image-hosted-primary' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true, id: true },
  })
  console.log('\n== persistedAttempt source row (latest COMPLETED hosted T2I) ==')
  console.log(JSON.stringify(latestCompleted, null, 2))

  // Any laxii failed rows of other tasks (editing) — cross-contamination check
  const latestFailedAnyTask = await db.generationJob.findFirst({
    where: { product: 'laxii', status: 'failed' },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, task: true, backendId: true, errorClass: true, errorCode: true },
  })
  console.log('\n== latest FAILED laxii row of ANY task ==')
  console.log(JSON.stringify(latestFailedAnyTask, null, 2))

  // Active/duplicate-guard state: non-terminal jobs
  const active = await db.generationJob.findMany({
    where: { product: 'laxii', status: { in: ['queued', 'starting', 'running', 'streaming', 'finalizing', 'retry_wait'] } },
    orderBy: { queuedAt: 'desc' },
    take: 10,
    select: { id: true, status: true, task: true, queuedAt: true, startedAt: true, attempts: true, dedupeKey: true },
  })
  console.log('\n== ACTIVE laxii jobs (duplicate-guard / queue depth) ==')
  console.log(JSON.stringify(active.map((a) => ({ id: a.id.slice(0, 8), status: a.status, task: a.task, queuedAt: a.queuedAt, startedAt: a.startedAt, attempts: a.attempts })), null, 2))

  // Usage records for laxii today (account-quota basis)
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)
  const usageToday = await db.usageRecord.count({ where: { createdAt: { gte: startOfDay } } })
  const usageLaxiiToday = await db.usageRecord.count({ where: { createdAt: { gte: startOfDay }, product: 'laxii' } })
  console.log(`\n== UsageRecord today (UTC) == total=${usageToday} laxii=${usageLaxiiToday}`)

  const recentUsage = await db.usageRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { createdAt: true, product: true, kind: true, success: true, errorCode: true },
  })
  console.log('== Latest usage rows ==')
  for (const u of recentUsage) console.log(JSON.stringify(u))

  const settings = await db.systemSetting.findMany()
  console.log('\n== SystemSetting rows ==')
  console.log(JSON.stringify(settings, null, 2))
}

main().finally(() => db.$disconnect())
