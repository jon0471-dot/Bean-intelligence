/**
 * BEAN Intelligence — /api/portal/projects/:id/keys (Phase 1 developer portal).
 *
 *   POST — create a PROJECT-SCOPED application API key: the caller selects
 *          the granted scopes (portal subset — wildcard and providers:read
 *          are never portal-grantable) and receives the COMPLETE key exactly
 *          once. Only the SHA-256 hash is stored; the raw key is never
 *          returned again by this or any other endpoint.
 *   GET  — list the project's keys as safe metadata (fingerprint, scopes,
 *          status, usage counters) — no key material by construction.
 *
 * Ownership: requireOwnedProject — the project must exist AND belong to the
 * session user (else 404). Key creation goes through the SAME central
 * createApiKey() as the admin gateway (hashing, validation, rate-limit
 * clamping, project binding) — no second key system. Archived projects
 * cannot mint new keys.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError, rateLimitHeaders } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireOwnedProject } from '@/lib/security/portal'
import { createApiKey, PORTAL_KEY_SCOPES } from '@/lib/security/api-keys'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'

const createSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum([...PORTAL_KEY_SCOPES])).min(1).max(16),
  rateLimitPerMin: z.number().int().min(1).max(600).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
})

const KEY_CREATE_PER_MIN = 20

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const { principal, project } = await requireOwnedProject(request, id)
    const rl = checkRateLimit(`portal:key-create:${principal.userId}`, KEY_CREATE_PER_MIN, 60_000)
    if (!rl.allowed) {
      throw new BeanApiError(
        'RATE_LIMITED',
        `Portal rate limit reached (${KEY_CREATE_PER_MIN} keys/min). Retry in ${rl.retryAfterSec}s.`,
        undefined,
        {
          headers: rateLimitHeaders({
            limit: KEY_CREATE_PER_MIN,
            remaining: rl.remaining,
            resetAtMs: rl.resetAtMs,
            retryAfterSec: rl.retryAfterSec,
          }),
        },
      )
    }
    if (project.status !== 'active') {
      throw new BeanApiError('VALIDATION_ERROR', 'This project is archived — reactivate it before creating keys.')
    }
    const body = await parseBody(request, createSchema)
    const created = await createApiKey({
      ownerId: principal.userId,
      projectId: project.id, // central binding: createApiKey re-verifies ownership + status
      name: body.name,
      permissions: body.permissions,
      rateLimitPerMin: body.rateLimitPerMin,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    })
    await recordAudit({
      actorId: principal.userId,
      action: 'portal.project_key_created',
      target: created.id,
      meta: { projectId: project.id, name: created.name, permissions: created.permissions },
    })
    // The raw key appears HERE and NOWHERE else, ever.
    return ok({
      key: created.key,
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      permissions: created.permissions,
      rateLimitPerMin: created.rateLimitPerMin,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      projectId: project.id,
      notice: 'Store this key now — it is shown only once and cannot be retrieved again.',
    })
  })
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    await requireOwnedProject(request, id)
    const keys = await db.apiKey.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        prefix: true,
        keyHash: true,
        permissions: true,
        rateLimitPerMin: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        requestCount: true,
        createdAt: true,
        revokedAt: true,
      },
    })
    return ok({
      scopes: PORTAL_KEY_SCOPES,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        // prefix (bgk_xxxx) + first 4 of the hash = identifiable, useless to an attacker.
        fingerprint: `${k.prefix}…${k.keyHash.slice(0, 4)}`,
        permissions: JSON.parse(k.permissions) as string[],
        rateLimitPerMin: k.rateLimitPerMin,
        status: k.status,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        requestCount: k.requestCount,
        createdAt: k.createdAt.toISOString(),
        revokedAt: k.revokedAt?.toISOString() ?? null,
      })),
    })
  })
}
