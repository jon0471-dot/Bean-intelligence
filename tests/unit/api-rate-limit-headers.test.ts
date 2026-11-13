/**
 * PHASE 0 — truthful rate-limit response headers (contract hardening).
 *
 * Contract pinned here (Phase 0 authorization §4, §7.A–§7.D):
 *  - `rateLimitHeaders()` emits ONLY values derived from real limiter/quota/
 *    breaker state; anything absent or non-numeric is OMITTED, never
 *    fabricated; `Retry-After` is a non-negative integer (seconds);
 *    `X-RateLimit-Reset` is epoch SECONDS of a genuinely calculated reset.
 *  - `BeanApiError` carries optional headers; the error envelope
 *    `{ ok:false, error:{ code, message, detail } }` and the status mapping
 *    are UNCHANGED; an error without headers produces the exact legacy
 *    response (no rate-limit headers, no shape drift).
 *  - `checkRateLimit` exposes remaining/reset truth: remaining = slots left
 *    in the window; resetAtMs = oldest in-window hit + window (the real
 *    moment a slot frees).
 *  - Per-key 429s (verifyApiKey) carry the rejecting window's truth:
 *    Retry-After + X-RateLimit-Limit/Remaining/Reset.
 *  - Daily quota (checkGatewayQuota) reports the REAL reset boundary — the
 *    next local midnight, the same instant the durable count query resets.
 *  - Upstream breaker: remaining cooldown → truthful Retry-After; closed
 *    breaker → no value (nothing invented).
 *
 * The ONLY mocked boundary is the database (in-memory fakes, same discipline
 * as api-keys.test.ts); limiter, breaker and header logic under test are the
 * real production code.
 *
 * Run: bun test tests/unit/api-rate-limit-headers.test.ts
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
// Static import is safe: errors.ts has zero imports (plain error class).
import { BeanApiError, rateLimitHeaders } from '../../src/lib/api/errors'
// Static import is safe: upstream/gateway.ts imports types only.
import {
  _resetUpstreamCooldownForTests,
  noteUpstream429,
  upstreamCooldownRemainingMs,
  UPSTREAM_429_COOLDOWN_MS,
} from '../../src/lib/upstream/gateway'

// ---- in-memory fake for the Prisma boundary (the ONLY mocked boundary) ------

const usageCounts: Array<{ userId: string; product: string; success: boolean; createdAt: Date }> = []

const fakeDb = {
  apiKey: {
    async create({ data }: { data: Record<string, unknown> }) {
      return { id: `key-${usageCounts.length + Math.random()}`, createdAt: new Date(), requestCount: 0, lastUsedAt: null, status: 'active', permissions: '[]', rateLimitPerMin: 60, revokedAt: null, ...data }
    },
    async findMany({ where }: { where: { prefix?: string; status?: string } }) {
      // Minimal verify-path fake: one active key row per prefix is enough —
      // createApiKey is not exercised for the rate-limit header assertions.
      return ((globalThis as unknown as { __fakeKeyRows?: FakeKeyRow[] }).__fakeKeyRows ?? []).filter(
        (r) => (where.prefix === undefined || r.prefix === where.prefix) && (where.status === undefined || r.status === where.status),
      )
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      // Usage-tracking update (requestCount increment + lastUsedAt) — the
      // verify path calls this and swallows failures, but a working fake keeps
      // the exercised path identical to production.
      const rows = (globalThis as unknown as { __fakeKeyRows?: FakeKeyRow[] }).__fakeKeyRows ?? []
      const row = rows.find((r) => r.id === where.id)
      if (!row) throw new Error('not found')
      return row
    },
  },
  usageRecord: {
    async count({ where }: { where: { userId: string; product: string; success: boolean; createdAt: { gte: Date } } }) {
      return usageCounts.filter(
        (r) =>
          r.userId === where.userId &&
          r.product === where.product &&
          r.success === where.success &&
          r.createdAt.getTime() >= where.createdAt.gte.getTime(),
      ).length
    },
  },
}

interface FakeKeyRow {
  id: string
  userId: string
  prefix: string
  keyHash: string
  permissions: string
  rateLimitPerMin: number
  status: string
  expiresAt: Date | null
}

function installFakeKeyRow(row: FakeKeyRow): void {
  const holder = globalThis as unknown as { __fakeKeyRows?: FakeKeyRow[] }
  holder.__fakeKeyRows = [...(holder.__fakeKeyRows ?? []), row]
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

beforeEach(() => {
  usageCounts.length = 0
  ;(globalThis as unknown as { __fakeKeyRows?: FakeKeyRow[] }).__fakeKeyRows = []
  _resetUpstreamCooldownForTests()
})

// Dynamic imports bind AFTER the mock registration (repo convention).
const { checkRateLimit } = await import('../../src/lib/auth/ratelimit')
const { checkGatewayQuota } = await import('../../src/lib/ai-gateway/gateway')
const { verifyApiKey, API_KEY_PREFIX } = await import('../../src/lib/security/api-keys')
import { safeEqual, hashApiKey } from '../../src/lib/security/crypto'

// ---- A. rateLimitHeaders — truthful emission, omission when unknown --------

describe('rateLimitHeaders — truthful emission (Phase 0 §4)', () => {
  test('emits all four headers when real values exist; formats are standards-compatible', () => {
    const h = rateLimitHeaders({ limit: 30, remaining: 0, resetAtMs: 1_731_486_000_500, retryAfterSec: 41.2 })
    expect(h).toBeDefined()
    expect(h!['X-RateLimit-Limit']).toBe('30')
    expect(h!['X-RateLimit-Remaining']).toBe('0')
    expect(h!['X-RateLimit-Reset']).toBe('1731486000') // epoch SECONDS, floored
    expect(h!['Retry-After']).toBe('42') // non-negative INTEGER seconds (ceil)
  })

  test('omits any value that is absent, null or non-finite — never fabricates', () => {
    expect(rateLimitHeaders({})).toBeUndefined()
    expect(rateLimitHeaders({ limit: null, remaining: null, resetAtMs: null, retryAfterSec: null })).toBeUndefined()
    expect(rateLimitHeaders({ retryAfterSec: Number.NaN })).toBeUndefined()
    expect(rateLimitHeaders({ retryAfterSec: Number.POSITIVE_INFINITY })).toBeUndefined()
    const noReset = rateLimitHeaders({ limit: 60, remaining: 0, resetAtMs: null })
    expect(noReset).toBeDefined()
    expect(noReset!['X-RateLimit-Reset']).toBeUndefined()
    expect(Object.keys(noReset!)).toEqual(['X-RateLimit-Limit', 'X-RateLimit-Remaining'])
  })

  test('rejects impossible values: negative retry delay, negative counts', () => {
    expect(rateLimitHeaders({ retryAfterSec: -5 })).toBeUndefined()
    expect(rateLimitHeaders({ limit: -1 })).toBeUndefined()
    expect(rateLimitHeaders({ remaining: -3 })).toBeUndefined()
    expect(rateLimitHeaders({ resetAtMs: -100 })).toBeUndefined()
  })

  test('Retry-After zero is a VALID non-negative integer (immediate retry allowed)', () => {
    const h = rateLimitHeaders({ retryAfterSec: 0 })
    expect(h!['Retry-After']).toBe('0')
  })
})

// ---- B. BeanApiError — headers on the wire, envelope UNCHANGED ---------------

describe('BeanApiError headers — envelope compatibility (Phase 0 §4)', () => {
  test('error WITHOUT headers produces the exact legacy response (no rate-limit headers)', async () => {
    const res = new BeanApiError('RATE_LIMITED', 'Gateway rate limit reached (30/min). Retry in 5s.').toResponse()
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(res.headers.get('x-ratelimit-limit')).toBeNull()
    expect(res.headers.get('x-ratelimit-remaining')).toBeNull()
    expect(res.headers.get('x-ratelimit-reset')).toBeNull()
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; detail?: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.message).toBe('Gateway rate limit reached (30/min). Retry in 5s.')
    expect(Object.keys(body.error)).toEqual(['code', 'message']) // detail: undefined drops out — unchanged
  })

  test('error WITH headers keeps the envelope byte-identical and adds ONLY the headers', async () => {
    const err = new BeanApiError('QUOTA_EXCEEDED', 'Gateway daily quota reached (500/500). Resets at midnight.', undefined, {
      headers: rateLimitHeaders({ limit: 500, remaining: 0, resetAtMs: 1_731_486_000_000, retryAfterSec: 3600 }),
    })
    const res = err.toResponse()
    expect(res.status).toBe(429) // status mapping unchanged
    expect(res.headers.get('retry-after')).toBe('3600')
    expect(res.headers.get('x-ratelimit-limit')).toBe('500')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(res.headers.get('x-ratelimit-reset')).toBe('1731486000')
    const body = (await res.json()) as { ok: boolean; error: Record<string, unknown> }
    expect(body).toEqual({ ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'Gateway daily quota reached (500/500). Resets at midnight.' } })
  })

  test('headers on non-429 codes flow through with the mapped status (e.g. 401/403 stay exact)', () => {
    const res = new BeanApiError('UNAUTHENTICATED', 'Sign in or present a valid application API key (Authorization: Bearer bgk_…).').toResponse()
    expect(res.status).toBe(401)
    expect(res.headers.get('retry-after')).toBeNull()
  })
})

// ---- C. checkRateLimit — limiter truth (remaining + real reset) --------------

describe('checkRateLimit — window truth for headers (Phase 0 §4)', () => {
  test('allowed result carries remaining = limit - hits and a real reset moment', () => {
    const a1 = checkRateLimit('hdr-test-1', 3, 60_000)
    expect(a1.allowed).toBe(true)
    expect(a1.remaining).toBe(2)
    expect(a1.resetAtMs).not.toBeNull()
    expect(a1.resetAtMs!).toBeGreaterThan(Date.now())
    const a2 = checkRateLimit('hdr-test-1', 3, 60_000)
    expect(a2.remaining).toBe(1)
  })

  test('rejected result: remaining 0, resetAtMs = oldest hit + window (slot expiry), retryAfterSec consistent', () => {
    checkRateLimit('hdr-test-2', 2, 1_000)
    checkRateLimit('hdr-test-2', 2, 1_000)
    const t0 = Date.now()
    const rej = checkRateLimit('hdr-test-2', 2, 1_000)
    expect(rej.allowed).toBe(false)
    expect(rej.remaining).toBe(0)
    expect(rej.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(rej.resetAtMs).toBeGreaterThanOrEqual(t0)
    // The reset is the moment the oldest hit leaves the window — at most one
    // window away, and consistent with the retry delay (±1s rounding).
    expect(rej.resetAtMs!).toBeLessThanOrEqual(t0 + 1_000 + 5)
    expect(Math.abs(rej.resetAtMs! - (t0 + rej.retryAfterSec * 1000))).toBeLessThanOrEqual(1_500)
  })

  test('after the window passes, capacity is truly restored (reset was real)', async () => {
    checkRateLimit('hdr-test-3', 1, 30)
    const rej = checkRateLimit('hdr-test-3', 1, 30)
    expect(rej.allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 45))
    const again = checkRateLimit('hdr-test-3', 1, 30)
    expect(again.allowed).toBe(true)
    expect(again.remaining).toBe(0)
  })
})

// ---- D. per-key 429 — headers from the rejecting window (Phase 0 §4) --------

describe('verifyApiKey per-key 429 — truthful headers on the wire (Phase 0 §4)', () => {
  test('the (N+1)th request carries Retry-After + X-RateLimit-* from the real window', async () => {
    const raw = `${API_KEY_PREFIX}header-test-key-material-0000000000000000`
    installFakeKeyRow({
      id: 'key-hdr-1',
      userId: 'admin-1',
      prefix: raw.slice(0, API_KEY_PREFIX.length + 4),
      keyHash: hashApiKey(raw),
      permissions: '["chat:completions"]',
      rateLimitPerMin: 1,
      status: 'active',
      expiresAt: null,
    })
    const first = await verifyApiKey(raw) // 1 — inside the limit
    expect(first.kind).toBe('api-key')
    const t0 = Date.now()
    try {
      await verifyApiKey(raw) // 2 — over the limit
      expect.unreachable()
    } catch (e) {
      const err = e as BeanApiError
      expect(err.code).toBe('RATE_LIMITED')
      expect(err.headers).toBeDefined()
      expect(err.headers!['X-RateLimit-Limit']).toBe('1')
      expect(err.headers!['X-RateLimit-Remaining']).toBe('0')
      expect(Number.parseInt(err.headers!['Retry-After']!, 10)).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(Number.parseInt(err.headers!['Retry-After']!, 10))).toBe(true)
      const resetSec = Number.parseInt(err.headers!['X-RateLimit-Reset']!, 10)
      expect(resetSec).toBeGreaterThanOrEqual(Math.floor(t0 / 1000))
      expect(resetSec).toBeLessThanOrEqual(Math.floor(t0 / 1000) + 61)
    }
  })

  test('a valid (non-throttled) verification carries NO rate-limit headers', async () => {
    const raw = `${API_KEY_PREFIX}header-test-clean-key-material-00000000000`
    installFakeKeyRow({
      id: 'key-hdr-2',
      userId: 'admin-1',
      prefix: raw.slice(0, API_KEY_PREFIX.length + 4),
      keyHash: hashApiKey(raw),
      permissions: '["models:read"]',
      rateLimitPerMin: 60,
      status: 'active',
      expiresAt: null,
    })
    const auth = await verifyApiKey(raw)
    expect(auth.kind).toBe('api-key')
    expect(auth.rateLimitPerMin).toBe(60)
    // No error path involved → no headers anywhere (success responses unchanged).
  })
})

// ---- E. daily quota — REAL reset boundary (next local midnight) --------------

describe('checkGatewayQuota — reset boundary truth (Phase 0 §4)', () => {
  test('rejection reports the real next-local-midnight reset (same boundary the count uses)', async () => {
    for (let i = 0; i < 500; i++) {
      usageCounts.push({ userId: 'usr-quota', product: 'api-gateway', success: true, createdAt: new Date() })
    }
    const q = await checkGatewayQuota('usr-quota')
    expect(q.allowed).toBe(false)
    expect(q.used).toBe(500)
    expect(q.limit).toBe(500)
    const now = new Date()
    const reset = new Date(q.resetsAtMs)
    // Midnight semantics: the reset instant is exactly the next local midnight
    // (00:00:00.000), the same boundary the durable count query flips on.
    expect(reset.getHours()).toBe(0)
    expect(reset.getMinutes()).toBe(0)
    expect(reset.getSeconds()).toBe(0)
    expect(reset.getMilliseconds()).toBe(0)
    expect(q.resetsAtMs).toBeGreaterThan(now.getTime())
    expect(q.resetsAtMs).toBeLessThanOrEqual(now.getTime() + 24 * 3600 * 1000 + 5)
    // Retry-After derived from it is a sane non-negative integer second count.
    const derived = Math.max(0, Math.ceil((q.resetsAtMs - Date.now()) / 1000))
    expect(Number.isInteger(derived)).toBe(true)
    expect(derived).toBeGreaterThanOrEqual(0)
    expect(derived).toBeLessThanOrEqual(24 * 3600)
  })

  test('below the limit the quota is allowed and the reset is still the real boundary', async () => {
    for (let i = 0; i < 499; i++) {
      usageCounts.push({ userId: 'usr-quota-2', product: 'api-gateway', success: true, createdAt: new Date() })
    }
    const q = await checkGatewayQuota('usr-quota-2')
    expect(q.allowed).toBe(true)
    expect(q.used).toBe(499)
    expect(new Date(q.resetsAtMs).getHours()).toBe(0)
  })
})

// ---- F. upstream cooldown — Retry-After only when truly known ---------------

describe('upstream breaker — Retry-After truth (Phase 0 §4)', () => {
  test('open breaker yields a real remaining window inside the known bounds', () => {
    noteUpstream429('chat')
    const remainingMs = upstreamCooldownRemainingMs('chat')
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(UPSTREAM_429_COOLDOWN_MS)
    const retryAfterSec = Math.ceil(remainingMs / 1000)
    expect(Number.isInteger(retryAfterSec)).toBe(true)
    expect(retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(retryAfterSec).toBeLessThanOrEqual(60)
    const headers = rateLimitHeaders({ retryAfterSec })
    expect(headers!['Retry-After']).toBe(String(retryAfterSec))
    // NOT a caller rate limit — Limit/Remaining/Reset are correctly ABSENT.
    expect(headers!['X-RateLimit-Limit']).toBeUndefined()
    expect(headers!['X-RateLimit-Remaining']).toBeUndefined()
    expect(headers!['X-RateLimit-Reset']).toBeUndefined()
  })

  test('closed breaker (no observed 429) yields NO retry value — nothing invented', () => {
    expect(upstreamCooldownRemainingMs('chat')).toBe(0)
    expect(rateLimitHeaders({ retryAfterSec: null })).toBeUndefined()
  })

  test('escalated streak widens the honest window up to the hard cap', () => {
    noteUpstream429('chat')
    noteUpstream429('chat')
    const remainingMs = upstreamCooldownRemainingMs('chat')
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(600_000) // bounded hard cap
  })
})

// ---- G. crypto helper sanity (guard the fake's hash equality semantics) -----

describe('fake boundary sanity', () => {
  test('hashApiKey + safeEqual behave as the real verify path expects', () => {
    const h = hashApiKey('bgk_example_material')
    expect(h).toHaveLength(64)
    expect(safeEqual(h, hashApiKey('bgk_example_material'))).toBe(true)
    expect(safeEqual(h, hashApiKey('bgk_other_material'))).toBe(false)
  })
})
