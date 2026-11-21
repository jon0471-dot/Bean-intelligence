/**
 * Client compute — capability report route tests (auth, rate limit, payload
 * minimization, ownership). Pattern follows tests/unit/portal-tenancy.test.ts:
 * handlers invoked with real Request objects; Prisma, session resolver and
 * the limiter are mocked boundaries; the error envelope + zod stack are REAL.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- resettable limiter copy (same semantics as src/lib/auth/ratelimit.ts) ---
const windows = new Map<string, number[]>()
mock.module('@/lib/auth/ratelimit', () => ({
  checkRateLimit: (key: string, limit: number, windowMs: number) => {
    const now = Date.now()
    const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs)
    if (hits.length >= limit) {
      windows.set(key, hits)
      return {
        allowed: false,
        retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000),
        remaining: 0,
        resetAtMs: hits[0] + windowMs,
      }
    }
    hits.push(now)
    windows.set(key, hits)
    return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, limit - hits.length), resetAtMs: null }
  },
}))

// ---- controlled session ------------------------------------------------------
interface CtlUser { id: string; email: string; name: string | null; role: 'member' | 'admin' }
const ALICE: CtlUser = { id: 'user-alice', email: 'alice@example.test', name: 'Alice', role: 'member' }
const BOB: CtlUser = { id: 'user-bob', email: 'bob@example.test', name: 'Bob', role: 'member' }
let currentUser: CtlUser | null = ALICE
mock.module('@/lib/auth/session', () => ({
  getSessionUser: async () => currentUser,
  // Faithful copy of the real requireUser (pinned by other suites; here it
  // routes through the controlled session above).
  requireUser: async () => {
    const user = await currentUser
    if (!user) {
      const { BeanApiError } = await import('@/lib/api/errors')
      throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    }
    return user
  },
}))

// ---- in-memory Prisma boundary ----------------------------------------------
interface ReportRow { id: string; userId: string; tier: number; conservative: boolean; reportJson: string; createdAt: Date }
const reportRows: ReportRow[] = []
let reportSeq = 0
mock.module('@/lib/db', () => ({
  db: {
    clientComputeReport: {
      create: async ({ data }: { data: { userId: string; tier: number; conservative: boolean; reportJson: string } }) => {
        reportSeq += 1
        const row: ReportRow = { id: `ccr-${reportSeq}`, createdAt: new Date(), ...data }
        reportRows.push(row)
        return row
      },
      findMany: async ({ where, orderBy, take }: { where?: { userId?: string }; orderBy?: { createdAt: string }; take?: number } = {}) => {
        let rows = reportRows.filter((r) => !where?.userId || r.userId === where.userId)
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return rows.slice(0, take ?? rows.length)
      },
    },
  },
}))

// Audit log stub (same shape as metering's recordAudit boundary).
const auditActions: string[] = []
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => {},
  recordAudit: async (input: { action: string }) => {
    auditActions.push(input.action)
  },
}))

const { POST, GET } = await import('@/app/api/client-compute/reports/route')

function validReport() {
  return {
    tier: 3,
    conservative: false,
    webgpuSupported: true,
    webgpuAdapterAvailable: true,
    webgl2: true,
    wasm: true,
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    secureContext: true,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    storageQuotaBytes: 120 * 1024 * 1024 * 1024,
    benchmark: { cpuOpsPerSec: 42_000_000, gpuComputeOk: null, durationMs: 12 },
    installedModels: [],
    reportedAt: new Date().toISOString(),
  }
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/client-compute/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  windows.clear()
  reportRows.length = 0
  auditActions.length = 0
  currentUser = ALICE
})

describe('client-compute report route', () => {
  test('unauthenticated POST → 401 UNAUTHENTICATED envelope', async () => {
    currentUser = null
    const res = await POST(post({ report: validReport() }))
    expect(res.status).toBe(401)
    const json = (await res.json()) as { ok: boolean; error?: { code?: string } }; const errorCode = () => json.error?.code
    expect(json.ok).toBe(false)
    expect(errorCode()).toBe("UNAUTHENTICATED")
  })

  test('authenticated POST stores a sanitized report and audits it', async () => {
    const res = await POST(post({ report: validReport() }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; tier: number }
    expect(json.ok).toBe(true)
    expect(json.tier).toBe(3)
    expect(reportRows).toHaveLength(1)
    expect(reportRows[0].userId).toBe(ALICE.id)
    expect(auditActions).toContain('client-compute.report')
    // Stored payload shape: ONLY the sanitized fields.
    const stored = JSON.parse(reportRows[0].reportJson) as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(
      [
        'benchmark', 'conservative', 'deviceMemoryGb', 'hardwareConcurrency', 'installedModels',
        'offscreenCanvas', 'reportedAt', 'secureContext', 'sharedArrayBuffer', 'storageQuotaBytes',
        'tier', 'wasm', 'webgl2', 'webgpuAdapterAvailable', 'webgpuSupported', 'workers',
      ].sort(),
    )
  })

  test('payload minimization: vendor strings / user agents / payloads are rejected by the schema', async () => {
    const injected = validReport() as Record<string, unknown>
    injected.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) secret'
    injected.gpuVendor = 'nvidia'
    injected.promptText = 'totally a prompt'
    const res = await POST(post({ report: injected }))
    // zod strips nothing silently — the schema is strict about shape? It is a
    // plain object schema: unknown keys are stripped by default, BUT the
    // stored row must never contain them. Verify the stored JSON.
    expect(res.status).toBe(200)
    const stored = JSON.parse(reportRows[0].reportJson) as Record<string, unknown>
    expect(stored.userAgent).toBeUndefined()
    expect(stored.gpuVendor).toBeUndefined()
    expect(stored.promptText).toBeUndefined()
  })

  test('malformed report → 400 VALIDATION_ERROR', async () => {
    const bad = validReport() as Record<string, unknown>
    bad.tier = 9
    const res = await POST(post({ report: bad }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: boolean; error?: { code?: string } }
    expect(json.error?.code).toBe('VALIDATION_ERROR')
    expect(reportRows).toHaveLength(0)
  })

  test('rate limit: the 11th report within the window → 429 RATE_LIMITED with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(post({ report: validReport() }))
      expect(res.status).toBe(200)
    }
    const res = await POST(post({ report: validReport() }))
    expect(res.status).toBe(429)
    const json = (await res.json()) as { ok: boolean; error?: { code?: string } }
    expect(json.error?.code).toBe('RATE_LIMITED')
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  test('per-user isolation: another user POSTs are stored under THEIR id', async () => {
    await POST(post({ report: validReport() }))
    currentUser = BOB
    await POST(post({ report: validReport() }))
    expect(reportRows).toHaveLength(2)
    expect(reportRows.map((r) => r.userId).sort()).toEqual([ALICE.id, BOB.id].sort())
  })

  test('GET returns only the caller’s own reports', async () => {
    await POST(post({ report: validReport() }))
    currentUser = BOB
    await POST(post({ report: validReport() }))
    const res = await GET()
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; reports: Array<{ id: string }> }
    expect(json.ok).toBe(true)
    expect(json.reports).toHaveLength(1) // only BOB's
  })

  test('unauthenticated GET → 401', async () => {
    currentUser = null
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
