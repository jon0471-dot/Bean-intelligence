/**
 * BEAN Intelligence — GET /api/v1/usage
 * Usage reporting for the calling principal. A session user sees their own
 * rollups; an API key sees the rollups of its owning user; an admin session
 * additionally receives gateway-wide aggregates. Token counts are labeled
 * exact vs estimated; cost is "not reported" unless the provider reports it
 * (it does not today — the field stays null, never invented).
 */
import { handle, ok } from '@/lib/api/errors'
import { requireGatewayPrincipal } from '@/lib/security/gateway-auth'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  return handle(async () => {
    const principal = await requireGatewayPrincipal(request, 'usage:read')
    const isAdminSession = principal.kind === 'session' && principal.admin

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const ownByProduct = await db.usageRecord.groupBy({
      by: ['product'],
      where: { userId: principal.userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokensIn: true, tokensOut: true, durationMs: true },
    })
    const ownRecent = await db.usageRecord.findMany({
      where: { userId: principal.userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { product: true, backendId: true, kind: true, tokensIn: true, tokensOut: true, durationMs: true, success: true, errorCode: true, createdAt: true },
    })

    let global: Record<string, unknown> | undefined
    if (isAdminSession) {
      const globalByProduct = await db.usageRecord.groupBy({
        by: ['product'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { tokensIn: true, tokensOut: true, durationMs: true },
      })
      const [requestCount, errorCount, keyCount] = await Promise.all([
        db.gatewayRequestLog.count({ where: { createdAt: { gte: since } } }),
        db.gatewayRequestLog.count({ where: { createdAt: { gte: since }, status: { gte: 400 } } }),
        db.apiKey.count({ where: { status: 'active' } }),
      ])
      global = {
        byProduct: globalByProduct.map((g) => ({
          product: g.product,
          requests: g._count._all,
          tokensIn: g._sum.tokensIn ?? 0,
          tokensOut: g._sum.tokensOut ?? 0,
          durationMs: g._sum.durationMs ?? 0,
        })),
        gatewayRequests30d: requestCount,
        gatewayErrors30d: errorCount,
        activeApiKeys: keyCount,
      }
    }

    const sumIn = ownByProduct.reduce((n, g) => n + (g._sum.tokensIn ?? 0), 0)
    const sumOut = ownByProduct.reduce((n, g) => n + (g._sum.tokensOut ?? 0), 0)
    return ok({
      windowDays: 30,
      principal: { kind: principal.kind, userId: principal.userId, admin: isAdminSession },
      totals: { tokensIn: sumIn, tokensOut: sumOut, cost: null as null, costNote: 'cost data not reported by providers' },
      byProduct: ownByProduct.map((g) => ({
        product: g.product,
        requests: g._count._all,
        tokensIn: g._sum.tokensIn ?? 0,
        tokensOut: g._sum.tokensOut ?? 0,
        durationMs: g._sum.durationMs ?? 0,
      })),
      recent: ownRecent,
      ...(global ? { global } : {}),
    })
  })
}
