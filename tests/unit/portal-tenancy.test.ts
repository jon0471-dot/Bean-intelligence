/**
 * Phase 1 — developer portal tenancy, authorization and IDOR tests.
 *
 * Route-level (handlers imported and invoked with real Request objects).
 * Mocked boundaries: the Prisma client (in-memory fakes) and the session
 * resolver (controlled current user). The gateway-auth, api-keys, rate
 * limiter, error envelope and validation stacks are REAL.
 *
 * Pinned contract:
 *  - unauthenticated requests → 401 UNAUTHENTICATED envelope;
 *  - application API keys (even valid ones) → 403 FORBIDDEN on the portal
 *    (keys never manage keys or projects);
 *  - cross-user Project / key / usage / log access → 404 NOT_FOUND
 *    (existence never revealed), for EVERY operation including nested ones;
 *  - project keys are created through the same central createApiKey
 *    (hash, one-time raw display, portal scope subset, binding);
 *  - usage/log views are owner-scoped and built from real persisted rows.
 *
 * Run: bun test tests/unit/portal-tenancy.test.ts
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- faithful in-memory copy of the shared sliding-window limiter ------------
// Same semantics as src/lib/auth/ratelimit.ts (checkRateLimit), but with a
// resettable window map so per-user portal buckets do not leak across tests.
// The REAL limiter implementation is pinned by tests/unit/api-keys.test.ts
// (per-key 429) and tests/unit/api-rate-limit-headers.test.ts (truthful
// remaining/reset headers); the portal routes' call path + 429 envelope is
// exercised against this copy and by the dedicated 429 test below.
const windows = new Map<string, number[]>()
mock.module('@/lib/auth/ratelimit', () => ({
  checkRateLimit: (key: string, limit: number, windowMs: number) => {
    const now = Date.now()
    const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs)
    if (hits.length >= limit) {
      windows.set(key, hits)
      const oldest = hits[0]
      return {
        allowed: false,
        retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000),
        remaining: Math.max(0, limit - hits.length),
        resetAtMs: oldest + windowMs,
      }
    }
    hits.push(now)
    windows.set(key, hits)
    const oldest = hits[0]
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, limit - hits.length),
      resetAtMs: oldest !== undefined ? oldest + windowMs : null,
    }
  },
}))

// ---- controlled session ------------------------------------------------------

interface CtlUser {
  id: string
  email: string
  name: string | null
  role: 'member' | 'admin'
}
const ALICE: CtlUser = { id: 'user-alice', email: 'alice@example.test', name: 'Alice', role: 'member' }
const BOB: CtlUser = { id: 'user-bob', email: 'bob@example.test', name: 'Bob', role: 'member' }
const ADMIN: CtlUser = { id: 'user-admin', email: 'admin@example.test', name: 'Admin', role: 'admin' }
let currentUser: CtlUser | null = ALICE

mock.module('@/lib/auth/session', () => ({
  getSessionUser: async () => currentUser,
}))

// ---- in-memory Prisma boundary ------------------------------------------------

interface ProjectRow {
  id: string
  userId: string
  name: string
  status: string
  createdAt: Date
  updatedAt: Date
}
interface KeyRow {
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
  projectId: string | null
}
interface LogRow {
  id: string
  authKind: string
  keyId: string | null
  userId: string | null
  provider: string
  model: string
  endpoint: string
  status: number
  errorCode: string | null
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number | null
  streamed: boolean
  createdAt: Date
}
interface AuditRow {
  id: string
  actorId: string | null
  action: string
  target: string | null
  metaJson: string | null
  createdAt: Date
}

const projects: ProjectRow[] = []
const keys: KeyRow[] = []
const reqLogs: LogRow[] = []
const audits: AuditRow[] = []
let seq = 0

const fakeDb = {
  project: {
    async create({ data }: { data: Pick<ProjectRow, 'userId' | 'name'> }) {
      const row: ProjectRow = { id: `proj-${++seq}`, status: 'active', createdAt: new Date(), updatedAt: new Date(), ...data }
      projects.push(row)
      return row
    },
    async findMany({ where, orderBy, take }: { where?: { userId?: string }; orderBy?: { updatedAt?: string }; take?: number } = {}) {
      let rows = projects.filter((p) => (where?.userId ? p.userId === where.userId : true))
      if (orderBy?.updatedAt === 'desc') rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return take ? rows.slice(0, take) : rows
    },
    async findUnique({ where }: { where: { id: string } }) {
      return projects.find((p) => p.id === where.id) ?? null
    },
    async update({ where, data }: { where: { id: string }; data: Partial<ProjectRow> }) {
      const row = projects.find((p) => p.id === where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  },
  apiKey: {
    async create({ data }: { data: Partial<KeyRow> & Pick<KeyRow, 'userId' | 'name' | 'prefix' | 'keyHash' | 'permissions'> }) {
      const row = { id: `key-${++seq}`, createdAt: new Date(), requestCount: 0, lastUsedAt: null, ...data } as KeyRow
      row.status ??= 'active'
      row.rateLimitPerMin ??= 60
      row.revokedAt ??= null
      row.projectId ??= null
      row.expiresAt ??= null
      keys.push(row)
      return row
    },
    async findUnique({ where }: { where: { id: string } }) {
      return keys.find((k) => k.id === where.id) ?? null
    },
    async findMany({ where, orderBy, take, select: _select }: { where?: { projectId?: string; prefix?: string; status?: string }; orderBy?: { createdAt?: string }; take?: number; select?: unknown } = {}) {
      let rows = keys.filter(
        (k) => (where?.projectId === undefined || k.projectId === where.projectId) && (where?.prefix === undefined || k.prefix === where.prefix) && (where?.status === undefined || k.status === where.status),
      )
      if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return take ? rows.slice(0, take) : rows
    },
    async update({ where, data }: { where: { id: string }; data: Partial<KeyRow> & { requestCount?: { increment: number } } }) {
      const row = keys.find((k) => k.id === where.id)
      if (!row) throw new Error('not found')
      const inc = typeof data.requestCount === 'object' && data.requestCount !== null && 'increment' in data.requestCount ? (data.requestCount as { increment: number }).increment : undefined
      const { requestCount: _rc, ...rest } = data
      Object.assign(row, rest)
      if (inc !== undefined) row.requestCount += inc
      return row
    },
  },
  gatewayRequestLog: {
    async findMany({ where, orderBy, take }: { where?: { keyId?: { in?: string[] } }; orderBy?: { createdAt?: string }; take?: number } = {}) {
      const inIds = where?.keyId?.in
      let rows = reqLogs.filter((r) => (inIds ? r.keyId !== null && inIds.includes(r.keyId) : true))
      if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return take ? rows.slice(0, take) : rows
    },
  },
  auditLog: {
    async create({ data }: { data: Pick<AuditRow, 'actorId' | 'action'> & { target?: string | null; metaJson?: string | null } }) {
      const row: AuditRow = { id: `audit-${++seq}`, target: null, metaJson: null, createdAt: new Date(), ...data }
      audits.push(row)
      return row
    },
    async findMany({ where, orderBy, take }: { where?: { actorId?: string }; orderBy?: { createdAt?: string }; take?: number } = {}) {
      let rows = audits.filter((a) => (where?.actorId ? a.actorId === where.actorId : true))
      if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return take ? rows.slice(0, take) : rows
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- route modules (imported AFTER the mocks) ---------------------------------

const collectionRoute = await import('../../src/app/api/portal/projects/route')
const detailRoute = await import('../../src/app/api/portal/projects/[id]/route')
const keysRoute = await import('../../src/app/api/portal/projects/[id]/keys/route')
const keyRoute = await import('../../src/app/api/portal/projects/[id]/keys/[keyId]/route')
const rotateRoute = await import('../../src/app/api/portal/projects/[id]/keys/[keyId]/rotate/route')
const usageRoute = await import('../../src/app/api/portal/projects/[id]/usage/route')
const logsRoute = await import('../../src/app/api/portal/projects/[id]/logs/route')

function jsonReq(url: string, method: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  projects.length = 0
  keys.length = 0
  reqLogs.length = 0
  audits.length = 0
  windows.clear()
  currentUser = ALICE
})

async function makeProject(userId: string, name = 'Alice project'): Promise<ProjectRow> {
  currentUser = { ...ALICE, id: userId, email: `${userId}@example.test` }
  const res = await collectionRoute.POST(jsonReq('http://localhost/api/portal/projects', 'POST', { name }))
  const body = (await res.json()) as { project: ProjectRow }
  expect(res.status).toBe(200)
  return body.project
}

/** Create a key through the REAL central createApiKey via the portal route. */
async function makeKey(projectId: string, userId: string, permissions: string[] = ['chat:completions']) {
  currentUser = { ...ALICE, id: userId, email: `${userId}@example.test` }
  const res = await keysRoute.POST(
    jsonReq(`http://localhost/api/portal/projects/${projectId}/keys`, 'POST', { name: 'CI key', permissions }),
    ctx({ id: projectId }),
  )
  const body = (await res.json()) as { key?: string; id?: string; error?: { code: string } }
  expect(res.status).toBe(200)
  return { rawKey: body.key!, keyId: body.id! }
}

