/**
 * BEAN Intelligence — GET /api/portal/projects/:id/logs (Phase 1 portal).
 *
 * Real activity/request records for an OWNED project:
 *  - requests: GatewayRequestLog rows attributable to the project's API keys
 *    (no prompts, no secrets — the table stores metadata only);
 *  - activity: AuditLog entries recorded for this project's portal actions
 *    (actor must be the caller; project linkage by target id or meta).
 * Owner-scoped end to end: a caller who does not own the project gets 404
 * and can never see another user's rows.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireOwnedProject } from '@/lib/security/portal'
import { db } from '@/lib/db'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const { principal, project } = await requireOwnedProject(request, id)
    const keys = await db.apiKey.findMany({
      where: { projectId: id },
      select: { id: true, name: true },
    })
    const keyIds = keys.map((k) => k.id)
    const keyName = new Map(keys.map((k) => [k.id, k.name] as const))
    const requests = keyIds.length
      ? await db.gatewayRequestLog.findMany({
          where: { keyId: { in: keyIds } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : []
    const audits = await db.auditLog.findMany({
      where: { actorId: principal.userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const activity = audits
      .filter((a) => {
        if (a.target === project.id) return true
        try {
          const meta = a.metaJson ? (JSON.parse(a.metaJson) as { projectId?: string }) : null
          return meta?.projectId === project.id
        } catch {
          return false
        }
      })
      .slice(0, 25)
    return ok({
      project: { id: project.id, name: project.name },
      requests: requests.map((r) => ({
        id: r.id,
        keyId: r.keyId,
        keyName: r.keyId ? keyName.get(r.keyId) ?? null : null,
        provider: r.provider,
        model: r.model,
        endpoint: r.endpoint,
        status: r.status,
        errorCode: r.errorCode,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        durationMs: r.durationMs,
        streamed: r.streamed,
        createdAt: r.createdAt.toISOString(),
      })),
      activity: activity.map((a) => ({
        id: a.id,
        action: a.action,
        target: a.target,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  })
}
