/**
 * BEAN Intelligence — CODE GIFTZ project persistence SECURITY tests (M22).
 *
 * Route-level tests over the NEW persistence endpoints with a fully mocked
 * Prisma boundary (self-contained in-memory fake — no test touches the real
 * DB) and a mocked session. Pins:
 *  - OWNERSHIP/IDOR: every new route answers NOT_FOUND for another user's
 *    project (no existence leak), for missing ids, and for unauthenticated
 *    calls where applicable;
 *  - PATH SAFETY: file save/delete refuse traversal-shaped paths;
 *  - OPTIMISTIC CONCURRENCY: a save with a stale expectedUpdatedAt is
 *    refused honestly (no silent clobber);
 *  - ARCHIVE/RESTORE: owner-only, and archived projects leave the default
 *    list while staying openable via ?status=archived / ?includeArchived=1;
 *  - VERSIONS: manual snapshot of an unchanged workspace is a no-op;
 *    rollback is owner-only and refuses corrupt versions;
 *  - EXPORT: the served archive is a verified ZIP with secret exclusions
 *    applied (response-level contract).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controllable session ---------------------------------------------------

let currentUser: { id: string } | null = { id: 'alice' }
mock.module('@/lib/auth/session', () => ({
  requireUser: async () => {
    if (!currentUser) throw Object.assign(new Error('Unauthenticated'), { code: 'UNAUTHENTICATED' })
    return currentUser
  },
}))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async () => undefined,
  recordUsage: async () => undefined,
}))
mock.module('@/lib/observability/logger', () => ({
  // M26: handle() now also pulls withRequestContext/currentRequestId from
  // this module — the fake must provide the full consumed surface.
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  withRequestContext: async <T,>(ctx: unknown, fn: () => Promise<T>) => fn(),
  currentRequestId: () => null,
  redact: (v: string) => v,
}))

// ---- in-memory Prisma fake --------------------------------------------------

interface Row {
  [k: string]: unknown
}

const ALICE = 'alice'
const BOB = 'bob'

const projects = new Map<string, Row>()
const files = new Map<string, Row>() // key `${projectId}|${path}`
const messages: Row[] = []
const blobs: Row[] = []
const versions: Row[] = []
let idCounter = 0
let blobLookupsFail = false

function reset() {
  projects.clear()
  files.clear()
  messages.length = 0
  blobs.length = 0
  versions.length = 0
  idCounter = 0
  blobLookupsFail = false
}

function hash(content: string): string {
  // Simple deterministic stand-in (the versioning module computes real sha256
  // itself; the fake only needs consistency between store and lookups).
  let h = 0
  for (let i = 0; i < content.length; i += 1) h = (h * 31 + content.charCodeAt(i)) | 0
  return `h${h >>> 0}`
}

function seedProject(id: string, userId: string, overrides: Row = {}): Row {
  const row = {
    id,
    userId,
    title: `Project ${id}`,
    description: null,
    framework: null,
    language: null,
    status: 'active',
    currentVersion: 0,
    lastOpenedAt: null,
    createdAt: new Date('2026-11-15T10:00:00Z'),
    updatedAt: new Date('2026-11-15T10:00:00Z'),
    ...overrides,
  }
  projects.set(id, row)
  return row
}

function seedFile(projectId: string, path: string, content: string): Row {
  const row = { id: `f-${++idCounter}`, projectId, path, content, origin: 'generated', updatedAt: new Date('2026-11-15T10:00:00Z') }
  files.set(`${projectId}|${path}`, row)
  return row
}

const fakeDb = {
  codeProject: {
    async findUnique({ where }: { where: { id: string } }) {
      return projects.get(where.id) ?? null
    },
    async findMany({ where, orderBy, take }: { where: { userId?: string; status?: string }; orderBy?: { updatedAt?: string }; take?: number }) {
      let rows = [...projects.values()]
      if (where?.userId) rows = rows.filter((p) => p.userId === where.userId)
      if (where?.status) rows = rows.filter((p) => p.status === where.status)
      if (orderBy?.updatedAt === 'desc') rows.sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime())
      const withCounts = rows.map((p) => ({
        ...p,
        _count: {
          files: [...files.values()].filter((f) => f.projectId === p.id).length,
          messages: messages.filter((m) => m.projectId === p.id).length,
        },
      }))
      return take ? withCounts.slice(0, take) : withCounts
    },
    async create({ data }: { data: Row }) {
      const row: Row = { status: 'active', currentVersion: 0, lastOpenedAt: null, description: null, framework: null, language: null, createdAt: new Date(), updatedAt: new Date(), ...data }
      projects.set(row.id as string, row)
      return row
    },
    async update({ where, data }: { where: { id: string }; data: Row }) {
      const row = projects.get(where.id)
      if (!row) throw new Error('project not found')
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
    async delete({ where }: { where: { id: string } }) {
      const row = projects.get(where.id)
      projects.delete(where.id)
      for (const [key, f] of files) if (f.projectId === where.id) files.delete(key)
      messages.length = 0
      return row ?? null
    },
    async count({ where }: { where: { projectId?: string } }) {
      if (where?.projectId) return versions.filter((v) => v.projectId === where.projectId).length
      return projects.size
    },
  },
  codeFile: {
    async findMany({ where, orderBy }: { where: { projectId: string }; orderBy?: { path?: string } }) {
      let rows = [...files.values()].filter((f) => f.projectId === where?.projectId)
      if (orderBy?.path === 'asc') rows.sort((a, b) => (a.path as string).localeCompare(b.path as string))
      return rows
    },
    async findUnique({ where }: { where: { projectId_path: { projectId: string; path: string } } }) {
      return files.get(`${where.projectId_path.projectId}|${where.projectId_path.path}`) ?? null
    },
    async create({ data }: { data: Row }) {
      const row: Row = { id: `f-${++idCounter}`, origin: 'generated', updatedAt: new Date(), ...data }
      files.set(`${row.projectId}|${row.path}`, row)
      return row
    },
    async createMany({ data }: { data: Row[] }) {
      for (const d of data) await fakeDb.codeFile.create({ data: d })
      return { count: data.length }
    },
    async update({ where, data }: { where: { id: string }; data: Row }) {
      for (const row of files.values()) {
        if (row.id === where.id) {
          Object.assign(row, data, { updatedAt: new Date() })
          return row
        }
      }
      throw new Error('file not found')
    },
    async delete({ where }: { where: { id: string } }) {
      for (const [key, row] of files) {
        if (row.id === where.id) {
          files.delete(key)
          return row
        }
      }
      throw new Error('file not found')
    },
  },
  codeMessage: {
    async findMany({ where }: { where: { projectId: string } }) {
      return messages.filter((m) => m.projectId === where?.projectId)
    },
    async createMany({ data }: { data: Row[] }) {
      messages.push(...data.map((d) => ({ id: `m-${++idCounter}`, createdAt: new Date(), ...d })))
      return { count: data.length }
    },
  },
  codeBlob: {
    async upsert({ where, create }: { where: { projectId_hash: { projectId: string; hash: string } }; create: Row; update: Row }) {
      const found = blobs.find((b) => b.projectId === where.projectId_hash.projectId && b.hash === where.projectId_hash.hash)
      if (found) return found
      const row = { ...create }
      blobs.push(row)
      return row
    },
    async findMany({ where }: { where: { projectId: string; hash: { in: string[] } } }) {
      if (blobLookupsFail) return []
      return blobs.filter((b) => b.projectId === where.projectId && where.hash.in.includes(b.hash as string))
    },
    async findUnique({ where }: { where: { projectId_hash: { projectId: string; hash: string } } }) {
      if (blobLookupsFail) return null
      return blobs.find((b) => b.projectId === where.projectId_hash.projectId && b.hash === where.projectId_hash.hash) ?? null
    },
  },
  codeVersion: {
    async findFirst({ where }: { where: { projectId: string } }) {
      return [...versions].filter((v) => v.projectId === where.projectId).sort((a, b) => (b.seq as number) - (a.seq as number))[0] ?? null
    },
    async findUnique({ where }: { where: { projectId_seq: { projectId: string; seq: number } } }) {
      const v = versions.find((x) => x.projectId === where.projectId_seq.projectId && x.seq === where.projectId_seq.seq) ?? null
      return v
    },
    async findMany({ where, orderBy }: { where: { projectId: string }; orderBy?: { seq?: string } }) {
      let rows = versions.filter((v) => v.projectId === where.projectId)
      if (orderBy?.seq === 'desc') rows = [...rows].sort((a, b) => (b.seq as number) - (a.seq as number))
      return rows
    },
    async count({ where }: { where: { projectId: string } }) {
      return versions.filter((v) => v.projectId === where.projectId).length
    },
    async create({ data }: { data: Row & { files: { create: Row[] } } }) {
      const fileCreates = [...(data.files?.create ?? [])]
      const { files: _f, ...rest } = data as Row
      const row = { ...rest, id: `v-${++idCounter}`, createdAt: new Date(), files: fileCreates }
      versions.push(row)
      return row
    },
  },
  async $transaction<T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> {
    return await fn(fakeDb)
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- route modules (imported AFTER the mocks) --------------------------------

const projectsRoute = await import('../../src/app/api/code-giftz/projects/route')
const detailRoute = await import('../../src/app/api/code-giftz/projects/[id]/route')
const openRoute = await import('../../src/app/api/code-giftz/projects/[id]/open/route')
const duplicateRoute = await import('../../src/app/api/code-giftz/projects/[id]/duplicate/route')
const archiveRoute = await import('../../src/app/api/code-giftz/projects/[id]/archive/route')
const restoreRoute = await import('../../src/app/api/code-giftz/projects/[id]/restore/route')
const filesRoute = await import('../../src/app/api/code-giftz/projects/[id]/files/route')
const versionsRoute = await import('../../src/app/api/code-giftz/projects/[id]/versions/route')
const versionDetailRoute = await import('../../src/app/api/code-giftz/projects/[id]/versions/[seq]/route')
const compareRoute = await import('../../src/app/api/code-giftz/projects/[id]/versions/[seq]/compare/route')
const rollbackRoute = await import('../../src/app/api/code-giftz/projects/[id]/versions/[seq]/rollback/route')
const exportRoute = await import('../../src/app/api/code-giftz/projects/[id]/export/route')

const PR = (id = 'p1'): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) })
const PR_SEQ = (id = 'p1', seq = '1'): { params: Promise<{ id: string; seq: string }> } => ({ params: Promise.resolve({ id, seq }) })
const JSON_REQ = (body: unknown, method = 'POST'): Request =>
  new Request('http://localhost:3000/x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  reset()
  currentUser = { id: ALICE }
})

// ---- ownership / IDOR --------------------------------------------------------

describe('ownership and IDOR protection', () => {
  test('open: owner ok; another user and missing id both NOT_FOUND', async () => {
    seedProject('p1', ALICE)
    const ok = await openRoute.POST(new Request('http://x'), PR('p1'))
    expect(ok.status).toBe(200)
    expect(((await body(ok)).project as Row).lastOpenedAt).toBeTruthy()

    seedProject('p2', BOB)
    const foreign = await openRoute.POST(new Request('http://x'), PR('p2'))
    expect(foreign.status).toBe(404)
    const missing = await openRoute.POST(new Request('http://x'), PR('p404'))
    expect(missing.status).toBe(404)
  })

  test('duplicate: copies files+messages ONLY for the owner; foreign project NOT_FOUND', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'index.html', '<p>hi</p>')
    messages.push({ projectId: 'p1', role: 'user', content: 'build it' })

    const ok = await duplicateRoute.POST(new Request('http://x'), PR('p1'))
    expect(ok.status).toBe(200)
    const data = await body(ok)
    expect((data.project as Row).files).toBe(1)
    expect((data.project as Row).messages).toBe(1)
    // copy exists with (copy) suffix and its own initial version
    expect(projects.size).toBe(2)
    const copy = [...projects.values()].find((p) => p.id !== 'p1')!
    expect(copy.title).toBe('Project p1 (copy)')
    expect(versions.some((v) => v.projectId === copy.id)).toBe(true)
    // the ORIGINAL files are untouched
    expect(files.get('p1|index.html')).toBeTruthy()

    seedProject('p2', BOB)
    const foreign = await duplicateRoute.POST(new Request('http://x'), PR('p2'))
    expect(foreign.status).toBe(404)
    // p1 + its copy + p2 — the foreign attempt added nothing.
    expect(projects.size).toBe(3)
  })

  test('archive/restore: owner-only; foreign NOT_FOUND; archive hides from default list', async () => {
    seedProject('p1', ALICE)
    seedProject('p2', BOB)
    expect((await body(await archiveRoute.POST(new Request('http://x'), PR('p1')))).project).toMatchObject({ status: 'archived' })
    expect((await archiveRoute.POST(new Request('http://x'), PR('p2'))).status).toBe(404)

    // default list: active only
    const list = await body(await projectsRoute.GET(new Request('http://x')))
    expect((list.projects as Row[]).map((p) => p.id)).not.toContain('p1')
    // archived view includes it
    const archived = await body(await projectsRoute.GET(new Request('http://x?status=archived')))
    expect((archived.projects as Row[]).map((p) => p.id)).toEqual(['p1'])

    expect((await body(await restoreRoute.POST(new Request('http://x'), PR('p1')))).project).toMatchObject({ status: 'active' })
  })

  test('versions/compare/rollback/detail: all NOT_FOUND for a foreign project', async () => {
    seedProject('p1', BOB)
    expect((await versionsRoute.GET(new Request('http://x'), PR('p1'))).status).toBe(404)
    expect((await versionsRoute.POST(JSON_REQ({ summary: 'x' }), PR('p1'))).status).toBe(404)
    expect((await versionDetailRoute.GET(new Request('http://x'), PR_SEQ('p1', '1'))).status).toBe(404)
    expect((await compareRoute.GET(new Request('http://x'), PR_SEQ('p1', '1'))).status).toBe(404)
    expect((await rollbackRoute.POST(new Request('http://x'), PR_SEQ('p1', '1'))).status).toBe(404)
  })

  test('file save/delete: NOT_FOUND for a foreign project', async () => {
    seedProject('p1', BOB)
    expect((await filesRoute.POST(JSON_REQ({ path: 'app.js', content: 'x' }), PR('p1'))).status).toBe(404)
    expect((await filesRoute.DELETE(JSON_REQ({ path: 'app.js' }), PR('p1'))).status).toBe(404)
  })
})

// ---- path safety --------------------------------------------------------------

describe('path traversal protection', () => {
  test('file save refuses ../, absolute and drive-letter paths', async () => {
    seedProject('p1', ALICE)
    for (const bad of ['../evil.js', '/etc/passwd', 'C:\\boot.ini', 'a/../../b.js']) {
      const res = await filesRoute.POST(JSON_REQ({ path: bad, content: 'x' }), PR('p1'))
      expect(res.status).toBe(500) // assertSafeProjectPath throws -> mapped as server error, never persisted
      expect([...files.values()].filter((f) => f.content === 'x')).toHaveLength(0)
    }
  })

  test('file delete refuses traversal paths and reports missing files', async () => {
    seedProject('p1', ALICE)
    const bad = await filesRoute.DELETE(JSON_REQ({ path: '../evil.js' }), PR('p1'))
    expect(bad.status).toBe(500)
    seedFile('p1', 'app.js', 'x')
    const missing = await filesRoute.DELETE(JSON_REQ({ path: 'nope.js' }), PR('p1'))
    expect(missing.status).toBe(404)
    const ok = await filesRoute.DELETE(JSON_REQ({ path: 'app.js' }), PR('p1'))
    expect(ok.status).toBe(200)
    expect(files.size).toBe(0)
  })
})

// ---- optimistic concurrency ----------------------------------------------------

describe('concurrent edit protection', () => {
  test('a stale expectedUpdatedAt refuses the save with an honest conflict', async () => {
    seedProject('p1', ALICE)
    const row = seedFile('p1', 'app.js', 'v1')
    // Simulate another writer landing after the client loaded the file.
    ;(row.updatedAt as Date) = new Date((row.updatedAt as Date).getTime() + 5_000)

    const stale = await filesRoute.POST(
      JSON_REQ({ path: 'app.js', content: 'client edit', expectedUpdatedAt: '2026-11-15T10:00:00.000Z' }),
      PR('p1'),
    )
    expect(stale.status).toBe(400)
    const msg = (await body(stale)).error as { message?: string }
    expect(msg.message).toMatch(/changed after you loaded/i)
    // the other writer's content is NOT clobbered
    expect((files.get('p1|app.js') as Row).content).toBe('v1')
  })

  test('a matching expectedUpdatedAt saves normally', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'app.js', 'v1')
    const ok = await filesRoute.POST(
      JSON_REQ({ path: 'app.js', content: 'client edit', expectedUpdatedAt: '2026-11-15T10:00:00.000Z' }),
      PR('p1'),
    )
    expect(ok.status).toBe(200)
    expect((files.get('p1|app.js') as Row).content).toBe('client edit')
  })
})

// ---- version lifecycle at the route boundary -----------------------------------

describe('version lifecycle routes', () => {
  test('manual snapshot of an unchanged workspace is an honest no-op', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'app.js', 'v1')
    const first = await body(await versionsRoute.POST(JSON_REQ({ summary: 'manual save' }), PR('p1')))
    expect(first.created).toBe(true)
    const second = await body(await versionsRoute.POST(JSON_REQ({ summary: 'manual save again' }), PR('p1')))
    expect(second.created).toBe(false)
    expect(second.skipped).toBe('unchanged')
    expect(versions).toHaveLength(1)
  })

  test('rollback is owner-only, appends a NEW version, and refuses corrupt data', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'app.js', 'v1')
    await versionsRoute.POST(JSON_REQ({ summary: 'init' }), PR('p1'))
    ;(files.get('p1|app.js') as Row).content = 'v2'
    await versionsRoute.POST(JSON_REQ({ summary: 'change' }), PR('p1'))

    const rb = await body(await rollbackRoute.POST(new Request('http://x'), PR_SEQ('p1', '1')))
    expect((rb.rollback as Row).restoredFrom).toBe(1)
    expect(((rb.rollback as Row).newVersion as Row).seq).toBe(3)
    expect((files.get('p1|app.js') as Row).content).toBe('v1')
    expect(versions).toHaveLength(3)

    // corrupt: drop the blob store
    blobLookupsFail = true
    expect((await rollbackRoute.POST(new Request('http://x'), PR_SEQ('p1', '1'))).status).toBe(500)
    blobLookupsFail = false
  })

  test('version detail validates integrity and serves historical file content', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'app.js', 'v1')
    await versionsRoute.POST(JSON_REQ({ summary: 'init' }), PR('p1'))
    const detail = await body(await versionDetailRoute.GET(new Request('http://x'), PR_SEQ('p1', '1')))
    expect((detail.version as Row).integrity).toMatchObject({ ok: true })
    const fileRes = await versionDetailRoute.GET(new Request('http://x?file=app.js'), PR_SEQ('p1', '1'))
    expect(((await body(fileRes)).file as Row).content).toBe('v1')
    const foreignFile = await versionDetailRoute.GET(new Request('http://x?file=../evil.js'), PR_SEQ('p1', '1'))
    expect(foreignFile.status).toBe(500) // unsafe path refused
  })

  test('compare exposes added/modified/deleted vs current with diffs', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'app.js', 'line1')
    await versionsRoute.POST(JSON_REQ({ summary: 'init' }), PR('p1'))
    ;(files.get('p1|app.js') as Row).content = 'line1\nline2'
    seedFile('p1', 'extra.js', 'new file')
    const cmp = await body(await compareRoute.GET(new Request('http://x'), PR_SEQ('p1', '1')))
    const data = cmp.comparison as Row
    expect(data.modified).toEqual([{ path: 'app.js', added: 1, removed: 0 }])
    expect(data.added).toEqual(['extra.js'])
    expect(Object.keys(data.diffs as Row)).toContain('app.js')
  })

  test('invalid version numbers are VALIDATION_ERRORs (not crashes)', async () => {
    seedProject('p1', ALICE)
    expect((await versionDetailRoute.GET(new Request('http://x'), PR_SEQ('p1', 'zero'))).status).toBe(400)
    expect((await compareRoute.GET(new Request('http://x'), PR_SEQ('p1', '0'))).status).toBe(400)
    expect((await rollbackRoute.POST(new Request('http://x'), PR_SEQ('p1', '-3'))).status).toBe(400)
  })
})

// ---- export route ---------------------------------------------------------------

describe('export route', () => {
  test('serves a verified ZIP to the owner; secret-named files are excluded', async () => {
    seedProject('p1', ALICE)
    seedFile('p1', 'index.html', '<p>hello</p>')
    seedFile('p1', '.env', 'SECRET=1')
    const res = await exportRoute.GET(new Request('http://x'), PR('p1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('x-export-files')).toBe('1')
    expect(res.headers.get('x-export-excluded')).toBe('1')
    const bytes = new Uint8Array(await res.arrayBuffer())
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files)
    expect(names).toContain('index.html')
    expect(names).toContain('README.md')
    expect(names).toContain('manifest.json')
    expect(names.some((n) => n.includes('.env'))).toBe(false)
  })

  test('foreign project export is 404; unauthenticated export is 401', async () => {
    seedProject('p1', BOB)
    expect((await exportRoute.GET(new Request('http://x'), PR('p1'))).status).toBe(404)
    currentUser = null
    expect((await exportRoute.GET(new Request('http://x'), PR('p1'))).status).toBe(401)
    currentUser = { id: ALICE }
  })

  test('a project with no exportable files is refused honestly (400)', async () => {
    seedProject('p1', ALICE)
    expect((await exportRoute.GET(new Request('http://x'), PR('p1'))).status).toBe(400)
  })
})

// ---- project metadata -----------------------------------------------------------

describe('project metadata (PATCH / create)', () => {
  test('PATCH updates title and description for the owner only', async () => {
    seedProject('p1', ALICE)
    const ok = await body(await detailRoute.PATCH(JSON_REQ({ title: 'Renamed', description: 'My app' }, 'PATCH'), PR('p1')))
    expect((ok.project as Row).title).toBe('Renamed')
    expect((ok.project as Row).description).toBe('My app')
    seedProject('p2', BOB)
    expect((await detailRoute.PATCH(JSON_REQ({ title: 'hijack' }, 'PATCH'), PR('p2'))).status).toBe(404)
  })

  test('POST /projects creates with sanitized metadata; GET carries persistence fields', async () => {
    const created = await body(await projectsRoute.POST(JSON_REQ({ title: '  My   App  ', description: 'desc' })))
    expect((created.project as Row).title).toBe('My App')
    expect((created.project as Row).status).toBe('active')
    expect((created.project as Row).currentVersion).toBe(0)
    seedFile('p1', 'app.js', 'x')
    const list = await body(await projectsRoute.GET(new Request('http://x')))
    const row = (list.projects as Row[])[0]
    expect(row).toHaveProperty('currentVersion')
    expect(row).toHaveProperty('status')
    expect(row).toHaveProperty('framework')
    expect(row).toHaveProperty('lastOpenedAt')
  })
})