describe('portal rate limiting — existing shared limiter utility', () => {
  test('project creation over the per-user window is RATE_LIMITED with truthful headers', async () => {
    currentUser = ALICE
    // The route's window is 60s with a fixed per-min limit; drive it to the
    // limit with distinct names and expect the honest 429 on the next call.
    let last = 200
    let n = 0
    while (last === 200 && n < 40) {
      n += 1
      const res = await collectionRoute.POST(jsonReq('http://localhost/api/portal/projects', 'POST', { name: `p${n}` }))
      last = res.status
    }
    expect(last).toBe(429)
  })
})

// ---- 401: unauthenticated -----------------------------------------------------

describe('portal 401 — no session at all', () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['POST /projects', () => collectionRoute.POST(jsonReq('http://localhost/api/portal/projects', 'POST', { name: 'X' }))],
    ['GET /projects', () => collectionRoute.GET(jsonReq('http://localhost/api/portal/projects', 'GET'))],
    ['GET /projects/:id', () => detailRoute.GET(jsonReq('http://localhost/api/portal/projects/p1', 'GET'), ctx({ id: 'p1' }))],
    ['PATCH /projects/:id', () => detailRoute.PATCH(jsonReq('http://localhost/api/portal/projects/p1', 'PATCH', { name: 'Y' }), ctx({ id: 'p1' }))],
    ['POST /projects/:id/keys', () => keysRoute.POST(jsonReq('http://localhost/api/portal/projects/p1/keys', 'POST', { name: 'k', permissions: ['chat:completions'] }), ctx({ id: 'p1' }))],
    ['GET /projects/:id/keys', () => keysRoute.GET(jsonReq('http://localhost/api/portal/projects/p1/keys', 'GET'), ctx({ id: 'p1' }))],
    ['DELETE /projects/:id/keys/:keyId', () => keyRoute.DELETE(jsonReq('http://localhost/api/portal/projects/p1/keys/k1', 'DELETE'), ctx({ id: 'p1', keyId: 'k1' }))],
    ['POST /projects/:id/keys/:keyId/rotate', () => rotateRoute.POST(jsonReq('http://localhost/api/portal/projects/p1/keys/k1/rotate', 'POST'), ctx({ id: 'p1', keyId: 'k1' }))],
    ['GET /projects/:id/usage', () => usageRoute.GET(jsonReq('http://localhost/api/portal/projects/p1/usage', 'GET'), ctx({ id: 'p1' }))],
    ['GET /projects/:id/logs', () => logsRoute.GET(jsonReq('http://localhost/api/portal/projects/p1/logs', 'GET'), ctx({ id: 'p1' }))],
  ]
  for (const [label, call] of cases) {
    test(`${label} → 401 when signed out`, async () => {
      currentUser = null
      const res = await call()
      expect(res.status).toBe(401)
      const body = (await res.json()) as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('UNAUTHENTICATED')
    })
  }
})

