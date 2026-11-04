/**
 * BEAN Intelligence — GET/PUT /api/admin/verification (🛡️ admin session only)
 *
 * Runtime-tunable self-verification controls (work order Part 1 §3). Stored
 * in the SystemSetting table as JSON; read per turn by the verification
 * config resolver; env vars provide deployment defaults.
 *
 * Controls: enabled, verificationModel (gateway model id), maxAttempts
 * (verification passes, hard cap 3), timeoutMs, minConfidence,
 * regenerationLimit (hard cap 1), maxInputChars (verifier input budget).
 * Every write is bounded and validated — no configuration can produce an
 * infinite regeneration loop.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireAdmin } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/observability/metering'
import { verificationConfig, SETTING_KEY, hardCaps, type VerificationConfig } from '@/lib/verification/config'
import { getGatewayModels } from '@/lib/registry/models'

export async function GET() {
  return handle(async () => {
    await requireAdmin()
    const [cfg, models] = await Promise.all([verificationConfig(), getGatewayModels()])
    return ok({
      config: cfg,
      settingKey: SETTING_KEY,
      hardCaps,
      chatModels: models
        .filter((m) => m.capabilities.includes('chat') && m.enabled)
        .map((m) => ({ id: m.id, displayName: m.displayName, provider: m.provider, configurationStatus: m.configurationStatus })),
    })
  })
}

const putSchema = z.object({
  enabled: z.boolean().optional(),
  verificationModel: z.string().min(1).max(100).optional(),
  maxAttempts: z.number().int().min(1).max(hardCaps.maxAttempts).optional(),
  timeoutMs: z.number().int().min(5_000).max(hardCaps.timeoutMs).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  regenerationLimit: z.number().int().min(0).max(hardCaps.maxRegenerations).optional(),
  maxInputChars: z.number().int().min(2_000).max(hardCaps.maxInputChars).optional(),
})

export async function PUT(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin()
    const patch = await parseBody(request, putSchema)
    const current = await verificationConfig()
    const merged: VerificationConfig = { ...current, ...patch }
    await db.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(merged), updatedBy: admin.id },
      create: { key: SETTING_KEY, value: JSON.stringify(merged), updatedBy: admin.id },
    })
    await recordAudit({ actorId: admin.id, action: 'verification.settings_updated', target: SETTING_KEY, meta: patch })
    return ok({ config: merged })
  })
}
