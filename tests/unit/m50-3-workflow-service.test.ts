/**
 * M50.3 BEAN AI STUDIO — workflow service tests (hermetic, fake Prisma
 * boundary; same discipline as the M49.2 team-service suite).
 *
 * Pins:
 *  - create definition + draft v1 (blank placeholder or strict-validated
 *    initial graph);
 *  - owner-scoped reads/mutations everywhere — a foreign id is an honest
 *    NOT_FOUND with no existence leak, and ownership can never come from a
 *    caller;
 *  - unique monotonic version numbering (max+1 inside the transaction, the
 *    (definitionId, version) UNIQUE constraint as the race backstop → 409);
 *  - the one-draft policy (a second concurrent draft conflicts with 409);
 *  - draft graphs are editable; PUBLISHED and SUPERSEDED graphs are
 *    immutable forever (409);
 *  - publish: validation gate (invalid draft refused), atomic
 *    publish + supersede of the previous published version;
 *  - duplicate copies the definition + latest graph but NEVER run/version
 *    history;
 *  - archive/restore (archive refuses while a run is ACTIVE);
 *  - the 50-definitions-per-owner quota (archived definitions COUNT);
 *  - safe delete with zero runs; delete REFUSED with historical run rows
 *    (409, archiving offered) — mission history is never touched;
 *  - transaction atomicity: a mid-transaction failure leaves NO partial
 *    rows;
 *  - validate/preview are strictly read-only (row census pinned before and
 *    after).
 *
 * Run: bun test tests/unit/m50-3-workflow-service.test.ts
 */
import { mock, describe, test, expect, beforeEach } from 'bun:test'
import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Fake Prisma boundary (definitions / versions / runs + census tables)
// ---------------------------------------------------------------------------

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
// Census tables — the validate/preview zero-write contract demands these
// stay EMPTY and untouched through every read-only path.
const missions = new Map<string, { id: string; userId: string; status: string }>()
const missionTasks = new Map<string, { id: string; missionId: string }>()
const jobs = new Map<string, { id: string; userId: string }>()
const trustTasks = new Map<string, { id: string; userId: string }>()

let seq = 0
const nextId = (p: string) => `${p}-${++seq}`
const now = () => new Date()

function defRow(partial: Partial<DefRow>): DefRow {
  const t = now()
  return { id: nextId('wf'), userId: 'u1', name: 'My workflow', description: '', status: 'active', createdAt: t, updatedAt: t, ...partial }
}
function verRow(partial: Partial<VerRow>): VerRow {
  const t = now()
  return { id: nextId('wv'), definitionId: '', version: 1, status: 'draft', graphJson: '{"schemaVersion":1,"nodes":[],"edges":[]}', changeNote: '', publishedAt: null, createdAt: t, updatedAt: t, ...partial }
}

/** Failures injected into fake create/update calls (rollback testing). */
let failNextVersionCreate: Error | null = null
let failNextVersionUpdate: Error | null = null
/** Simulates the race: another request commits max+1 between the in-tx
 *  aggregate and the create — the UNIQUE constraint then fires. */
let raceInsertOnAggregate: string | null = null

function uniqueViolation(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.2-test',
  })
}

