/**
 * BEAN Intelligence — client-compute capability reports (authenticated).
 *
 * POST: store a SANITIZED capability report from the visitor's browser.
 * The payload is validated against a bounded zod schema that mirrors
 * src/lib/client-compute/telemetry.ts (CapabilityReport). The schema
 * deliberately accepts ONLY booleans, coarse numbers, the tier and the
 * installed-model id list — there is no field a vendor string, user agent,
 * task payload or prompt text could hide in.
 *
 * GET: the caller's own latest reports (owner-scoped; an admin sees only
 * their own rows — capability reports are device facts, not cross-user data).
 *
 * A client report is EVIDENCE for health/diagnostics surfaces, never a
 * self-attestation of server-authoritative work.
 */

import { z } from 'zod'
import { requireUser } from '@/lib/auth/session'
import { BeanApiError, handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { recordAudit } from '@/lib/observability/metering'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const reportSchema = z.object({
  tier: z.number().int().min(0).max(4),
  conservative: z.boolean(),
  webgpuSupported: z.boolean(),
  webgpuAdapterAvailable: z.boolean(),
  webgl2: z.boolean(),
  wasm: z.boolean(),
  workers: z.boolean(),
  offscreenCanvas: z.boolean(),
  sharedArrayBuffer: z.boolean(),
  secureContext: z.boolean(),
  hardwareConcurrency: z.number().int().min(1).max(1024).nullable(),
  deviceMemoryGb: z.number().min(0.25).max(16).nullable(),
  storageQuotaBytes: z.number().min(0).nullable(),
  benchmark: z
    .object({
      cpuOpsPerSec: z.number().min(0).nullable(),
      gpuComputeOk: z.boolean().nullable(),
      durationMs: z.number().int().min(0).max(10_000),
    })
    .nullable(),
  installedModels: z.array(z.string().max(100)).max(20),
  reportedAt: z.string().datetime(),
})

const bodySchema = z.object({ report: reportSchema })

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const limited = checkRateLimit(`client-compute:report:${user.id}`, 10, 60_000)
    if (!limited.allowed) {
      throw new BeanApiError('RATE_LIMITED', 'Too many capability reports; retry shortly.', undefined, {
        headers: limited.resetAtMs
          ? { 'Retry-After': String(Math.max(1, Math.ceil((limited.resetAtMs - Date.now()) / 1000))) }
          : undefined,
      })
    }
    const { report } = await parseBody(request, bodySchema)
    const row = await db.clientComputeReport.create({
      data: {
        userId: user.id,
        tier: report.tier,
        conservative: report.conservative,
        reportJson: JSON.stringify(report),
      },
      select: { id: true, createdAt: true },
    })
    await recordAudit({
      actorId: user.id,
      action: 'client-compute.report',
      target: row.id,
      meta: { tier: report.tier, conservative: report.conservative },
    })
    return ok({ id: row.id, createdAt: row.createdAt, tier: report.tier })
  })
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const rows = await db.clientComputeReport.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, tier: true, conservative: true, reportJson: true, createdAt: true },
    })
    return ok({
      reports: rows.map((r) => {
        let report: unknown = null
        try {
          report = JSON.parse(r.reportJson)
        } catch {
          report = null
        }
        return { id: r.id, tier: r.tier, conservative: r.conservative, report, createdAt: r.createdAt }
      }),
    })
  })
}
