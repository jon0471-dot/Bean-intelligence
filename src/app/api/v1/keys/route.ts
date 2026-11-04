/**
 * BEAN Intelligence — POST/GET /api/v1/keys
 * Application API key management. ADMIN SESSION ONLY — an API key can never
 * create, list or rotate keys (no scope grants that capability).
 *
 * POST  — create: returns the COMPLETE key exactly once (never stored raw,
 *         never returned again).
 * GET   — list: metadata only. Keys appear as prefix + hash fingerprint; the
 *         response contains no raw key material by construction.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireAdminPrincipal } from '@/lib/security/gateway-auth'
import { createApiKey, API_KEY_SCOPES } from '@/lib/security/api-keys'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/observability/metering'

const createSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum([...API_KEY_SCOPES, '*' as const])).min(1).max(16),
  rateLimitPerMin: z.number().int().min(1).max(600).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdminPrincipal(request)
    const body = await parseBody(request, createSchema)
    const created = await createApiKey({
      ownerId: admin.userId,
      name: body.name,
      permissions: body.permissions,
      rateLimitPerMin: body.rateLimitPerMin,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    })
    await recordAudit({
      actorId: admin.userId,
      action: 'gateway.apikey_created',
      target: created.id,
      meta: { name: created.name, permissions: created.permissions },
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
      notice: 'Store this key now — it is shown only once and cannot be retrieved again.',
    })
  })
}

export async function GET(request: Request) {
  return handle(async () => {
    const admin = await requireAdminPrincipal(request)
    const keys = await db.apiKey.findMany({
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
      scopes: API_KEY_SCOPES,
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
      actorId: admin.userId,
    })
  })
}