const dbFake = {
  workflowDefinition: {
    async findFirst({ where }: { where: { id?: string; userId?: string; status?: string } }) {
      const rows = [...defs.values()].filter(
        (r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId) && (!where.status || r.status === where.status),
      )
      return rows[0] ?? null
    },
    async findMany({ where, orderBy, skip, take }: { where: { userId: string; status?: string }; orderBy?: { updatedAt?: string }; skip?: number; take?: number }) {
      let rows = [...defs.values()].filter((r) => r.userId === where.userId && (!where.status || r.status === where.status))
      if (orderBy?.updatedAt === 'desc') rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length))
    },
    async count({ where }: { where: { userId?: string; status?: string; id?: string } }) {
      return [...defs.values()].filter(
        (r) => (!where.userId || r.userId === where.userId) && (!where.status || r.status === where.status) && (!where.id || r.id === where.id),
      ).length
    },
    async create({ data }: { data: Partial<DefRow> }) {
      const r = defRow(data)
      defs.set(r.id, r)
      return { ...r }
    },
    async update({ where, data }: { where: { id: string }; data: Partial<DefRow> }) {
      const cur = defs.get(where.id)
      if (!cur) throw new Error('definition missing')
      const next = { ...cur, ...data, updatedAt: now() }
      defs.set(cur.id, next)
      return { ...next }
    },
    async delete({ where }: { where: { id: string } }) {
      const cur = defs.get(where.id)
      if (!cur) throw new Error('definition missing')
      defs.delete(where.id)
      // the application's cascade paths (versions; runs would be protected
      // by the service — fixtures here never reach a cascade with runs)
      for (const [id, v] of [...vers.entries()]) if (v.definitionId === where.id) vers.delete(id)
      for (const [id, r] of [...runs.entries()]) if (r.definitionId === where.id) runs.delete(id)
      return cur
    },
  },
  workflowVersion: {
    async findFirst({ where, orderBy }: { where: { id?: string; definitionId?: string; status?: string; version?: number }; orderBy?: { version?: string } }) {
      let rows = [...vers.values()].filter(
        (r) =>
          (!where.id || r.id === where.id) &&
          (!where.definitionId || r.definitionId === where.definitionId) &&
          (!where.status || r.status === where.status) &&
          (!where.version || r.version === where.version),
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
      if (failNextVersionCreate) {
        const e = failNextVersionCreate
        failNextVersionCreate = null
        throw e
      }
      const dupe = [...vers.values()].find((r) => r.definitionId === data.definitionId && r.version === data.version)
      if (dupe) throw uniqueViolation()
      const r = verRow(data)
      vers.set(r.id, r)
      return { ...r }
    },
    async update({ where, data }: { where: { id: string }; data: Partial<VerRow> }) {
      if (failNextVersionUpdate) {
        const e = failNextVersionUpdate
        failNextVersionUpdate = null
        throw e
      }
      const cur = vers.get(where.id)
      if (!cur) throw new Error('version missing')
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
    async aggregate({ _max, where }: { _max: { version: boolean }; where: { definitionId: string } }) {
      const rows = [...vers.values()].filter((r) => r.definitionId === where.definitionId)
      const max = rows.length ? Math.max(...rows.map((r) => r.version)) : null
      if (raceInsertOnAggregate && raceInsertOnAggregate === where.definitionId) {
        // The "concurrent" row lands right after the aggregate read; the
        // aggregate still reports the OLD max, so the service allocates
        // max+1 and the UNIQUE constraint fires.
        vers.set('race-row', verRow({ definitionId: where.definitionId, version: (max ?? 0) + 1, status: 'published', publishedAt: now() }))
        raceInsertOnAggregate = null
      }
      return { _max: { version: max } }
    },
  },
  workflowRun: {
    async count({ where }: { where: { definitionId: string; status?: { in?: string[] } } }) {
      return [...runs.values()].filter(
        (r) =>
          r.definitionId === where.definitionId &&
          (!where.status?.in || where.status.in.includes(r.status)),
      ).length
    },
    async findMany({ where }: { where: { definitionId: string } }) {
      return [...runs.values()].filter((r) => r.definitionId === where.definitionId)
    },
    /** Fixture-only insert (M50.3 never creates runs through the service). */
    async create({ data }: { data: Partial<RunRow> }) {
      const t = now()
      const r: RunRow = {
        id: nextId('wr'), userId: 'u1', definitionId: '', versionId: '', missionId: `m-${++seq}`,
        objective: 'test', compiledPlanJson: '{}', status: 'completed', failureNote: null,
        createdAt: t, finishedAt: t, ...data,
      }
      runs.set(r.id, r)
      return r
    },
  },
  $transaction: async <T>(fn: (tx: typeof dbFake) => Promise<T>): Promise<T> => {
    // Atomicity model: snapshot everything; a thrown error restores the
    // snapshot (nothing partial survives).
    const dSnap = new Map(defs)
    const vSnap = new Map(vers)
    const rSnap = new Map(runs)
    try {
      return await fn(dbFake)
    } catch (e) {
      defs.clear(); dSnap.forEach((v, k) => defs.set(k, v))
      vers.clear(); vSnap.forEach((v, k) => vers.set(k, v))
      runs.clear(); rSnap.forEach((v, k) => runs.set(k, v))
      throw e
    }
  },
}

mock.module('@/lib/db', () => ({ db: dbFake }))
const audits: Array<{ action: string; target: string | null }> = []
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async (input: { actorId: string; action: string; target?: string | null; meta?: Record<string, unknown> }) => {
    audits.push({ action: input.action, target: input.target ?? null })
  },
}))
mock.module('@/lib/auth/ratelimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSec: 0, remaining: 10, resetAtMs: null }),
}))

