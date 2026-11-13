/**
 * BEAN Intelligence — GET /api/portal/projects/:id/usage (Phase 1 portal).
 *
 * Project usage from REAL persisted data only:
 *  - per-key request counters and last-used stamps (ApiKey rows);
 *  - request-log aggregates (GatewayRequestLog rows attributable to the
 *    project's keys: total/success/failure counts, token totals).
 * No cost is ever fabricated (costMicros is not reported by providers);
 * token counts are labeled exactly as the gateway recorded them. Everything
 * is owner-scoped: the caller must own the project (else 404).
 */
import { handle, ok } from '@/lib/api/errors'
import { requireOwnedProject, projectView } from '@/lib/security/portal'
import { db } from '@/lib/db'

const NOTE =
  'Usage is attributed per project API key from real recorded gateway requests. ' +
  'Token counts are stored exactly as the gateway recorded them (estimated when the provider does not report exact usage). ' +
  'Cost data is not reported by providers and is never invented.'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const { project } = await requireOwnedProject(request, id)
    const keys = await db.apiKey.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        prefix: true,
        keyHash: true,
        status: true,
        requestCount: true,
        lastUsedAt: true,
        createdAt: true,
      },
    })
    const keyIds = keys.map((k) => k.id)
    const logs = keyIds.length
      ? await db.gatewayRequestLog.findMany({
          where: { keyId: { in: keyIds } },
          select: { status: true, tokensIn: true, tokensOut: true },
        })
      : []
    const totals = {
      requests: logs.length,
      successes: logs.filter((l) => l.status < 400).length,
      failures: logs.filter((l) => l.status >= 400).length,
      tokensIn: logs.reduce((n, l) => n + (l.tokensIn ?? 0), 0),
      tokensOut: logs.reduce((n, l) => n + (l.tokensOut ?? 0), 0),
    }
    return ok({
      project: projectView(project),
      totals,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        fingerprint: `${k.prefix}…${k.keyHash.slice(0, 4)}`,
        status: k.status,
        requestCount: k.requestCount,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      note: NOTE,
    })
  })
}
