/**
 * M50.3 BEAN AI STUDIO — API route contract tests (hermetic; the same
 * controlled-session pattern as the M33 run-route suite).
 *
 * Pins, for every M50.3 endpoint:
 *  - the request/response contract (envelope, status codes);
 *  - auth: unauthenticated → 401; cross-user ids → honest 404 (no
 *    existence leak); NO ownership trust in request bodies (there is no
 *    userId field to even send);
 *  - error mapping: invalid graph → 422, oversized graph → 413, quota →
 *    429 QUOTA_EXCEEDED, conflicts → 409, rate limit → 429 + Retry-After;
 *  - bounds and invalid vocabularies (status filter, page/pageSize, name
 *    length, bad version-number path segments);
 *  - pagination behavior;
 *  - the zero-write census: validate and preview leave EVERY business
 *    table (workflow rows, missions, mission tasks, jobs, trust tasks)
 *    byte-identical;
 *  - malformed graph / malformed JSON handling.
 *
 * Run: bun test tests/unit/m50-3-workflow-routes.test.ts
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controlled session -------------------------------------------------------
interface CtlUser { id: string; email: string; name: string | null; role: 'member' | 'admin' }
const ALICE: CtlUser = { id: 'user-alice', email: 'alice@example.test', name: 'Alice', role: 'member' }
const BOB: CtlUser = { id: 'user-bob', email: 'bob@example.test', name: 'Bob', role: 'member' }
let currentUser: CtlUser | null = ALICE
mock.module('@/lib/auth/session', () => ({
  getSessionUser: async () => currentUser,
  requireUser: async () => {
    const user = currentUser
    if (!user) {
      const { BeanApiError } = await import('@/lib/api/errors')
      throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    }
    return user
  },
}))

// ---- controllable rate limiter --------------------------------------------------
let rateLimited = false
let rateLimitCalls = 0
mock.module('@/lib/auth/ratelimit', () => ({
  checkRateLimit: () => {
    rateLimitCalls += 1
    if (rateLimited) {
      return { allowed: false, retryAfterSec: 42, remaining: 0, resetAtMs: 1_000 }
    }
    return { allowed: true, retryAfterSec: 0, remaining: 10, resetAtMs: null }
  },
  // The routes never use the durable daily-quota layer, but sibling test
  // files in the same process import it — the mock must keep the module's
  // full export surface intact.
  checkDailyQuota: async () => ({ allowed: true, used: 0, limit: 0 }),
  PRODUCT_RATE_LIMITS: {},
  PRODUCT_DAILY_QUOTAS: {},
}))

// ---- in-memory Prisma boundary --------------------------------------------------
interface DefRow {
  id: string; userId: string; name: string; description: string
  status: string; createdAt: Date; updatedAt: Date
}
interface VerRow {
  id: string; definitionId: string; version: number; status: string
  graphJson: string; changeNote: string; publishedAt: Date | null
  createdAt: Date; updatedAt: Date
}
interface RunRow {
  id: string; userId: string; definitionId: string; versionId: string
  missionId: string; objective: string; compiledPlanJson: string
  status: string; failureNote: string | null; createdAt: Date; finishedAt: Date | null
}

const defs = new Map<string, DefRow>()
const vers = new Map<string, VerRow>()
const runs = new Map<string, RunRow>()
const missions = new Map<string, { id: string; userId: string; status: string }>()
const missionTasks = new Map<string, { id: string; missionId: string }>()
const jobs = new Map<string, { id: string; userId: string }>()
const trustTasks = new Map<string, { id: string; userId: string }>()

let seq = 0
const nextId = (p: string) => `${p}-r${++seq}`
const now = () => new Date()

function makeDbFake() {
  return {
    workflowDefinition: {
      async findFirst({ where }: { where: { id?: string; userId?: string } }) {
        return [...defs.values()].find((r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId)) ?? null
      },
      async findMany({ where, orderBy, skip, take }: { where: { userId: string; status?: string }; orderBy?: { updatedAt?: string }; skip?: number; take?: number }) {
        let rows = [...defs.values()].filter((r) => r.userId === where.userId && (!where.status || r.status === where.status))
        if (orderBy?.updatedAt === 'desc') rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length))
      },
      async count({ where }: { where: { userId?: string; status?: string } }) {
        return [...defs.values()].filter((r) => (!where.userId || r.userId === where.userId) && (!where.status || r.status === where.status)).length
      },
      async create({ data }: { data: Partial<DefRow> }) {
        const t = now()
        const r: DefRow = { id: nextId('wf'), userId: 'u', name: '', description: '', status: 'active', createdAt: t, updatedAt: t, ...data }
        defs.set(r.id, r)
        return { ...r }
      },
      async update({ where, data }: { where: { id: string }; data: Partial<DefRow> }) {
        const cur = defs.get(where.id)
        if (!cur) throw new Error('missing')
        const next = { ...cur, ...data, updatedAt: now() }
        defs.set(cur.id, next)
        return { ...next }
      },
      async delete({ where }: { where: { id: string } }) {
        const cur = defs.get(where.id)
        if (!cur) throw new Error('missing')
        defs.delete(where.id)
        for (const [id, v] of [...vers.entries()]) if (v.definitionId === where.id) vers.delete(id)
        return cur
      },
    },
    workflowVersion: {
      async findFirst({ where, orderBy }: { where: { id?: string; definitionId?: string; status?: string; version?: number }; orderBy?: { version?: string } }) {
        let rows = [...vers.values()].filter(
          (r) => (!where.id || r.id === where.id) && (!where.definitionId || r.definitionId === where.definitionId) && (!where.status || r.status === where.status) && (!where.version || r.version === where.version),
        )
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => b.version - a.version)
        return rows[0] ?? null
      },
      async findMany({ where, orderBy, skip, take }: { where: { definitionId: string; status?: string }; orderBy?: { version?: string }; skip?: number; take?: number }) {
        let rows = [...vers.values()].filter((r) => r.definitionId === where.definitionId && (!where.status || r.status === where.status))
        if (orderBy?.version === 'desc') rows = rows.sort((a, b) => b.version - a.version)
        return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length))
      },
      async count({ where }: { where: { definitionId: string; status?: string } }) {
        return [...vers.values()].filter((r) => r.definitionId === where.definitionId && (!where.status || r.status === where.status)).length
      },
      async create({ data }: { data: Partial<VerRow> }) {
        const dupe = [...vers.values()].find((r) => r.definitionId === data.definitionId && r.version === data.version)
        if (dupe) throw new Error('P2002 unique violation')
        const t = now()
        const r: VerRow = { id: nextId('wv'), definitionId: '', version: 1, status: 'draft', graphJson: '{"schemaVersion":1,"nodes":[],"edges":[]}', changeNote: '', publishedAt: null, createdAt: t, updatedAt: t, ...data }
        vers.set(r.id, r)
        return { ...r }
      },
      async update({ where, data }: { where: { id: string }; data: Partial<VerRow> }) {
        const cur = vers.get(where.id)
        if (!cur) throw new Error('missing')
        const next = { ...cur, ...data, updatedAt: now() }
        vers.set(cur.id, next)
        return { ...next }
      },
      async updateMany({ where, data }: { where: { definitionId: string; status?: string }; data: Partial<VerRow> }) {
        let n = 0
        for (const [id, r] of [...vers.entries()]) {
          if (r.definitionId === where.definitionId && (!where.status || r.status === where.status)) {
            vers.set(id, { ...r, ...data, updatedAt: now() })
            n += 1
          }
        }
        return { count: n }
      },
      async aggregate({ where }: { where: { definitionId: string } }) {
        const rows = [...vers.values()].filter((r) => r.definitionId === where.definitionId)
        return { _max: { version: rows.length ? Math.max(...rows.map((r) => r.version)) : null } }
      },
    },
    workflowRun: {
      async count({ where }: { where: { definitionId: string; status?: { in?: string[] } } }) {
        return [...runs.values()].filter((r) => r.definitionId === where.definitionId && (!where.status?.in || where.status.in.includes(r.status))).length
      },
    },
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeDbFake>) => Promise<T>): Promise<T> => fn(makeDbFake()),
  }
}
const dbFake = makeDbFake()
mock.module('@/lib/db', () => ({ db: dbFake }))
const audits: string[] = []
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async (input: { action: string }) => {
    audits.push(input.action)
  },
}))

// REAL route modules (the whole HTTP contract is exercised — no mocks below
// this line except the seams above).
const collection = await import('../../src/app/api/ai-studio/workflows/route')
const item = await import('../../src/app/api/ai-studio/workflows/[id]/route')
const duplicate = await import('../../src/app/api/ai-studio/workflows/[id]/duplicate/route')
const versionsCol = await import('../../src/app/api/ai-studio/workflows/[id]/versions/route')
const versionItem = await import('../../src/app/api/ai-studio/workflows/[id]/versions/[version]/route')
const validateRoute = await import('../../src/app/api/ai-studio/workflows/[id]/versions/[version]/validate/route')
const previewRoute = await import('../../src/app/api/ai-studio/workflows/[id]/versions/[version]/preview/route')
const publishRoute = await import('../../src/app/api/ai-studio/workflows/[id]/versions/[version]/publish/route')

// ---- helpers -------------------------------------------------------------------

function jsonRequest(path: string, method: string, body?: unknown): Request {
  const url = path.startsWith('http') ? path : `http://localhost${path.startsWith('/') ? path : `/${path}`}`
  return new Request(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

function ctx(id: string, version?: string): { params: Promise<{ id: string; version?: string }> } {
  return { params: Promise.resolve(version ? { id, version } : { id }) }
}

function linearGraph(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    nodes: [
      { nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'coffee history' } },
      { nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write the report', deliverablePath: 'report.md' } },
      { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [
      { edgeId: 'e1', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } },
      { edgeId: 'e2', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } },
    ],
  }
}

async function createWorkflowFor(userId: string, name: string, graph?: Record<string, unknown>): Promise<string> {
  currentUser = userId === 'user-alice' ? ALICE : BOB
  const res = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name, ...(graph ? { graph } : {}) }))
  expect(res.status).toBe(201)
  const body = await res.json() as { workflow: { id: string } }
  return body.workflow.id
}

beforeEach(() => {
  defs.clear(); vers.clear(); runs.clear()
  missions.clear(); missionTasks.clear(); jobs.clear(); trustTasks.clear()
  audits.length = 0
  currentUser = ALICE
  rateLimited = false
  rateLimitCalls = 0
})

// ---------------------------------------------------------------------------

describe('M50.3 routes — collection contract (GET/POST)', () => {
  test('POST creates a workflow + draft v1 (201 envelope)', async () => {
    const res = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name: 'My first workflow', graph: linearGraph() }))
    expect(res.status).toBe(201)
    const body = await res.json() as { ok: boolean; workflow: { name: string; versionSummary: { total: number; draftVersion: number } } }
    expect(body.ok).toBe(true)
    expect(body.workflow.name).toBe('My first workflow')
    expect(body.workflow.versionSummary.draftVersion).toBe(1)
    expect(audits).toContain('ai-studio.workflow_create')
  })

  test('POST without a graph creates the documented blank draft', async () => {
    const res = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name: 'Blank' }))
    expect(res.status).toBe(201)
  })

  test('GET lists only the caller\u2019s workflows with pagination params', async () => {
    for (let i = 0; i < 3; i++) await createWorkflowFor('user-alice', `wf-${i}`)
    await createWorkflowFor('user-bob', 'bobs')
    currentUser = ALICE
    const res = await collection.GET(jsonRequest('/api/ai-studio/workflows?page=1&pageSize=2', 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; items: unknown[]; page: number; pageSize: number; total: number }
    expect(body.items).toHaveLength(2)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(2)
    expect(body.total).toBe(3)
    const filtered = await (collection.GET(jsonRequest('http://localhost/api/ai-studio/workflows?status=archived', 'GET'))).then((r) => r.json()) as { total: number }
    expect(filtered.total).toBe(0)
  })

  test('unauthenticated requests are 401; invalid bodies are 400; oversized names are rejected', async () => {
    currentUser = null
    const res = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name: 'x' }))
    expect(res.status).toBe(401)
    currentUser = ALICE
    const badJson = await collection.POST(new Request('http://localhost/api/ai-studio/workflows', { method: 'POST', body: 'not json{', headers: { 'content-type': 'application/json' } }))
    expect(badJson.status).toBe(400)
    const longName = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name: 'x'.repeat(81) }))
    expect(longName.status).toBe(400)
    // Ownership can never come from the body: there is no userId field at
    // all — sending one is ignored (zod strips unknown keys).
    const sneaky = await collection.POST(jsonRequest('http://localhost/api/ai-studio/workflows', 'POST', { name: 'Sneaky', userId: 'user-bob' }))
    expect(sneaky.status).toBe(201)
    const body = await sneaky.json() as { workflow: { id: string } }
    expect(defs.get(body.workflow.id)?.userId).toBe('user-alice')
  })
})

describe('M50.3 routes — item contract (GET/PATCH/DELETE) and duplicate', () => {
  test('GET one workflow; a foreign id is an honest 404', async () => {
    const id = await createWorkflowFor('user-alice', 'Alice flow')
    const ok = await item.GET(jsonRequest('x', 'GET'), ctx(id))
    expect(ok.status).toBe(200)
    const foreign = await item.GET(jsonRequest('x', 'GET'), { params: Promise.resolve({ id }) as Promise<{ id: string }> })
    expect(foreign.status).toBe(200)
    currentUser = BOB
    const res = await item.GET(jsonRequest('x', 'GET'), ctx(id))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('PATCH renames/describes/archives/restores; arbitrary statuses are rejected', async () => {
    const id = await createWorkflowFor('user-alice', 'Rename me')
    const res = await item.PATCH(jsonRequest('x', 'PATCH', { name: 'Renamed', description: 'now with a description' }), ctx(id))
    expect(res.status).toBe(200)
    const body = await res.json() as { workflow: { name: string; description: string } }
    expect(body.workflow.name).toBe('Renamed')
    const archived = await item.PATCH(jsonRequest('x', 'PATCH', { status: 'archived' }), ctx(id))
    expect((await archived.json() as { workflow: { status: string } }).workflow.status).toBe('archived')
    await item.PATCH(jsonRequest('x', 'PATCH', { status: 'active' }), ctx(id))
    const arbitrary = await item.PATCH(jsonRequest('x', 'PATCH', { status: 'deleted' }), ctx(id))
    expect(arbitrary.status).toBe(400)
  })

  test('DELETE is allowed with no history and refused (409) once runs exist', async () => {
    const id = await createWorkflowFor('user-alice', 'Doomed')
    const ok = await item.DELETE(jsonRequest('x', 'DELETE'), ctx(id))
    expect(ok.status).toBe(200)
    const fresh = await createWorkflowFor('user-alice', 'With history')
    runs.set('wr-1', { id: 'wr-1', userId: 'user-alice', definitionId: fresh, versionId: [...vers.values()][0]!.id, missionId: 'm-1', objective: 'x', compiledPlanJson: '{}', status: 'completed', failureNote: null, createdAt: now(), finishedAt: now() })
    const refused = await item.DELETE(jsonRequest('x', 'DELETE'), ctx(fresh))
    expect(refused.status).toBe(409)
    const body = await refused.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('EDIT_CONFLICT')
    expect(body.error.message).toContain('Archive')
    expect(defs.has(fresh)).toBe(true)
  })

  test('duplicate copies into a NEW workflow without history; cross-user → 404', async () => {
    const id = await createWorkflowFor('user-alice', 'Original', linearGraph())
    const res = await duplicate.POST(jsonRequest('http://localhost/x/duplicate', 'POST'), ctx(id))
    expect(res.status).toBe(201)
    const body = await res.json() as { workflow: { id: string; name: string; runCount: number; versionSummary: { total: number } } }
    expect(body.workflow.name).toContain('(copy)')
    expect(body.workflow.runCount).toBe(0)
    expect(body.workflow.versionSummary.total).toBe(1)
    currentUser = BOB
    const sneaky = await duplicate.POST(jsonRequest('http://localhost/x/duplicate', 'POST'), ctx(id))
    expect(sneaky.status).toBe(404)
  })
})

describe('M50.3 routes — versions contract', () => {
  test('POST versions enforces the one-draft policy (409) and monotonic numbering after publish', async () => {
    const id = await createWorkflowFor('user-alice', 'Versioned', linearGraph())
    const second = await versionsCol.POST(jsonRequest('x', 'POST', { changeNote: 'too soon' }), ctx(id))
    expect(second.status).toBe(409)
    const pub = await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(pub.status).toBe(200)
    const v2 = await versionsCol.POST(jsonRequest('/x', 'POST', { changeNote: 'next round' }), ctx(id))
    expect(v2.status).toBe(201)
    const body = await v2.json() as { version: { version: number; status: string } }
    expect(body.version.version).toBe(2)
    expect(body.version.status).toBe('draft')
  })

  test('GET versions list is bounded pagination without graph payloads', async () => {
    const id = await createWorkflowFor('user-alice', 'History', linearGraph())
    await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    await versionsCol.POST(jsonRequest('x', 'POST', {}), ctx(id))
    await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '2'))
    const res = await versionsCol.GET(jsonRequest('http://localhost/x/versions?page=1&pageSize=1', 'GET'), ctx(id))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ graphJson?: string; version: number }>; total: number }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.graphJson).toBeUndefined()
    expect(body.total).toBe(2)
  })

  test('single version read returns the graph; invalid version segments are 404', async () => {
    const id = await createWorkflowFor('user-alice', 'Loadable', linearGraph())
    const res = await versionItem.GET(jsonRequest('x', 'GET'), ctx(id, '1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { version: { graphJson: string; version: number } }
    expect(body.version.version).toBe(1)
    expect(JSON.parse(body.version.graphJson)).toEqual(linearGraph())
    const bad = await versionItem.GET(jsonRequest('x', 'GET'), ctx(id, 'banana'))
    expect(bad.status).toBe(404)
    const missing = await versionItem.GET(jsonRequest('x', 'GET'), ctx(id, '9'))
    expect(missing.status).toBe(404)
  })

  test('PATCH version edits a draft (422 malformed graph / 413 oversized) and refuses published (409)', async () => {
    const id = await createWorkflowFor('user-alice', 'Editable', linearGraph())
    // Draft edit works and returns the updated summary.
    const edit = await versionItem.PATCH(jsonRequest('/x', 'PATCH', { changeNote: 'still drafting', graph: linearGraph() }), ctx(id, '1'))
    expect(edit.status).toBe(200)
    const editBody = await edit.json() as { version: { changeNote: string; status: string } }
    expect(editBody.version.changeNote).toBe('still drafting')
    expect(editBody.version.status).toBe('draft')
    // A malformed replacement graph is refused (422) — nothing stored.
    const malformed = await versionItem.PATCH(jsonRequest('/x', 'PATCH', { graph: { nonsense: true } }), ctx(id, '1'))
    expect(malformed.status).toBe(422)
    // An oversized replacement graph is refused (413).
    const big = await versionItem.PATCH(jsonRequest('/x', 'PATCH', { graph: { schemaVersion: 1, nodes: [{ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'x'.repeat(70_000) } }], edges: [] } }), ctx(id, '1'))
    expect(big.status).toBe(413)
    // After publication the draft is frozen: edits are 409 and bytes survive.
    await publishRoute.POST(jsonRequest('/x', 'POST'), ctx(id, '1'))
    const frozen = await versionItem.PATCH(jsonRequest('/x', 'PATCH', { changeNote: 'hijack' }), ctx(id, '1'))
    expect(frozen.status).toBe(409)
    const fresh = await versionItem.GET(jsonRequest('/x', 'GET'), ctx(id, '1'))
    const freshBody = await fresh.json() as { version: { changeNote: string } }
    expect(freshBody.version.changeNote).toBe('still drafting')
  })
})

describe('M50.3 routes — validate and preview (read-only, zero-write census)', () => {
  test('validate returns structured validity + diagnostics over 200; zero rows written', async () => {
    const id = await createWorkflowFor('user-alice', 'Validated', linearGraph())
    const censusBefore = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    const snapshotBefore = JSON.stringify([...defs.values(), ...vers.values(), ...runs.values(), ...missions.values(), ...missionTasks.values(), ...jobs.values(), ...trustTasks.values()])
    const res = await validateRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; valid: boolean; diagnostics: unknown[]; status: string }
    expect(body.ok).toBe(true)
    expect(body.valid).toBe(true)
    expect(body.diagnostics).toEqual([])
    const censusAfter = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    expect(censusAfter).toEqual(censusBefore)
    expect(JSON.stringify([...defs.values(), ...vers.values(), ...runs.values(), ...missions.values(), ...missionTasks.values(), ...jobs.values(), ...trustTasks.values()])).toBe(snapshotBefore)
  })

  test('an invalid draft validates to valid:false (still 200) with error diagnostics', async () => {
    const id = await createWorkflowFor('user-alice', 'Broken draft')
    const res = await validateRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { valid: boolean; diagnostics: Array<{ severity: string }> }
    expect(body.valid).toBe(false)
    expect(body.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(runs.size).toBe(0)
    expect(missions.size).toBe(0)
  })

  test('preview compiles the real plan with the auto-appended QUALITY gate; zero writes', async () => {
    const id = await createWorkflowFor('user-alice', 'Previewed', linearGraph())
    const censusBefore = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    const res = await previewRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; compiled: { ok: boolean; tasks: Array<{ kind: string }>; gateAutoAppended: boolean; deliverableTaskId: string; gateTaskId: string } }
    expect(body.ok).toBe(true)
    expect(body.compiled.ok).toBe(true)
    expect(body.compiled.tasks.map((t) => t.kind)).toEqual(['research', 'document-draft', 'verify-deliverable'])
    expect(body.compiled.gateAutoAppended).toBe(true)
    expect(body.compiled.deliverableTaskId).not.toBe(body.compiled.gateTaskId)
    const censusAfter = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    expect(censusAfter).toEqual(censusBefore)
    expect(runs.size).toBe(0)
    expect(missions.size).toBe(0)
    expect(jobs.size).toBe(0)
    expect(trustTasks.size).toBe(0)
  })

  test('a preview over an uncompilable draft is 200 with compiled.ok:false', async () => {
    const id = await createWorkflowFor('user-alice', 'Not compilable')
    const res = await previewRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { compiled: { ok: boolean; diagnostics: Array<{ code: string }> } }
    expect(body.compiled.ok).toBe(false)
    expect(body.compiled.diagnostics.length).toBeGreaterThan(0)
  })

  test('cross-user validate/preview/publish are 404; unauthenticated is 401', async () => {
    const id = await createWorkflowFor('user-alice', 'Mine')
    currentUser = BOB
    expect((await validateRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))).status).toBe(404)
    expect((await previewRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))).status).toBe(404)
    expect((await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))).status).toBe(404)
    currentUser = null
    expect((await validateRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))).status).toBe(401)
    expect((await previewRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))).status).toBe(401)
  })

  test('the browser cannot submit a trusted availability claim (request fields are ignored)', async () => {
    const id = await createWorkflowFor('user-alice', 'No trust')
    // An "availability" field in the body is just an ignored unknown key.
    const res = await validateRoute.POST(
      jsonRequest('x', 'POST', { availability: { riishe: 'available', laxii: 'available', jazmii: 'available', 'code-giftz': 'available', gangzii: 'available' } }),
      ctx(id, '1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { valid: boolean }
    // The blank draft is invalid for STRUCTURAL reasons only — no claimed
    // availability could have influenced the outcome.
    expect(body.valid).toBe(false)
  })
})

describe('M50.3 routes — publish, quota and rate-limit mapping', () => {
  test('publish freezes the draft and supersedes the previous published version', async () => {
    const id = await createWorkflowFor('user-alice', 'Publishable', linearGraph())
    await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    await versionsCol.POST(jsonRequest('x', 'POST', {}), ctx(id))
    const res = await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '2'))
    expect(res.status).toBe(200)
    const body = await res.json() as { published: { version: number; supersededVersion: number | null; status: string } }
    expect(body.published.version).toBe(2)
    expect(body.published.supersededVersion).toBe(1)
    expect(body.published.status).toBe('published')
    expect(audits.filter((a) => a === 'ai-studio.version_publish')).toHaveLength(2)
  })

  test('publishing an invalid draft maps to 422', async () => {
    const id = await createWorkflowFor('user-alice', 'Invalid')
    const res = await publishRoute.POST(jsonRequest('x', 'POST'), ctx(id, '1'))
    expect(res.status).toBe(422)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('UNSUPPORTED_CONTENT')
  })

  test('quota exhaustion maps to 429 QUOTA_EXCEEDED', async () => {
    const limit = (await import('../../src/lib/ai-studio/workflow-service')).WORKFLOW_SERVICE_LIMITS.maxDefinitionsPerOwner
    for (let i = 0; i < limit; i++) {
      const res = await collection.POST(jsonRequest('http://localhost/x', 'POST', { name: `wf-${i}` }))
      expect(res.status).toBe(201)
    }
    const over = await collection.POST(jsonRequest('http://localhost/x', 'POST', { name: 'one too many' }))
    expect(over.status).toBe(429)
    const body = await over.json() as { error: { code: string } }
    expect(body.error.code).toBe('QUOTA_EXCEEDED')
  })

  test('rate limiting maps to 429 with a truthful Retry-After header', async () => {
    rateLimited = true
    const res = await collection.POST(jsonRequest('http://localhost/x', 'POST', { name: 'throttled' }))
    expect(res.status).toBe(429)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBe('42')
    rateLimited = false
  })
})
