import { db } from '@/lib/db'
const rows = await db.usageRecord.findMany({
  where: { success: false },
  orderBy: { createdAt: 'desc' },
  take: 8,
})
for (const r of rows) {
  console.log(JSON.stringify({
    at: r.createdAt.toISOString(), product: r.product, kind: r.kind,
    errorCode: r.errorCode, backendId: r.backendId, durationMs: r.durationMs,
    tokensIn: r.tokensIn, userId: r.userId.slice(0, 12),
  }))
}
process.exit(0)
