/**
 * BEAN Intelligence — application API keys (gateway access tokens).
 *
 * DISTINCT from provider credentials: application keys authenticate CALLERS
 * of the BEAN gateway (/api/v1/*); provider credentials authenticate BEAN to
 * upstream AI providers. The two secret types never mix — different tables,
 * different lifecycles, different display rules.
 *
 * Security contract (work order Part 3 §11):
 *  - generated with a cryptographically secure RNG (node:crypto randomBytes,
 *    32 bytes → 256 bits), prefixed `bgk_` so leaked keys are identifiable;
 *  - the COMPLETE key is returned exactly ONCE, at creation or rotation;
 *  - only a SHA-256 hash is stored — no endpoint can ever return the raw key;
 *  - verification resolves by unique prefix, then compares hashes in constant
 *    time (timingSafeEqual);
 *  - revoked / expired / permission-missing keys are rejected with typed,
 *    customer-safe errors;
 *  - per-key rate limit (sliding window, shared limiter infra);
 *  - usage tracking increments requestCount and lastUsedAt — the secret is
 *    never logged (the logger's contract) and never included in any response.
 */
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { BeanApiError, rateLimitHeaders } from '@/lib/api/errors'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { hashApiKey, safeEqual } from './crypto'

export const API_KEY_PREFIX = 'bgk_'
/**
 * Scopes the gateway understands. `*` grants everything (admin keys).
 *
 * PHASE 1 (2026-11-13) — additive product scopes. They are REAL registered
 * identifiers validated at creation and enforced by the same central
 * assertScope() gate as every other scope; the v1 endpoints that REQUIRE
 * them (image/video/code/file generation) arrive in Phase 2 — no endpoint
 * claims them today, and no documentation claims they work against products
 * yet.
 */
export const API_KEY_SCOPES = [
  'chat:completions',
  'models:read',
  'providers:read',
  'usage:read',
  'images:generate',
  'videos:generate',
  'code:generate',
  'files:read',
] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/**
 * Scopes the developer portal may grant to a PROJECT key. Deliberate
 * subset of API_KEY_SCOPES: the wildcard `*` stays administrator-only and
 * `providers:read` is an operator surface — neither is ever granted through
 * the self-service portal.
 */
export const PORTAL_KEY_SCOPES = [
  'chat:completions',
  'models:read',
  'usage:read',
  'images:generate',
  'videos:generate',
  'code:generate',
  'files:read',
] as const

export interface GeneratedApiKey {
  /** The full key — shown EXACTLY once by the creating/rotating endpoint. */
  key: string
  id: string
  prefix: string
  name: string
  permissions: string[]
  rateLimitPerMin: number
  expiresAt: Date | null
  /** Owning project id, or null for a legacy administrator key. */
  projectId: string | null
}

/** Generate a fresh 256-bit key. Raw material exists only in this return value. */
function newRawKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

const CREATE_SCHEMA_LIMITS = { name: 100, permissions: 16 }

export interface CreateKeyInput {
  ownerId: string
  name: string
  permissions: string[]
  rateLimitPerMin?: number
  /** ISO date or null for never-expires. Validated by the route's zod schema. */
  expiresAt?: Date | null
  /**
   * PHASE 1 — optional project binding. When set, the project MUST exist,
   * belong to ownerId and be active (else NOT_FOUND / VALIDATION_ERROR);
   * the key can then never operate outside that project. Null/undefined =
   * legacy administrator key with unchanged platform-wide behavior.
   */
  projectId?: string | null
}

export async function createApiKey(input: CreateKeyInput): Promise<GeneratedApiKey> {
  const name = input.name.trim().slice(0, CREATE_SCHEMA_LIMITS.name)
  if (!name) throw new BeanApiError('VALIDATION_ERROR', 'A key name is required.')
  const perms = input.permissions.slice(0, CREATE_SCHEMA_LIMITS.permissions)
  validatePermissions(perms, input.projectId ?? null)
  const projectId = await resolveProjectBinding(input.ownerId, input.projectId ?? null)
  const raw = newRawKey()
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 4) // "bgk_xxxx" — display/lookup hint
  const row = await db.apiKey.create({
    data: {
      userId: input.ownerId,
      name,
      prefix,
      keyHash: hashApiKey(raw),
      permissions: JSON.stringify(perms),
      rateLimitPerMin: clampRateLimit(input.rateLimitPerMin),
      expiresAt: input.expiresAt ?? null,
      projectId,
    },
  })
  return {
    key: raw, // the ONLY place the raw key leaves this module
    id: row.id,
    prefix,
    name,
    permissions: perms,
    rateLimitPerMin: row.rateLimitPerMin,
    expiresAt: row.expiresAt,
    projectId: row.projectId,
  }
}