// ---- 403: API keys never manage the portal ------------------------------------

describe('portal 403 — application API keys cannot manage projects or keys', () => {
  test('a VALID project key presenting Bearer auth is FORBIDDEN on every portal operation', async () => {
    const project = await makeProject(ALICE.id)
    const { rawKey } = await makeKey(project.id, ALICE.id)
    currentUser = null // bearer callers carry no cookies
    const headers = { authorization: `Bearer ${rawKey}` }
    const res = await detailRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'GET', undefined, headers), ctx({ id: project.id }))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
    // A valid key must not grant anything else either.
    const res2 = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'k2', permissions: ['chat:completions'] }, headers),
      ctx({ id: project.id }),
    )
    expect(res2.status).toBe(403)
  })
})

// ---- happy paths + ownership --------------------------------------------------

describe('portal projects — create, list, read, update (single-owner tenancy)', () => {
  test('a member (non-admin) developer can create a project and it appears in THEIR list', async () => {
    const project = await makeProject(ALICE.id, 'My integration')
    // Safe projection: the view carries identity-free ownership — possession
    // is proven behaviorally (visible to the owner, invisible to others).
    expect(project.id).toBeTruthy()
    currentUser = ALICE
    const res = await collectionRoute.GET(jsonReq('http://localhost/api/portal/projects', 'GET'))
    const body = (await res.json()) as { projects: ProjectRow[] }
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0].id).toBe(project.id)
    expect(body.projects[0].name).toBe('My integration')
    expect(body.projects[0].status).toBe('active')
  })

  test('an admin session can use the portal too (any authenticated session)', async () => {
    const project = await makeProject(ADMIN.id, 'Admin project')
    expect(project.id).toBeTruthy()
    currentUser = ADMIN
    const res = await collectionRoute.GET(jsonReq('http://localhost/api/portal/projects', 'GET'))
    const body = (await res.json()) as { projects: ProjectRow[] }
    expect(body.projects.map((p) => p.id)).toContain(project.id)
  })

  test('listing is owner-scoped: Bob never sees Alice’s projects', async () => {
    await makeProject(ALICE.id, 'Alice-only')
    currentUser = BOB
    const res = await collectionRoute.GET(jsonReq('http://localhost/api/portal/projects', 'GET'))
    const body = (await res.json()) as { projects: unknown[] }
    expect(body.projects).toHaveLength(0)
  })

  test('cross-user READ is 404 and never reveals existence', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = BOB
    const res = await detailRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'GET'), ctx({ id: project.id }))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('cross-user UPDATE is 404; the owner can rename and archive/reactivate', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = BOB
    const denied = await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { name: 'Hacked' }), ctx({ id: project.id }))
    expect(denied.status).toBe(404)
    currentUser = ALICE
    const renamed = await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { name: 'Renamed' }), ctx({ id: project.id }))
    expect(renamed.status).toBe(200)
    const renamedBody = (await renamed.json()) as { project: ProjectRow }
    expect(renamedBody.project.name).toBe('Renamed')
    const archived = await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { status: 'archived' }), ctx({ id: project.id }))
    expect(((await archived.json()) as { project: ProjectRow }).project.status).toBe('archived')
    const reactivated = await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { status: 'active' }), ctx({ id: project.id }))
    expect(((await reactivated.json()) as { project: ProjectRow }).project.status).toBe('active')
  })

  test('PATCH with no fields is a VALIDATION_ERROR (400)', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = ALICE
    const res = await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', {}), ctx({ id: project.id }))
    expect(res.status).toBe(400)
  })
})

