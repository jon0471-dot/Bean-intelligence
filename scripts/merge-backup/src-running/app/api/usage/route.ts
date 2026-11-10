import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { PRODUCT_DAILY_QUOTAS } from '@/lib/auth/ratelimit'

/** Per-user usage rollup. Token counts are ESTIMATES (~4 chars/token) where
 *  the provider does not report exact usage; cost is always null because the
 *  gateway reports no cost data — BEAN never invents cost figures. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const records = await db.usageRecord.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const byProduct: Record<
      string,
      { requests: number; successes: number; failures: number; tokensIn: number; tokensOut: number; images: number; totalDurationMs: number }
    > = {}
    for (const r of records) {
      const agg = (byProduct[r.product] ??= {
        requests: 0,
        successes: 0,
        failures: 0,
        tokensIn: 0,
        tokensOut: 0,
        images: 0,
        totalDurationMs: 0,
      })
      agg.requests++
      if (r.success) agg.successes++
      else agg.failures++
      agg.tokensIn += r.tokensIn ?? 0
      agg.tokensOut += r.tokensOut ?? 0
      agg.images += r.imageCount ?? 0
      agg.totalDurationMs += r.durationMs ?? 0
    }

    const today = await db.usageRecord.groupBy({
      by: ['product'],
      where: { userId: user.id, success: true, createdAt: { gte: startOfDay } },
      _count: { _all: true },
    })

    const quotas = Object.fromEntries(
      Object.entries(PRODUCT_DAILY_QUOTAS).map(([product, limit]) => {
        const used = today.find((t) => t.product === product)?._count._all ?? 0
        return [product, { used, limit }]
      }),
    )

    const recent = records.slice(0, 30).map((r) => ({
      id: r.id,
      product: r.product,
      kind: r.kind,
      success: r.success,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      imageCount: r.imageCount,
      durationMs: r.durationMs,
      errorCode: r.errorCode,
      createdAt: r.createdAt,
    }))

    return ok({
      byProduct,
      quotas,
      recent,
      note: 'Token figures are estimates; the inference gateway does not report exact usage or cost.',
    })
  })
}
