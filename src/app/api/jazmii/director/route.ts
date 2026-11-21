import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { checkDailyQuota, checkRateLimit, PRODUCT_RATE_LIMITS } from '@/lib/auth/ratelimit'
import { assertProviderBudget } from '@/lib/providers/cost-guard'
import { createProduction, listProductionsForOwner } from '@/lib/jazmii/director/service'
import { directorRequestSchema } from '@/lib/jazmii/director/schema'

/**
 * JAZMII AUTO DIRECTOR — create a production (storyboard proposal) and list
 * the owner's productions.
 *
 * POST: the Creative Director plans a SCHEMA-VALIDATED storyboard from the
 * request (202; the production sits awaiting_approval until the owner
 * approves it). Rate limits and quotas reuse the JAZMII policy — planning
 * consumes shared chat-class budget, honest 429s surface unchanged.
 */
const createSchema = directorRequestSchema

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)

    const burstPerMin = PRODUCT_RATE_LIMITS.jazmii ?? 20
    const rl = checkRateLimit(`${user.id}:jazmii-director`, burstPerMin, 60_000)
    if (!rl.allowed) {
      throw new BeanApiError('RATE_LIMITED', `Too many requests. Try again in ${rl.retryAfterSec}s.`)
    }
    const quota = await checkDailyQuota(user.id, 'jazmii')
    if (!quota.allowed) {
      throw new BeanApiError('QUOTA_EXCEEDED', `Daily quota reached for JAZMII (${quota.used}/${quota.limit}). Resets at midnight.`)
    }
    await assertProviderBudget(user.id, 'jazmii', 'JAZMII')

    const { production, storyboard, plannerMeta } = await createProduction(user.id, body)
    return ok(
      {
        production: {
          id: production.id,
          title: production.title,
          status: production.status,
          storyboardRev: production.storyboardRev,
        },
        storyboard,
        plannerMeta,
      },
      { status: 202 },
    )
  })
}

/** Owner's productions (newest first). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const productions = await listProductionsForOwner(user.id, 20)
    return ok({
      productions: productions.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        style: p.style,
        aspect: p.aspect,
        progress: p.progress,
        engine: p.engine,
        approvedAt: p.approvedAt,
        finishedAt: p.finishedAt,
        errorCode: p.errorCode,
        errorMessage: p.errorMessage,
        updatedAt: p.updatedAt,
      })),
    })
  })
}
