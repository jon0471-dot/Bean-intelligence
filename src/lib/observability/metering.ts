/**
 * BEAN Intelligence — usage metering + audit trail (packages/observability).
 * Records ACTUAL usage only. Where the provider does not report token counts
 * or cost, the field is null / explicitly labeled as an estimate.
 */
import { db } from '@/lib/db'
import { logger } from './logger'

export interface RecordUsageInput {
  userId: string
  product: string
  backendId: string | null
  kind: string
  tokensIn?: number | null
  tokensOut?: number | null
  imageCount?: number | null
  durationMs?: number | null
  success: boolean
  errorCode?: string | null
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    await db.usageRecord.create({
      data: {
        userId: input.userId,
        product: input.product,
        backendId: input.backendId,
        kind: input.kind,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        imageCount: input.imageCount ?? null,
        durationMs: input.durationMs ?? null,
        costMicros: null, // provider reports no cost data — never invented
        success: input.success,
        errorCode: input.errorCode ?? null,
      },
    })
    logger.info('usage.recorded', {
      product: input.product,
      backendId: input.backendId,
      success: input.success,
      durationMs: input.durationMs ?? null,
    })
  } catch (e) {
    logger.error('usage.record_failed', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function recordAudit(input: {
  actorId: string | null
  action: string
  target?: string | null
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        target: input.target ?? null,
        metaJson: input.meta ? JSON.stringify(input.meta) : null,
      },
    })
  } catch (e) {
    logger.error('audit.record_failed', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
