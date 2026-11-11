/**
 * HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11): single-shot monitor for the
 * recovery jobs — prints status, persisted throttle budget and (on completion)
 * the artifact reference so bytes can be validated from disk. Read-only.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const ids = process.argv.slice(2)
  const now = Date.now()
  const jobs = await db.generationJob.findMany({
    where: ids.length ? { id: { in: ids } } : { product: 'laxii' },
    orderBy: { queuedAt: 'desc' },
    take: ids.length ? ids.length : 5,
  })
  for (const j of jobs) {
    const next = (j as unknown as { nextRunAt?: Date | null }).nextRunAt
    console.log(`--- ${j.id}`)
    console.log(`  task=${j.task} status=${j.status} attempts=${j.attempts}/${j.maxAttempts} errorClass=${j.errorClass} errorCode=${j.errorCode}`)
    console.log(`  queuedAt=${j.queuedAt?.toISOString()} finishedAt=${j.finishedAt?.toISOString()} nextRunAt=${next ? next.toISOString() + (next.getTime() > now ? ` (in ${Math.round((next.getTime() - now) / 1000)}s)` : ' (DUE)') : '-'}`)
    if (j.resultJson) console.log(`  resultJson=${j.resultJson.slice(0, 600)}`)
    if (j.errorMessage) console.log(`  errorMessage=${j.errorMessage.slice(0, 300)}`)
  }
}

main().finally(() => db.$disconnect())
