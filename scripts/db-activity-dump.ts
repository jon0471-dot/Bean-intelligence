/**
 * Read recent generation activity + audit entries from the BEAN database.
 * Answers: when did real LLM/audio traffic last succeed (429-free)?
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const usage = await (db as unknown as {
    usageRecord: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> }
  }).usageRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 15 })
  console.log('=== UsageRecords (latest 15):')
  for (const u of usage) {
    console.log(
      `${(u.createdAt as Date).toISOString()} product=${String(u.product)} kind=${String(u.kind)} status=${String(u.status ?? '')} ok=${String(u.success ?? u.ok ?? '')}`,
    )
  }

  const jobs = await (db as unknown as {
    generationJob: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> }
  }).generationJob.findMany({ orderBy: { createdAt: 'desc' }, take: 15 })
  console.log('=== GenerationJobs (latest 15):')
  for (const j of jobs) {
    console.log(
      `${(j.createdAt as Date).toISOString()} task=${String(j.task)} status=${String(j.status)} error=${String(j.errorMessage ?? '').slice(0, 80)}`,
    )
  }

  const audits = await (db as unknown as {
    auditLog: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> }
  }).auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 })
  console.log('=== AuditLogs (latest 15):')
  for (const a of audits) {
    console.log(
      `${(a.createdAt as Date).toISOString()} action=${String(a.action)} detail=${String(a.detail ?? a.meta ?? '').slice(0, 100)}`,
    )
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