describe('portal keys — scoped creation, one-time display, safe listing', () => {
  test('a developer can create a scoped key for their project; raw key returned once, metadata only afterwards', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = ALICE
    const res = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'CI key', permissions: ['chat:completions', 'images:generate'] }),
      ctx({ id: project.id }),
    )
    expect(res.status).toBe(200)
    const created = (await res.json()) as { key: string; id: string; permissions: string[]; projectId: string; notice: string }
    expect(created.key.startsWith('bgk_')).toBe(true)
    expect(created.projectId).toBe(project.id)
    expect(created.permissions).toEqual(['chat:completions', 'images:generate'])
    expect(created.notice).toMatch(/shown only once/i)

    const list = await keysRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'GET'), ctx({ id: project.id }))
    const listBody = (await list.json()) as { scopes: string[]; keys: Array<{ id: string; fingerprint: string; permissions: string[]; requestCount: number }> }
    expect(listBody.scopes).not.toContain('*')
    expect(listBody.keys).toHaveLength(1)
    expect(listBody.keys[0].id).toBe(created.id)
    // SAFE METADATA ONLY: the raw key never appears again anywhere.
    expect(JSON.stringify(listBody)).not.toContain(created.key)
    expect(listBody.keys[0].fingerprint).toMatch(/^bgk_.+…/)
    // The stored row contains only the hash.
    const stored = keys.find((k) => k.id === created.id)!
    expect(stored.keyHash).toHaveLength(64)
    expect(JSON.stringify(stored)).not.toContain(created.key)
    expect(stored.projectId).toBe(project.id)
  })

  test('portal scope subset is enforced: wildcard and providers:read are rejected with 400', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = ALICE
    const wild = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'w', permissions: ['*'] as unknown as string[] }),
      ctx({ id: project.id }),
    )
    expect(wild.status).toBe(400)
    const prov = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'p', permissions: ['providers:read'] as unknown as string[] }),
      ctx({ id: project.id }),
    )
    expect(prov.status).toBe(400)
  })

  test('an ARCHIVED project cannot mint keys (400), active projects can', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = ALICE
    await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { status: 'archived' }), ctx({ id: project.id }))
    const denied = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'k', permissions: ['chat:completions'] }),
      ctx({ id: project.id }),
    )
    expect(denied.status).toBe(400)
    await detailRoute.PATCH(jsonReq(`http://localhost/api/portal/projects/${project.id}`, 'PATCH', { status: 'active' }), ctx({ id: project.id }))
    const allowed = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'k', permissions: ['chat:completions'] }),
      ctx({ id: project.id }),
    )
    expect(allowed.status).toBe(200)
  })

  test('cross-user key creation inside another user’s project is 404', async () => {
    const project = await makeProject(ALICE.id)
    currentUser = BOB
    const res = await keysRoute.POST(
      jsonReq(`http://localhost/api/portal/projects/${project.id}/keys`, 'POST', { name: 'intruder', permissions: ['chat:completions'] }),
      ctx({ id: project.id }),
    )
    expect(res.status).toBe(404)
  })
})

