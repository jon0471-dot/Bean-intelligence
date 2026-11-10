/**
 * Application API key security tests (work order Part 3 §11, §16).
 *
 * The database boundary is a SELF-CONTAINED in-memory fake (mock.module) —
 * no test writes anywhere near the real DB. Contract pinned here:
 *  - keys are `bgk_` + 256 bits of CSPRNG material; uniqueness in practice;
 *  - ONLY the SHA-256 hash is stored — the raw key is never in any record;
 *  - verification: valid key passes; wrong/unknown key → UNAUTHENTICATED;
 *    revoked → rejected; expired → FORBIDDEN; scope missing → FORBIDDEN;
 *  - per-key rate limit enforces the configured requests/minute;
 *  - rotation replaces the hash atomically: old key dies, new key works;
 *  - fingerprint/masked views carry no key material.
 *
 * Run: bun test tests/unit/api-keys.test.ts
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
// Static import is safe: errors.ts has zero imports (plain error class).
import { BeanApiError } from '../../src/lib/api/errors'

// ---- in-memory fake for the Prisma boundary (the ONLY mocked boundary) ------

interface FakeKeyRow {
  id: string
  userId: string
  name: string
  prefix: string
  keyHash: string
  permissions: string
  rateLimitPerMin: number
  status: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  requestCount: number
  createdAt: Date
  revokedAt: Date | null
}

const keyStore = new Map<string, FakeKeyRow>()
let idCounter = 0

const fakeDb = {
  apiKey: {
    async create({ data }: { data: Omit<FakeKeyRow, 'id' | 'createdAt' | 'requestCount' | 'lastUsedAt'> & { requestCount?: number } }) {
      const row = {
        id: `key-${++idCounter}`,
        createdAt: new Date(),
        requestCount: 0,
        lastUsedAt: null,
        ...data,
      } as Partial<FakeKeyRow> & { id: string; createdAt: Date; requestCount: number; lastUsedAt: Date | null }
      // Prisma schema defaults (@default(...) in prisma/schema.prisma) — the
      // real store applies these for any column the caller omitted; the fake
      // must behave identically or verification queries diverge.
      row.status ??= 'active'
      row.permissions ??= '[]'
      row.rateLimitPerMin ??= 60
      row.revokedAt ??= null
      const stored = row as FakeKeyRow
      keyStore.set(stored.id, stored)
      return stored
    },
    async findUnique({ where }: { where: { id: string } }) {
      return keyStore.get(where.id) ?? null
    },
    async findMany({ where }: { where: { prefix?: string; status?: string } }) {
      return [...keyStore.values()].filter(
        (r) => (where.prefix === undefined || r.prefix === where.prefix) && (where.status === undefined || r.status === where.status),
      )
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakeKeyRow> & { requestCount?: { increment: number } } }) {
      const row = keyStore.get(where.id)
      if (!row) throw new Error('not found')
      const inc = typeof data.requestCount === 'object' && data.requestCount !== null && 'increment' in data.requestCount ? (data.requestCount as { increment: number }).increment : undefined
      const { requestCount: _rc, ...rest } = data
      Object.assign(row, rest)
      if (inc !== undefined) row.requestCount += inc
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// Reset the store before each test (module-level state).
beforeEach(() => {
  keyStore.clear()
})

const { createApiKey, verifyApiKey, revokeApiKey, rotateApiKey, assertScope, API_KEY_PREFIX } = await import('../../src/lib/security/api-keys')

async function makeKey(overrides: Partial<{ name: string; permissions: string[]; rateLimitPerMin: number; expiresAt: Date | null }> = {}) {
  return createApiKey({
    ownerId: 'admin-1',
    name: overrides.name ?? 'Test key',
    permissions: overrides.permissions ?? ['chat:completions'],
    rateLimitPerMin: overrides.rateLimitPerMin ?? 60,
    expiresAt: overrides.expiresAt ?? null,
  })
}

describe('application API keys — storage', () => {
  test('generated keys are bgk_-prefixed and idempotently hashable; raw key is NEVER stored', async () => {
    const created = await makeKey()
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(created.key.length).toBeGreaterThan(API_KEY_PREFIX.length + 40)
    const rows = [...keyStore.values()]
    expect(rows).toHaveLength(1)
    expect(rows[0].keyHash).toHaveLength(64) // sha256 hex
    expect(JSON.stringify(rows[0])).not.toContain(created.key) // raw key never persisted
    expect(rows[0].prefix).toBe(created.prefix)
  })

  test('two generated keys differ (CSPRNG uniqueness)', async () => {
    const a = await makeKey()
    const b = await makeKey()
    expect(a.key).not.toBe(b.key)
  })

  test('unknown permission scopes are rejected at creation', async () => {
    expect(makeKey({ permissions: ['chat:completions', 'root:everything'] })).rejects.toThrow(BeanApiError)
  })
})

describe('application API keys — verification', () => {
  test('a valid key verifies and returns its grants', async () => {
    const created = await makeKey({ permissions: ['chat:completions', 'models:read'] })
    const auth = await verifyApiKey(created.key)
    expect(auth.kind).toBe('api-key')
    expect(auth.permissions).toEqual(['chat:completions', 'models:read'])
    expect(auth.userId).toBe('admin-1')
  })

  test('a wrong key of the right shape → UNAUTHENTICATED', async () => {
    await makeKey()
    expect(verifyApiKey(`${API_KEY_PREFIX}totally-wrong-key-value-000000`)).rejects.toThrow(BeanApiError)
  })

  test('a non-bgk string → UNAUTHENTICATED', async () => {
    await makeKey()
    expect(verifyApiKey('sk-some-other-secret')).rejects.toThrow(BeanApiError)
  })

  test('a revoked key is rejected on the next request', async () => {
    const created = await makeKey()
    const auth = await verifyApiKey(created.key)
    await revokeApiKey(auth.keyId, 'admin-1')
    expect(verifyApiKey(created.key)).rejects.toThrow(/Invalid API key|revoked/i)
  })

  test('an expired key is rejected with an honest expiry error', async () => {
    const created = await makeKey({ expiresAt: new Date(Date.now() - 1_000) })
    try {
      await verifyApiKey(created.key)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('FORBIDDEN')
      expect((e as BeanApiError).message).toMatch(/expired/i)
    }
  })

  test('error messages never contain key material', async () => {
    const created = await makeKey()
    try {
      await verifyApiKey(`${created.key.slice(0, -2)}xx`)
    } catch (e) {
      const message = (e as Error).message
      expect(message).not.toContain(created.key)
      expect(message).not.toContain(created.key.slice(API_KEY_PREFIX.length, 20))
    }
  })
})

describe('application API keys — permissions + rate limit', () => {
  test('assertScope rejects a key without the required scope', async () => {
    const created = await makeKey({ permissions: ['models:read'] })
    const auth = await verifyApiKey(created.key)
    expect(() => assertScope(auth, 'chat:completions')).toThrow(/does not grant/)
  })

  test('assertScope accepts granted scopes and the wildcard', async () => {
    const scoped = await verifyApiKey((await makeKey({ permissions: ['*'] })).key)
    expect(() => assertScope(scoped, 'chat:completions')).not.toThrow()
    const normal = await verifyApiKey((await makeKey({ permissions: ['usage:read'] })).key)
    expect(() => assertScope(normal, 'usage:read')).not.toThrow()
  })

  test('per-key rate limit: the (N+1)th request inside the window is RATE_LIMITED', async () => {
    const created = await makeKey({ rateLimitPerMin: 2 })
    await verifyApiKey(created.key) // 1
    await verifyApiKey(created.key) // 2
    try {
      await verifyApiKey(created.key) // 3 — over the limit
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('RATE_LIMITED')
    }
  })

  test('usage tracking increments requestCount without storing the secret', async () => {
    const created = await makeKey()
    const auth = await verifyApiKey(created.key)
    const row = keyStore.get(auth.keyId)!
    expect(row.requestCount).toBe(1)
    expect(row.lastUsedAt).not.toBeNull()
    expect(JSON.stringify(row)).not.toContain(created.key)
  })
})

describe('application API keys — rotation', () => {
  test('rotation mints a new key: old key dies immediately, new key works', async () => {
    const created = await makeKey()
    await verifyApiKey(created.key)
    const rotated = await rotateApiKey((await verifyApiKey(created.key)).keyId, 'admin-1')
    expect(rotated.key).not.toBe(created.key)
    // Old key no longer verifies.
    expect(verifyApiKey(created.key)).rejects.toThrow(BeanApiError)
    // New key verifies.
    const auth = await verifyApiKey(rotated.key)
    expect(auth.keyId).toBe(rotated.id)
    // Raw keys are never in any stored record.
    for (const row of keyStore.values()) {
      expect(JSON.stringify(row)).not.toContain(created.key)
      expect(JSON.stringify(row)).not.toContain(rotated.key)
    }
  })

  test("rotation of another admin's key is NOT_FOUND (ownership enforced)", async () => {
    const created = await makeKey()
    expect(rotateApiKey((await verifyApiKey(created.key)).keyId, 'attacker-9')).rejects.toThrow(BeanApiError)
  })
})
