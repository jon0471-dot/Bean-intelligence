import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { requireAdmin } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { BACKEND_REGISTRY } from '@/lib/registry/backends'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'

/**
 * RESTRICTED — administrative diagnostics. Server-side role check; ordinary
 * members receive 403. This is the only place upstream provider metadata
 * (provider names, backend ids, license status) is exposed, and only to
 * authenticated admins, per spec §3.
 */
export async function GET() {
  return handle(async () => {
    const admin = await requireAdmin()

    // Live probes for admin diagnostics (measured, not assumed).
    const [llmHealth, imageHealth] = await Promise.all([
      hostedLlmAdapter.health(),
      hostedImageAdapter.health(),
    ])
    const healthById: Record<string, { healthy: boolean; detail: string; latencyMs: number | null }> = {
      'bean-llm-hosted-primary': {
        healthy: llmHealth.healthy,
        detail: llmHealth.detail,
        latencyMs: llmHealth.latencyMs,
      },
      'bean-image-hosted-primary': {
        healthy: imageHealth.healthy,
        detail: imageHealth.detail,
        latencyMs: imageHealth.latencyMs,
      },
      'bean-video-selfhosted-candidate': {
        healthy: false,
        detail: 'Not deployed: no GPU worker or authorized hosted video endpoint.',
        latencyMs: null,
      },
      'bean-code-llm-hosted-primary': {
        healthy: llmHealth.healthy,
        detail: llmHealth.detail,
        latencyMs: llmHealth.latencyMs,
      },
    }

    const [userCount, jobCount, usageAgg, recentAudit] = await Promise.all([
      db.user.count(),
      db.generationJob.count(),
      db.usageRecord.aggregate({ _count: { _all: true }, _sum: { durationMs: true } }),
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    ])

    const jobStatus = await db.generationJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    })

    await recordAudit({ actorId: admin.id, action: 'admin.view_overview', target: null })

    return ok({
      backends: BACKEND_REGISTRY.map((b) => ({
        id: b.id,
        productId: b.productId,
        task: b.task,
        provider: b.provider,
        modelIdentity: b.modelIdentity,
        revision: b.revision,
        endpointType: b.endpointType,
        deploymentMode: b.deploymentMode,
        runtime: b.runtime,
        limits: b.limits,
        license: b.license,
        dataHandling: b.dataHandling,
        metering: b.metering,
        secrets: b.secrets.map((s) => s.split(' ')[0]), // names only
        fallbacks: b.fallbacks,
        enabled: b.enabled,
        unavailableReason: b.unavailableReason ?? null,
        concurrency: b.concurrency,
        timeouts: b.timeouts,
        health: healthById[b.id] ?? { healthy: false, detail: 'No probe registered.', latencyMs: null },
      })),
      stats: {
        users: userCount,
        jobs: jobCount,
        usageRecords: usageAgg._count._all,
        totalDurationMs: usageAgg._sum.durationMs ?? 0,
        jobStatus: Object.fromEntries(jobStatus.map((s) => [s.status, s._count._all])),
      },
      audit: recentAudit.map((a) => ({
        id: a.id,
        actorId: a.actorId,
        action: a.action,
        target: a.target,
        createdAt: a.createdAt,
      })),
    })
  })
}
