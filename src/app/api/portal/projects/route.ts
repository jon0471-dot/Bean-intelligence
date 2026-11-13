/**
 * BEAN Intelligence — /api/portal/projects (Phase 1 developer portal).
 *
 *   POST — create a Project owned by the authenticated session user.
 *   GET  — list the caller's own Projects (ownership-filtered; a caller can
 *          never even learn that another user's projects exist).
 *
 * Auth: authenticated BEAN session (member or admin). API keys are rejected
 * (403) by requireSessionPrincipal; absent principals are 401. Cross-user
 * access cannot occur on these collection routes by construction — every
 * query is scoped to the session user's id.
 *
 * Rate limit: existing shared limiter utility, per-user buckets, honest 429
 * headers. Input validated with the repository's zod parseBody convention.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError, rateLimitHeaders } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireSessionPrincipal } from '@/lib/security/gateway-auth'
import { projectView } from '@/lib/security/portal'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'

const createSchema = z.object({
  name: z.string().min(1).max(100),
})

const PROJECT_CREATE_PER_MIN = 10

export async function POST(request: Request) {
  return handle(async () => {
    const principal = await requireSessionPrincipal(request)
    const rl = checkRateLimit(`portal:project-create:${principal.userId}`, PROJECT_CREATE_PER_MIN, 60_000)
    if (!rl.allowed) {
      // Headers carry the SAME limiter state that rejected the call.
      throw new BeanApiError(
        'RATE_LIMITED',
        `Portal rate limit reached (${PROJECT_CREATE_PER_MIN} projects/min). Retry in ${rl.retryAfterSec}s.`,
        undefined,
        {
          headers: rateLimitHeaders({
            limit: PROJECT_CREATE_PER_MIN,
            remaining: rl.remaining,
            resetAtMs: rl.resetAtMs,
            retryAfterSec: rl.retryAfterSec,
          }),
        },
      )
    }
    const body = await parseBody(request, createSchema)
    const project = await db.project.create({
      data: { userId: principal.userId, name: body.name.trim().slice(0, 100) || 'Untitled project' },
    })
    await recordAudit({
      actorId: principal.userId,
      action: 'portal.project_created',
      target: project.id,
      meta: { name: project.name },
    })
    return ok({ project: projectView(project) })
  })
}

export async function GET(request: Request) {
  return handle(async () => {
    const principal = await requireSessionPrincipal(request)
    const projects = await db.project.findMany({
      where: { userId: principal.userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return ok({ projects: projects.map(projectView) })
  })
}