/**
 * PHASE 1 — project binding resolution (central, not per-route): a
 * project-scoped key must reference a project that exists, is owned by the
 * key owner and is active. Cross-user or unknown projects are NOT_FOUND —
 * existence is never revealed to non-owners. Legacy keys pass through as
 * null without a DB round-trip.
 */
async function resolveProjectBinding(ownerId: string, projectId: string | null): Promise<string | null> {
  if (!projectId) return null
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project || project.userId !== ownerId) {
    throw new BeanApiError('NOT_FOUND', 'Project not found.')
  }
  if (project.status !== 'active') {
    throw new BeanApiError('VALIDATION_ERROR', 'This project is archived — reactivate it before creating keys.')
  }
  return project.id
}

/**
 * Rotate a key: revoke the current hash and mint a NEW key under the same
 * metadata (name, permissions, rate limit, expiry). The old key stops
 * working immediately (status revoked, hash kept only as a revoked record).
 * Returns the new raw key — shown exactly once.
 */
export async function rotateApiKey(keyId: string, ownerId: string): Promise<GeneratedApiKey> {
  const existing = await db.apiKey.findUnique({ where: { id: keyId } })
  if (!existing || existing.userId !== ownerId) {
    throw new BeanApiError('NOT_FOUND', 'API key not found.')
  }
  if (existing.status === 'revoked') {
    throw new BeanApiError('VALIDATION_ERROR', 'A revoked key cannot be rotated. Create a new key.')
  }
  const raw = newRawKey()
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 4)
  const rotated = await db.apiKey.update({
    where: { id: keyId },
    data: {
      keyHash: hashApiKey(raw),
      prefix,
      status: 'active',
      revokedAt: null,
      requestCount: 0,
      lastUsedAt: null,
    },
  })
  return {
    key: raw,
    id: rotated.id,
    prefix,
    name: rotated.name,
    permissions: parsePermissions(rotated.permissions),
    rateLimitPerMin: rotated.rateLimitPerMin,
    expiresAt: rotated.expiresAt,
    // Rotation preserves the metadata — including the project binding.
    projectId: rotated.projectId,
  }
}

export async function revokeApiKey(keyId: string, ownerId: string): Promise<void> {
  const existing = await db.apiKey.findUnique({ where: { id: keyId } })
  if (!existing || existing.userId !== ownerId) {
    throw new BeanApiError('NOT_FOUND', 'API key not found.')
  }
  if (existing.status === 'revoked') {
    // Matches the documented contract (docs/api/GATEWAY-API.md §2.6): revoking
    // an already-revoked key is a caller error, not a silent no-op.
    throw new BeanApiError('VALIDATION_ERROR', 'This API key is already revoked.')
  }
  await db.apiKey.update({
    where: { id: keyId },
    data: { status: 'revoked', revokedAt: new Date() },
  })
}

// ---- verification (per gateway request) -------------------------------------

export type ApiKeyAuth =
  | { kind: 'session'; userId: string; role: 'member' | 'admin' }
  | {
      kind: 'api-key'
      keyId: string
      userId: string // the key's owning administrator (usage attribution)
      permissions: string[]
      rateLimitPerMin: number
      /** PHASE 1 — owning project id, or null for a legacy administrator key. */
      projectId: string | null
    }

