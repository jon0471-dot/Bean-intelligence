import { db } from '@/lib/db'
const since = new Date(Date.now() - 36 * 3600 * 1000)
const fails = await db.usageRecord.findMany({
  where: { success: false, createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
  take: 100,
  select: { createdAt: true, product: true, kind: true, errorCode: true },
})
console.log('FAILED usage rows last 36h:', fails.length)
const byHour: Record<string, number> = {}
const byCode: Record<string, number> = {}
for (const f of fails) {
  const h = f.createdAt.toISOString().slice(0, 13)
  byHour[h] = (byHour[h] ?? 0) + 1
  byCode[`${f.product}:${f.kind}:${f.errorCode}`] = (byCode[`${f.product}:${f.kind}:${f.errorCode}`] ?? 0) + 1
}
console.log('by hour:', JSON.stringify(byHour))
console.log('by code:', JSON.stringify(byCode))
const ok = await db.usageRecord.count({ where: { success: true, createdAt: { gte: since }, kind: 'chat' } })
console.log('successful chat rows last 36h:', ok)
process.exit(0)