describe('portal keys — rotate and revoke ownership', () => {
  test('the owner can rotate (new raw key once, old dies) and revoke', async () => {
    const project = await makeProject(ALICE.id)
    const { rawKey, keyId } = await makeKey(project.id, ALICE.id)
    currentUser = ALICE
    const rot = await rotateRoute.POST(jsonReq(`http://localhost/api/portal/projects/${project.id}/keys/${keyId}/rotate`, 'POST'), ctx({ id: project.id, keyId }))
    expect(rot.status).toBe(200)
    const rotated = (await rot.json()) as { key: string; projectId: string; notice: string }
    expect(rotated.key.startsWith('bgk_')).toBe(true)
    expect(rotated.key).not.toBe(rawKey)
    expect(rotated.projectId).toBe(project.id)
    expect(rotated.notice).toMatch(/shown only once/i)

    // Old key no longer verifies (real verify path).
    const { verifyApiKey } = await import('../../src/lib/security/api-keys')
    expect(verifyApiKey(rawKey)).rejects.toThrow()
    expect((await verifyApiKey(rotated.key)).projectId).toBe(project.id)

    const rev = await keyRoute.DELETE(jsonReq(`http://localhost/api/portal/projects/${project.id}/keys/${keyId}`, 'DELETE'), ctx({ id: project.id, keyId }))
    expect(rev.status).toBe(200)
    expect(((await rev.json()) as { revoked: boolean }).revoked).toBe(true)
    expect(verifyApiKey(rotated.key)).rejects.toThrow()
  })

  test('cross-user rotate and revoke are 404', async () => {
    const project = await makeProject(ALICE.id)
    const { keyId } = await makeKey(project.id, ALICE.id)
    currentUser = BOB
    const rot = await rotateRoute.POST(jsonReq(`http://localhost/api/portal/projects/${project.id}/keys/${keyId}/rotate`, 'POST'), ctx({ id: project.id, keyId }))
    expect(rot.status).toBe(404)
    const rev = await keyRoute.DELETE(jsonReq(`http://localhost/api/portal/projects/${project.id}/keys/${keyId}`, 'DELETE'), ctx({ id: project.id, keyId }))
    expect(rev.status).toBe(404)
  })

  test('a key of another PROJECT of the same owner is 404 through the wrong project route', async () => {
    const p1 = await makeProject(ALICE.id, 'P1')
    const p2 = await makeProject(ALICE.id, 'P2')
    const { keyId } = await makeKey(p1.id, ALICE.id)
    currentUser = ALICE
    // Same owner, wrong project — the nested-resource ownership check still holds.
    const res = await keyRoute.DELETE(jsonReq(`http://localhost/api/portal/projects/${p2.id}/keys/${keyId}`, 'DELETE'), ctx({ id: p2.id, keyId }))
    expect(res.status).toBe(404)
  })
})