function parsePermissions(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function clampRateLimit(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 60
  return Math.min(600, Math.max(1, Math.floor(raw)))
}

function validatePermissions(perms: string[], projectId: string | null = null): void {
  const allowed = new Set<string>([...API_KEY_SCOPES, '*'])
  for (const p of perms) {
    if (!allowed.has(p)) {
      throw new BeanApiError('VALIDATION_ERROR', `Unknown permission scope: ${p}.`)
    }
  }
  // A project-scoped key must never hold the admin wildcard — the wildcard
  // is a platform-administrator grant and would defeat project containment.
  if (projectId && perms.includes('*')) {
    throw new BeanApiError('VALIDATION_ERROR', 'A project-scoped key cannot use the wildcard "*" scope.')
  }
}

/**
 * Verify a raw `Authorization: Bearer <key>` value against the key store.
 * Order of checks is deliberate: existence → status → expiry → permission is
 * checked by the CALLER per-endpoint (this function returns the grants).
 * Every rejection is a typed BeanApiError with a stable code — error text
 * never contains any key material.
 */
export async function verifyApiKey(rawKey: string): Promise<Extract<ApiKeyAuth, { kind: 'api-key' }>> {
  const trimmed = rawKey.trim()
  if (!trimmed.startsWith(API_KEY_PREFIX)) {
    throw new BeanApiError('UNAUTHENTICATED', 'Invalid API key.')
  }
  // Prefix narrows the lookup; the hash comparison is the real check.
  const prefix = trimmed.slice(0, API_KEY_PREFIX.length + 4)
  const candidates = await db.apiKey.findMany({
    where: { prefix, status: 'active' },
    take: 5,
  })
  const presentedHash = hashApiKey(trimmed)
  const match = candidates.find((c) => safeEqual(c.keyHash, presentedHash))
  if (!match) throw new BeanApiError('UNAUTHENTICATED', 'Invalid API key.')
  if (match.expiresAt && match.expiresAt.getTime() < Date.now()) {
    throw new BeanApiError('FORBIDDEN', 'This API key has expired.')
  }
  // Per-key rate limit (60s sliding window) — enforced BEFORE any backend work.
  const rl = checkRateLimit(`apikey:${match.id}`, match.rateLimitPerMin, 60_000)
  if (!rl.allowed) {
    // Truthful limiter state on the wire: Retry-After + X-RateLimit-* come
    // from the same sliding window that rejected the call — nothing invented.
    throw new BeanApiError(
      'RATE_LIMITED',
      `API key rate limit reached (${match.rateLimitPerMin}/min). Retry in ${rl.retryAfterSec}s.`,
      undefined,
      {
        headers: rateLimitHeaders({
          limit: match.rateLimitPerMin,
          remaining: rl.remaining,
          resetAtMs: rl.resetAtMs,
          retryAfterSec: rl.retryAfterSec,
        }),
      },
    )
  }
  // Usage tracking — metadata only, never the secret.
  await db.apiKey
    .update({ where: { id: match.id }, data: { requestCount: { increment: 1 }, lastUsedAt: new Date() } })
    .catch(() => undefined)
  return {
    kind: 'api-key',
    keyId: match.id,
    userId: match.userId,
    permissions: parsePermissions(match.permissions),
    rateLimitPerMin: match.rateLimitPerMin,
    projectId: match.projectId,
  }
}

/** Endpoint guard: requires the caller to hold one of the granted scopes. */
export function assertScope(
  auth: Extract<ApiKeyAuth, { kind: 'api-key' }>,
  scope: ApiKeyScope,
): void {
  if (auth.permissions.includes('*')) return
  if (!auth.permissions.includes(scope)) {
    throw new BeanApiError('FORBIDDEN', 'This API key does not grant the required permission.')
  }
}

/**
 * PHASE 1 — central project-containment guard (same layer as assertScope,
 * never re-implemented per route): a project-scoped key may only act inside
 * its own project. Legacy keys (projectId = null) are platform keys and
 * pass any binding; Phase 2 endpoints must call this when a request names a
 * project. A mismatch is FORBIDDEN (the caller is authenticated and simply
 * outside the boundary).
 */
export function assertProjectBinding(
  auth: Extract<ApiKeyAuth, { kind: 'api-key' }>,
  projectId: string | null | undefined,
): void {
  if (auth.projectId == null) return // legacy administrator key
  if (!projectId || auth.projectId !== projectId) {
    throw new BeanApiError('FORBIDDEN', 'This API key is bound to a different project.')
  }
}

/** Masked display form for dashboards — prefix + hash fingerprint, no secret. */
export function keyFingerprint(prefix: string, keyHash: string): string {
  return `${prefix}…${keyHash.slice(0, 4)}`
}