const { createWorkflowDefinition, getWorkflowDefinition, listWorkflowDefinitions, updateWorkflowDefinition, deleteWorkflowDefinition, duplicateWorkflowDefinition, listWorkflowVersions, createWorkflowVersion, updateWorkflowVersion, validateWorkflowVersion, previewWorkflowVersion, publishWorkflowVersion, getWorkflowVersion, WORKFLOW_SERVICE_LIMITS, EMPTY_EDITOR_GRAPH_JSON } = await import('../../src/lib/ai-studio/workflow-service')
const { BeanApiError } = await import('@/lib/api/errors')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function linearGraphJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    nodes: [
      { nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'sustainable coffee farming' } },
      { nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write the report', deliverablePath: 'report.md' } },
      { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [
      { edgeId: 'e1', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } },
      { edgeId: 'e2', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } },
    ],
  })
}

function blankGraphJson(): string {
  return JSON.stringify({ schemaVersion: 1, nodes: [], edges: [] })
}

function invalidGraphJson(): string {
  return JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], extra: true })
}

async function createSampleWorkflow(userId = 'u1'): Promise<{ definitionId: string }> {
  const view = await createWorkflowDefinition(userId, { name: 'Coffee report', graphJson: linearGraphJson() })
  return { definitionId: view.id }
}

function statusOf(e: unknown): string | undefined {
  return e instanceof BeanApiError ? e.code : undefined
}

/** Fixture-only insert (M50.3 never creates runs through the service). */
async function fixtureRun(partial: Partial<RunRow>): Promise<RunRow> {
  return dbFake.workflowRun.create({ data: partial })
}

beforeEach(() => {
  defs.clear(); vers.clear(); runs.clear()
  missions.clear(); missionTasks.clear(); jobs.clear(); trustTasks.clear()
  audits.length = 0
  failNextVersionCreate = null
  failNextVersionUpdate = null
  raceInsertOnAggregate = null
})

// ---------------------------------------------------------------------------

