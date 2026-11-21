/**
 * M28 Priority G evidence probe: run ONE real speech-synthesis job through
 * the actual queue + worker, then print the resulting Trust receipt's
 * verification states + evidence rows (the final report's receipt evidence).
 * Cleans up its disposable user afterwards.
 */
import { db } from '../src/lib/db'
import { enqueueJob } from '../src/lib/jobs/queue'

async function main() {
  const user = await db.user.create({ data: { email: `m28-receipt-probe-${Date.now()}@test.local`, passwordHash: 'x' } })
  try {
    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'speech-synthesis',
        status: 'queued',
        progress: 0,
        paramsJson: JSON.stringify({
          text: 'Trust receipt evidence probe for the M28 six-state verification contract.',
          voice: 'af_heart',
          speed: 1,
        }),
      },
    })
    await enqueueJob(job.id)
    // Poll to completion (embedded pools run the real worker).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const row = await db.generationJob.findUnique({ where: { id: job.id } })
      if (row && ['completed', 'failed', 'cancelled', 'completed_with_limitations'].includes(row.status)) {
        console.log('job status:', row.status, '| backend:', row.backendId)
        break
      }
    }
    const receipt = await db.trustTask.findFirst({ where: { jobId: job.id }, include: { steps: true, evidence: true } })
    if (!receipt) {
      console.log('NO RECEIPT — failure')
      process.exit(1)
    }
    console.log('\n=== Trust receipt ===')
    console.log('kind:', receipt.kind, '| status:', receipt.status)
    console.log('verificationSummary:', receipt.verificationSummary?.slice(0, 700))
    console.log('\n=== Evidence rows ===')
    for (const e of receipt.evidence) {
      console.log(`- [${e.kind}] ${e.title}`)
      if (e.note) console.log(`    ${e.note.slice(0, 400)}`)
    }
    process.exit(0)
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined)
  }
}

main().catch((e) => {
  console.error('probe failed:', e)
  process.exit(1)
})
