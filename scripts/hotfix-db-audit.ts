/**
 * HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11): read-only audit of the
 * persisted attempt evidence for the three LAXII capabilities — newest rows
 * per evidence class, with timestamps, so stale vs genuine failures can be
 * distinguished before any fix is applied.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function iso(d: Date | null): string {
  return d ? d.toISOString() : 'null'
}

async function main() {
  const now = Date.now()
  console.log(`NOW = ${new Date(now).toISOString()}\n`)

  // 1. Newest 14 LAXII rows of any status (the real chronology).
  const rows = await db.generationJob.findMany({
    where: { product: 'laxii' },
    orderBy: [{ queuedAt: 'desc' }],
    take: 14,
    select: {
      task: true, status: true, errorClass: true, backendId: true,
      queuedAt: true, finishedAt: true, paramsJson: true, errorCode: true,
    },
  })
  console.log('=== LAXII newest 14 jobs (any status) ===')
  for (const r of rows) {
    let mode = ''
    try {
      const p = JSON.parse(r.paramsJson ?? '{}') as Record<string, unknown>
      mode = typeof p.mode === 'string' ? p.mode : (p.prompt ? 't2i/edit-prompt' : '')
    } catch { mode = '?' }
    const ageMin = r.finishedAt ? Math.round((now - r.finishedAt.getTime()) / 60000) : null
    console.log(
      `${iso(r.finishedAt)} (age ${ageMin}m) ${r.task.padEnd(18)} ${r.status.padEnd(10)} ` +
      `err=${(r.errorClass ?? r.errorCode ?? '-').toString().padEnd(14)} backend=${r.backendId} mode=${mode}`
    )
  }

  // 2. What the evidence functions return, per capability.
  const editFail = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-editing', status: 'failed', backendId: 'bean-image-hosted-edit' },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, errorClass: true },
  })
  const editDone = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-editing', status: 'completed', backendId: 'bean-image-hosted-edit' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  })
  const bgFail = await db.generationJob.findFirst({
    where: {
      product: 'laxii', task: 'image-editing', status: 'failed',
      backendId: 'bean-image-hosted-edit', paramsJson: { contains: '"mode":"background-removal"' },
    },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, errorClass: true },
  })
  const bgDone = await db.generationJob.findFirst({
    where: {
      product: 'laxii', task: 'image-editing', status: 'completed',
      backendId: 'bean-image-hosted-edit', paramsJson: { contains: '"mode":"background-removal"' },
    },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  })
  const t2iFail = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-generation', status: 'failed', backendId: 'bean-image-hosted-primary' },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, errorClass: true },
  })
  const t2iDone = await db.generationJob.findFirst({
    where: { product: 'laxii', task: 'image-generation', status: 'completed', backendId: 'bean-image-hosted-primary' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  })

  console.log('\n=== Evidence per capability (as the current functions read it) ===')
  const fmt = (label: string, r: { finishedAt: Date | null; errorClass?: string | null } | null) => {
    if (!r || !r.finishedAt) return console.log(`${label}: none`)
    const ageMin = Math.round((now - r.finishedAt.getTime()) / 60000)
    console.log(`${label}: ${iso(r.finishedAt)} age=${ageMin}m err=${r.errorClass ?? '-'} fresh(15m)=${ageMin <= 15}`)
  }
  fmt('T2I  latest FAILED (upstream)', t2iFail)
  fmt('T2I  latest COMPLETED        ', t2iDone)
  fmt('EDIT latest FAILED (upstream)', editFail)
  fmt('EDIT latest COMPLETED        ', editDone)
  fmt('BG   latest FAILED (upstream)', bgFail)
  fmt('BG   latest COMPLETED        ', bgDone)

  // 3. Isolation check: how many 'image-editing' rows are bg-removal rows?
  const editAll = await db.generationJob.count({
    where: { product: 'laxii', task: 'image-editing', backendId: 'bean-image-hosted-edit' },
  })
  const bgAll = await db.generationJob.count({
    where: {
      product: 'laxii', task: 'image-editing', backendId: 'bean-image-hosted-edit',
      paramsJson: { contains: '"mode":"background-removal"' },
    },
  })
  const noParams = await db.generationJob.count({
    where: { product: 'laxii', task: 'image-editing', backendId: 'bean-image-hosted-edit', paramsJson: '' },
  })
  console.log(`\n=== Isolation ===`)
  console.log(`image-editing rows (hosted-edit): ${editAll}, of which bg-removal-marked: ${bgAll}, paramsJson empty: ${noParams}`)

  // 4. Any queued/stuck rows right now (queue state)?
  const queued = await db.generationJob.count({ where: { product: 'laxii', status: { in: ['queued', 'retry_wait', 'processing'] } } })
  console.log(`laxii queued/retry_wait/processing right now: ${queued}`)
}

main().finally(() => db.$disconnect())