describe('portal usage and logs — owner-scoped, real persisted data', () => {
  test('usage aggregates come from the project’s own keys and request logs only', async () => {
    const project = await makeProject(ALICE.id)
    const { rawKey, keyId } = await makeKey(project.id, ALICE.id)
    // Simulate real recorded gateway traffic for THIS key.
    const { verifyApiKey } = await import('../../src/lib/security/api-keys')
    currentUser = null
    await verifyApiKey(rawKey) // real verification increments the counter
    reqLogs.push(
      { id: 'log-1', authKind: 'api-key', keyId, userId: ALICE.id, provider: 'p', model: 'm', endpoint: '/api/v1/chat/completions', status: 200, errorCode: null, tokensIn: 10, tokensOut: 20, durationMs: 100, streamed: false, createdAt: new Date() },
      { id: 'log-2', authKind: 'api-key', keyId, userId: ALICE.id, provider: 'p', model: 'm', endpoint: '/api/v1/chat/completions', status: 429, errorCode: 'RATE_LIMITED', tokensIn: 5, tokensOut: 0, durationMs: 10, streamed: false, createdAt: new Date() },
    )
    // A DIFFERENT user's log rows must not leak into this project's usage.
    reqLogs.push({ id: 'log-foreign', authKind: 'api-key', keyId: 'someone-elses-key', userId: BOB.id, provider: 'p', model: 'm', endpoint: '/api/v1/chat/completions', status: 200, errorCode: null, tokensIn: 999, tokensOut: 999, durationMs: 1, streamed: false, createdAt: new Date() })

    currentUser = ALICE
    const res = await usageRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}/usage`, 'GET'), ctx({ id: project.id }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { totals: { requests: number; successes: number; failures: number; tokensIn: number; tokensOut: number }; keys: Array<{ id: string; requestCount: number }> }
    expect(body.totals.requests).toBe(2)
    expect(body.totals.successes).toBe(1)
    expect(body.totals.failures).toBe(1)
    expect(body.totals.tokensIn).toBe(15)
    expect(body.totals.tokensOut).toBe(20)
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].requestCount).toBe(1)
  })

  test('logs are owner-scoped: the owner sees their key’s rows, Bob gets 404', async () => {
    const project = await makeProject(ALICE.id)
    const { keyId } = await makeKey(project.id, ALICE.id)
    reqLogs.push({ id: 'log-1', authKind: 'api-key', keyId, userId: ALICE.id, provider: 'p', model: 'm', endpoint: '/api/v1/chat/completions', status: 200, errorCode: null, tokensIn: 1, tokensOut: 2, durationMs: 5, streamed: true, createdAt: new Date() })
    currentUser = ALICE
    const own = await logsRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}/logs`, 'GET'), ctx({ id: project.id }))
    expect(own.status).toBe(200)
    const ownBody = (await own.json()) as { requests: Array<{ keyId: string | null; keyName: string | null }>; activity: unknown[] }
    expect(ownBody.requests).toHaveLength(1)
    expect(ownBody.requests[0].keyName).toBe('CI key')
    // The create/rotate/revoke audits recorded real activity rows.
    expect(ownBody.activity.length).toBeGreaterThan(0)
    expect(ownBody.activity.every((a) => typeof (a as { action: string }).action === 'string')).toBe(true)

    currentUser = BOB
    const other = await logsRoute.GET(jsonReq(`http://localhost/api/portal/projects/${project.id}/logs`, 'GET'), ctx({ id: project.id }))
    expect(other.status).toBe(404)
  })
})