describe('M50.3 service — creation and draft v1', () => {
  test('create makes a definition plus draft v1 with the strict-validated graph', async () => {
    const { definitionId } = await createSampleWorkflow()
    const view = await getWorkflowDefinition('u1', definitionId)
    expect(view.name).toBe('Coffee report')
    expect(view.status).toBe('active')
    expect(view.versionSummary.total).toBe(1)
    expect(view.versionSummary.draftVersion).toBe(1)
    const v1 = await getWorkflowVersion('u1', definitionId, '1')
    expect(v1.status).toBe('draft')
    // stored graph is CANONICAL: the parsed shape, not the submitted bytes
    const stored = JSON.parse(v1.graphJson)
    expect(Object.keys(stored).sort()).toEqual(['edges', 'nodes', 'schemaVersion'])
    expect(audits.some((a) => a.action === 'ai-studio.workflow_create')).toBe(true)
  })

  test('a blank draft uses the documented empty-editor placeholder', async () => {
    const view = await createWorkflowDefinition('u1', { name: 'Blank' })
    const v1 = await getWorkflowVersion('u1', view.id, '1')
    expect(v1.graphJson).toBe(EMPTY_EDITOR_GRAPH_JSON)
  })

  test('an initial graph that fails the strict schema is refused (nothing stored)', async () => {
    await expect(createWorkflowDefinition('u1', { name: 'Bad', graphJson: invalidGraphJson() })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(defs.size).toBe(0)
    expect(vers.size).toBe(0)
  })

  test('bounds: name/description/changeNote are re-validated server-side', async () => {
    await expect(createWorkflowDefinition('u1', { name: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(createWorkflowDefinition('u1', { name: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(createWorkflowDefinition('u1', { name: 'ok', description: 'x'.repeat(601) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('M50.3 service — owner scoping', () => {
  test('list is owner-scoped and paginated', async () => {
    await createSampleWorkflow('u1')
    await createWorkflowDefinition('u2', { name: 'Not yours' })
    const mine = await listWorkflowDefinitions('u1')
    expect(mine.total).toBe(1)
    expect(mine.items[0]?.name).toBe('Coffee report')
    const theirs = await listWorkflowDefinitions('u2')
    expect(theirs.total).toBe(1)
    expect(theirs.items[0]?.name).toBe('Not yours')
  })

  test('foreign definition/version ids are honest 404s (no existence leak)', async () => {
    const { definitionId } = await createSampleWorkflow('u1')
    await expect(getWorkflowDefinition('u2', definitionId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getWorkflowVersion('u2', definitionId, '1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateWorkflowVersion('u2', definitionId, '1', { changeNote: 'hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(publishWorkflowVersion('u2', definitionId, '1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('ownership is derived from the session, never accepted from a caller', async () => {
    const { definitionId } = await createSampleWorkflow('u1')
    // Even a "helpful" update that names another user's row cannot cross:
    // there is no parameter to do so (the service signature has no userId-in).
    await updateWorkflowDefinition('u1', definitionId, { name: 'Renamed' })
    const u2View = getWorkflowDefinition('u2', definitionId)
    await expect(u2View).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('M50.3 service — version lifecycle and immutability', () => {
  test('versions are monotonic; publishing a new draft supersedes the previous published version atomically', async () => {
    const { definitionId } = await createSampleWorkflow()
    const v1 = await publishWorkflowVersion('u1', definitionId, '1')
    expect(v1.status).toBe('published')
    expect(v1.supersededVersion).toBeNull()

    const v2 = await createWorkflowVersion('u1', definitionId, { changeNote: 'tighten sources' })
    expect(v2.version).toBe(2)
    expect(v2.status).toBe('draft')
    const p2 = await publishWorkflowVersion('u1', definitionId, '2')
    expect(p2.supersededVersion).toBe(1)

    const versions = await listWorkflowVersions('u1', definitionId)
    const byNumber = new Map(versions.items.map((v) => [v.version, v]))
    expect(byNumber.get(1)?.status).toBe('superseded')
    expect(byNumber.get(2)?.status).toBe('published')
  })

  test('drafts are editable; published and superseded versions are immutable (409)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await updateWorkflowVersion('u1', definitionId, '1', { changeNote: 'still drafting' })
    expect((await getWorkflowVersion('u1', definitionId, '1')).changeNote).toBe('still drafting')

    await publishWorkflowVersion('u1', definitionId, '1')
    await expect(updateWorkflowVersion('u1', definitionId, '1', { changeNote: 'hijack' })).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
    await expect(updateWorkflowVersion('u1', definitionId, '1', { graphJson: blankGraphJson() })).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
    // The published graph bytes are untouched.
    const still = await getWorkflowVersion('u1', definitionId, '1')
    expect(JSON.parse(still.graphJson)).toEqual(JSON.parse(linearGraphJson()))

    const v2 = await createWorkflowVersion('u1', definitionId, {})
    await publishWorkflowVersion('u1', definitionId, '2')
    await expect(updateWorkflowVersion('u1', definitionId, '1', { changeNote: 'x' })).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
    expect(v2.version).toBe(2)
  })

  test('one-draft policy: a second draft conflicts with the existing one (409)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await expect(createWorkflowVersion('u1', definitionId, {})).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
  })

  test('concurrent version creation cannot allocate the same number (unique backstop → 409)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    // Simulate the race: another request commits version 2 between the
    // in-transaction aggregate and the create — the UNIQUE constraint
    // fires and the service maps it to an honest 409.
    raceInsertOnAggregate = definitionId
    await expect(createWorkflowVersion('u1', definitionId, { changeNote: 'racing' })).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
  })

  test('publish refuses an invalid draft (422) and an archived workflow (409)', async () => {
    const bad = await createWorkflowDefinition('u1', { name: 'Broken', graphJson: blankGraphJson() })
    await expect(publishWorkflowVersion('u1', bad.id, '1')).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect((await getWorkflowVersion('u1', bad.id, '1')).status).toBe('draft')

    const good = await createSampleWorkflow()
    await updateWorkflowDefinition('u1', good.definitionId, { status: 'archived' })
    await expect(publishWorkflowVersion('u1', good.definitionId, '1')).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
  })

  test('publishing an already-published or superseded version conflicts (409)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    await expect(publishWorkflowVersion('u1', definitionId, '1')).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
    const v2 = await createWorkflowVersion('u1', definitionId, {})
    await publishWorkflowVersion('u1', definitionId, String(v2.version))
    await expect(publishWorkflowVersion('u1', definitionId, '1')).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
  })

  test('a new draft branches from the latest published graph (or an explicit source)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    const v2 = await createWorkflowVersion('u1', definitionId, { graphJson: linearGraphJson().replace('sustainable coffee farming', 'shade-grown coffee') })
    expect(v2.version).toBe(2)
    // The draft must be published before ANOTHER draft can open (one-draft
    // policy), then the explicit-source branch starts from version 1's graph.
    await publishWorkflowVersion('u1', definitionId, '2')
    const explicit = await createWorkflowVersion('u1', definitionId, { sourceVersion: 1 })
    expect(explicit.version).toBe(3)
    expect(JSON.parse((await getWorkflowVersion('u1', definitionId, '3')).graphJson)).toEqual(JSON.parse(linearGraphJson()))
  })

  test('stored graphs cannot exceed the 65,536-character bound (413)', async () => {
    const big = JSON.stringify({ schemaVersion: 1, nodes: [{ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'x'.repeat(70_000) } }], edges: [] })
    await expect(createWorkflowDefinition('u1', { name: 'Big', graphJson: big })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
  })
})

describe('M50.3 service — duplicate, archive/restore, quota, deletion', () => {
  test('duplicate copies definition + latest graph but NO run/version history', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    await fixtureRun({ userId: 'u1', definitionId, versionId: vers.values().next().value!.id, status: 'completed' })
    const copy = await duplicateWorkflowDefinition('u1', definitionId)
    expect(copy.id).not.toBe(definitionId)
    expect(copy.name.endsWith('(copy)')).toBe(true)
    expect(copy.runCount).toBe(0)
    expect(copy.versionSummary.total).toBe(1)
    expect(copy.versionSummary.draftVersion).toBe(1)
    const copyGraph = await getWorkflowVersion('u1', copy.id, '1')
    expect(JSON.parse(copyGraph.graphJson)).toEqual(JSON.parse(linearGraphJson()))
  })

  test('archive/restore works; archive refuses while a run is ACTIVE', async () => {
    const { definitionId } = await createSampleWorkflow()
    const archived = await updateWorkflowDefinition('u1', definitionId, { status: 'archived' })
    expect(archived.status).toBe('archived')
    const restored = await updateWorkflowDefinition('u1', definitionId, { status: 'active' })
    expect(restored.status).toBe('active')

    const active = await createSampleWorkflow()
    await fixtureRun({ userId: 'u1', definitionId: active.definitionId, versionId: vers.values().next().value!.id, status: 'running' })
    await expect(updateWorkflowDefinition('u1', active.definitionId, { status: 'archived' })).rejects.toMatchObject({ code: 'EDIT_CONFLICT' })
  })

  test('the 50-definition quota counts ARCHIVED definitions (archive cannot bypass it)', async () => {
    for (let i = 0; i < WORKFLOW_SERVICE_LIMITS.maxDefinitionsPerOwner; i++) {
      await createWorkflowDefinition('u1', { name: `wf-${i}` })
    }
    expect(defs.size).toBe(WORKFLOW_SERVICE_LIMITS.maxDefinitionsPerOwner)
    await expect(createWorkflowDefinition('u1', { name: 'over' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    // Archive everything — the cap still holds.
    for (const id of [...defs.keys()]) await updateWorkflowDefinition('u1', id, { status: 'archived' })
    await expect(createWorkflowDefinition('u1', { name: 'still-over' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    // Another owner is unaffected.
    await createWorkflowDefinition('u2', { name: 'fine' })
    // Deleting one frees exactly one slot.
    const first = [...defs.values()].find((d) => d.userId === 'u1')!
    await deleteWorkflowDefinition('u1', first.id)
    await createWorkflowDefinition('u1', { name: 'fits-now' })
  })

  test('safe delete with zero run history removes definition + its unused versions', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    await createWorkflowVersion('u1', definitionId, {})
    expect(vers.size).toBe(2)
    await deleteWorkflowDefinition('u1', definitionId)
    expect(defs.size).toBe(0)
    expect(vers.size).toBe(0)
    expect(audits.some((a) => a.action === 'ai-studio.workflow_delete')).toBe(true)
  })

  test('delete is REFUSED when historical runs exist (409 — archiving is offered)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    await fixtureRun({ userId: 'u1', definitionId, versionId: vers.values().next().value!.id, status: 'completed' })
    const err = await deleteWorkflowDefinition('u1', definitionId).catch((e) => e)
    expect(statusOf(err)).toBe('EDIT_CONFLICT')
    expect(err.message).toContain('Archive')
    // Nothing was deleted — history is intact.
    expect(defs.size).toBe(1)
    expect(vers.size).toBe(1)
    expect(runs.size).toBe(1)
  })
})

describe('M50.3 service — transaction atomicity', () => {
  test('a mid-transaction failure leaves NO partial definition rows', async () => {
    failNextVersionCreate = new Error('disk exploded')
    await expect(createWorkflowDefinition('u1', { name: 'Doomed' })).rejects.toThrow('disk exploded')
    expect(defs.size).toBe(0)
    expect(vers.size).toBe(0)
  })

  test('a failed supersede step leaves the previous published version intact (tx atomicity)', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    const v2 = await createWorkflowVersion('u1', definitionId, {})
    await publishWorkflowVersion('u1', definitionId, '2')
    const v3 = await createWorkflowVersion('u1', definitionId, {})
    // The supersede UPDATE (of v2) fails mid-transaction → the whole
    // publication rolls back: v3 stays draft, v2 stays published.
    failNextVersionUpdate = new Error('lock stalled')
    await expect(publishWorkflowVersion('u1', definitionId, String(v3.version))).rejects.toThrow('lock stalled')
    expect((await getWorkflowVersion('u1', definitionId, String(v3.version))).status).toBe('draft')
    expect((await getWorkflowVersion('u1', definitionId, '2')).status).toBe('published')
    expect((await getWorkflowVersion('u1', definitionId, '1')).status).toBe('superseded')
  })
})

describe('M50.3 service — read-only validate/preview (zero-write census)', () => {
  test('validate returns the bounded diagnostic set and mutates NOTHING', async () => {
    const { definitionId } = await createSampleWorkflow()
    const before = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    const beforeBytes = JSON.stringify([...defs.values(), ...vers.values(), ...runs.values()])
    const result = await validateWorkflowVersion('u1', definitionId, '1')
    expect(result.outcome.valid).toBe(true)
    expect(result.outcome.diagnostics).toEqual([])
    const after = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    expect(after).toEqual(before)
    expect(JSON.stringify([...defs.values(), ...vers.values(), ...runs.values()])).toBe(beforeBytes)
  })

  test('validate surfaces structural errors for a broken stored graph without writing', async () => {
    const view = await createWorkflowDefinition('u1', { name: 'Broken', graphJson: blankGraphJson() })
    const result = await validateWorkflowVersion('u1', view.id, '1')
    expect(result.outcome.valid).toBe(false)
    expect(result.outcome.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    expect(vers.size).toBe(1)
  })

  test('preview compiles the REAL plan (gate auto-appended) and mutates NOTHING', async () => {
    const { definitionId } = await createSampleWorkflow()
    const before = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    const result = await previewWorkflowVersion('u1', definitionId, '1')
    expect(result.compiled.ok).toBe(true)
    if (result.compiled.ok) {
      expect(result.compiled.tasks.map((t) => t.kind)).toEqual(['research', 'document-draft', 'verify-deliverable'])
      expect(result.compiled.gateAutoAppended).toBe(true)
      expect(result.compiled.diagnostics).toEqual([])
    }
    const after = { d: defs.size, v: vers.size, r: runs.size, m: missions.size, mt: missionTasks.size, j: jobs.size, t: trustTasks.size }
    expect(after).toEqual(before)
    expect(runs.size).toBe(0)
    expect(missions.size).toBe(0)
    expect(jobs.size).toBe(0)
    expect(trustTasks.size).toBe(0)
  })

  test('unknown/proposed nodes are refused at the WRITE path and never preview', async () => {
    // Storage-layer defense: an unknown node fails the strict schema parse,
    // so it can never even become a stored draft (422 at creation).
    const hostile = JSON.stringify({
      schemaVersion: 1,
      nodes: [
        { nodeId: 'a', nodeType: 'approval.gate', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [],
    })
    const err = await createWorkflowDefinition('u1', { name: 'Hostile', graphJson: hostile }).catch((e) => e)
    expect(statusOf(err)).toBe('UNSUPPORTED_CONTENT')
    expect(defs.size).toBe(0)
    // Defense-in-depth: even a CORRUPT store row (simulated: a graph an
    // older/buggy writer left behind) can never compile — the integrity
    // defect surfaces honestly and nothing executes or is written.
    const view = await createWorkflowDefinition('u1', { name: 'Clean' })
    vers.forEach((v) => {
      if (v.definitionId === view.id) v.graphJson = hostile
    })
    const before = JSON.stringify([...defs.values(), ...vers.values(), ...runs.values()])
    const pv = await previewWorkflowVersion('u1', view.id, '1').catch((e) => e)
    expect(statusOf(pv)).toBe('INTERNAL_ERROR')
    const vv = await validateWorkflowVersion('u1', view.id, '1').catch((e) => e)
    expect(statusOf(vv)).toBe('INTERNAL_ERROR')
    expect(JSON.stringify([...defs.values(), ...vers.values(), ...runs.values()])).toBe(before)
    expect(missions.size).toBe(0)
  })

  test('the QUALITY gate cannot be bypassed through a saved draft either', async () => {
    const view = await createWorkflowDefinition('u1', { name: 'No gate', graphJson: JSON.stringify({
      schemaVersion: 1,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'a poster' } },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [{ edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } }],
    }) })
    const result = await previewWorkflowVersion('u1', view.id, '1')
    expect(result.compiled.ok).toBe(true)
    if (result.compiled.ok) {
      expect(result.compiled.tasks.some((t) => t.kind === 'verify-deliverable')).toBe(true)
      expect(result.compiled.gateAutoAppended).toBe(true)
    }
  })

  test('an immutable published graph stays byte-identical after preview', async () => {
    const { definitionId } = await createSampleWorkflow()
    await publishWorkflowVersion('u1', definitionId, '1')
    const before = (await getWorkflowVersion('u1', definitionId, '1')).graphJson
    await previewWorkflowVersion('u1', definitionId, '1')
    await validateWorkflowVersion('u1', definitionId, '1')
    const after = (await getWorkflowVersion('u1', definitionId, '1')).graphJson
    expect(after).toBe(before)
    expect((await getWorkflowVersion('u1', definitionId, '1')).status).toBe('published')
  })

  test('availability warnings survive into the preview diagnostics (server-side only)', async () => {
    const { definitionId } = await createSampleWorkflow()
    const result = await previewWorkflowVersion('u1', definitionId, '1', { riishe: 'unavailable' })
    expect(result.compiled.ok).toBe(true)
    if (result.compiled.ok) {
      expect(result.compiled.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('unavailable'))).toBe(true)
    }
  })
})
