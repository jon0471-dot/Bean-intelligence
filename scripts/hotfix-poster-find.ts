/** Find the failed BEAN INTELLIGENCE poster job + any recent laxii failures with detail. */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  // Search for the poster prompt (exact phrases from the brief)
  const posterJobs = await db.generationJob.findMany({
    where: {
      product: 'laxii',
      OR: [
        { paramsJson: { contains: 'INTELLIGENCE WITHOUT LIMITS' } },
        { paramsJson: { contains: 'BEAN INTELLIGENCE' } },
      ],
    },
    orderBy: { queuedAt: 'desc' },
    take: 10,
    select: { id: true, status: true, backendId: true, errorClass: true, errorCode: true, errorMessage: true, queuedAt: true, finishedAt: true, paramsJson: true, attempts: true },
  })
  console.log(`== poster-prompt jobs: ${posterJobs.length} ==`)
  for (const j of posterJobs) {
    let params: Record<string, unknown> = {}
    try { params = JSON.parse(j.paramsJson!) } catch {}
    console.log(JSON.stringify({
      id: j.id, status: j.status, backend: j.backendId, errorClass: j.errorClass,
      errorCode: j.errorCode, errorMessage: j.errorMessage, queuedAt: j.queuedAt,
      finishedAt: j.finishedAt, attempts: j.attempts,
      size: params.size, promptLen: (params.prompt as string)?.length,
      promptHead: (params.prompt as string)?.slice(0, 80),
    }, null, 1))
  }

  // All failed laxii jobs in the last 3 days with their params' size
  const failed = await db.generationJob.findMany({
    where: { product: 'laxii', status: 'failed', queuedAt: { gte: new Date(Date.now() - 3 * 86400_000) } },
    orderBy: { queuedAt: 'desc' },
    take: 20,
    select: { id: true, task: true, errorClass: true, errorCode: true, errorMessage: true, queuedAt: true, paramsJson: true },
  })
  console.log(`\n== all failed laxii jobs (3d): ${failed.length} ==`)
  for (const j of failed) {
    let size: unknown = null
    try { size = (JSON.parse(j.paramsJson!) as Record<string, unknown>).size ?? null } catch {}
    console.log(JSON.stringify({ id: j.id.slice(0, 12), task: j.task, errorClass: j.errorClass, errorCode: j.errorCode, msg: j.errorMessage?.slice(0, 90), queuedAt: j.queuedAt, size }))
  }
}
main().finally(() => db.$disconnect())
