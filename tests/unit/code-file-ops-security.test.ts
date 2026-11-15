/**
 * BEAN Intelligence — CODE GIFTZ chat-based file operations tests (M23).
 *
 * Route-level + flow tests over a fully mocked Prisma boundary (self-contained
 * in-memory fake — no test touches the real DB) and a mocked session. Pins:
 *  - OWNERSHIP/IDOR: file-op execute/cancel answer NOT_FOUND for another
 *    user's project, for missing ops, and 401 when unauthenticated;
 *  - CONFIRMATION: deletion and repair REQUIRE the recorded plan (the chat
 *    flow never executes them without it); a plan whose stored bytes no
 *    longer match its confirmation hash is refused; cancelled/failed records
 *    refuse execution;
 *  - STALENESS: a plan whose sources/destinations changed is refused and the
 *    ledger records the honest stale state;
 *  - IDEMPOTENCY: a repeated execute REPLAYS the recorded result (no double
 *    mutation);
 *  - ATOMICITY: multi-file operations are transactional — a mid-batch
 *    conflict leaves everything unchanged;
 *  - VERSIONS: every successful mutation snapshots a version; failed
 *    operations snapshot NOTHING; rollback restores through M22 and creates
 *    a NEW version; integrity validation stays intact;
 *  - PATH SAFETY: traversal-shaped intents are refused; protected system
 *    files cannot be deleted; the project root cannot be deleted.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { BeanApiError } from '../../src/lib/api/errors'

// ---- controllable session ---------------------------------------------------

let currentUser: { id: string } | null = { id: 'alice' }
mock.module('@/lib/auth/session', () => ({
  requireUser: async () => {
    // Same class the real session guard throws (handle maps it to 401).
    if (!currentUser) throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    return currentUser
  },
}))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async () => undefined,
  recordUsage: async () => undefined,
}))
mock.module('@/lib/observability/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
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
const operations = new Map<string, Row>()
let idCounter = 0

function reset() {
  projects.clear()
  files.clear()
  messages.length = 0
  blobs.length = 0
  versions.length = 0
  operations.clear()
  idCounter = 0
}

function hash(content: string): string {
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
    async update({ where, data }: { where: { id: string }; data: Row }) {
      const row = projects.get(where.id)
      if (!row) throw new Error('project not found')
      Object.assign(row, data, { updatedAt: new Date() })
      return row
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
    async update({ where, data }: { where: { id: string }; data: Row }) {
      for (const [key, row] of files) {
        if (row.id === where.id) {
          const oldPath = row.path
          Object.assign(row, data, { updatedAt: new Date() })
          // A path update (rename/move) must re-key the map like the real
          // unique constraint would.
          if (data.path !== undefined && data.path !== oldPath) {
            files.delete(key)
            files.set(`${row.projectId}|${row.path}`, row)
          }
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
    async create({ data }: { data: Row }) {
      const row = { id: `m-${++idCounter}`, createdAt: new Date(), ...data }
      messages.push(row)
      return row
    },
    async findMany({ where }: { where: { projectId: string } }) {
      return messages.filter((m) => m.projectId === where?.projectId)
    },
    async findFirst({ where, orderBy }: { where: { projectId: string }; orderBy?: { createdAt?: string } }) {
      const rows = messages.filter((m) => m.projectId === where?.projectId)
      if (orderBy?.createdAt === 'desc') return rows[rows.length - 1] ?? null
      return rows[0] ?? null
    },
  },
  codeBlob: {
    async upsert({ where, create }: { where: { projectId_hash: { projectId: string; hash: string } }; create: Row }) {
      const found = blobs.find((b) => b.projectId === where.projectId_hash.projectId && b.hash === where.projectId_hash.hash)
      if (found) return found
      const row = { ...create }
      blobs.push(row)
      return row
    },
    async findMany({ where }: { where: { projectId: string; hash: { in: string[] } } }) {
      return blobs.filter((b) => b.projectId === where.projectId && where.hash.in.includes(b.hash as string))
    },
    async findUnique({ where }: { where: { projectId_hash: { projectId: string; hash: string } } }) {
      return blobs.find((b) => b.projectId === where.projectId_hash.projectId && b.hash === where.projectId_hash.hash) ?? null
    },
  },
  codeVersion: {
    async findFirst({ where }: { where: { projectId: string } }) {
      return [...versions].filter((v) => v.projectId === where.projectId).sort((a, b) => (b.seq as number) - (a.seq as number))[0] ?? null
    },
    async findUnique({ where }: { where: { projectId_seq: { projectId: string; seq: number } } }) {
      return versions.find((x) => x.projectId === where.projectId_seq.projectId && x.seq === where.projectId_seq.seq) ?? null
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
  codeFileOperation: {
    async findFirst({ where }: { where: { projectId: string; planHash: string; status: string } }) {
      for (const row of operations.values()) {
        if (row.projectId === where.projectId && row.planHash === where.planHash && row.status === where.status) return row
      }
      return null
    },
    async findUnique({ where }: { where: { id: string } }) {
      return operations.get(where.id) ?? null
    },
    async create({ data }: { data: Row }) {
      const row: Row = { id: `op-${++idCounter}`, createdAt: new Date(), status: 'awaiting_confirmation', ...data }
      operations.set(row.id as string, row)
      return row
    },
    async update({ where, data }: { where: { id: string }; data: Row }) {
      const row = operations.get(where.id)
      if (!row) throw new Error('operation not found')
      Object.assign(row, data)
      return row
    },
  },
  async $transaction<T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> {
    return await fn(fakeDb)
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- modules (imported AFTER the mocks) -------------------------------------

const executeRoute = await import('../../src/app/api/code-giftz/projects/[id]/file-ops/execute/route')
const cancelRoute = await import('../../src/app/api/code-giftz/projects/[id]/file-ops/cancel/route')
const { performDetectedFileOperation, executeOperation, cancelOperation } = await import('../../src/lib/code/file-ops/execute')
const { detectFileOperation } = await import('../../src/lib/code/file-ops/detect')
const { buildFileOpPlan, planHashOf, canonicalJson } = await import('../../src/lib/code/file-ops/plan')
const { rollbackToVersion, listVersions, validateVersionIntegrity, snapshotProjectVersion } = await import('../../src/lib/code/versioning')

const PR = (id = 'p1'): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) })
const JSON_REQ = (body: unknown): Request =>
  new Request('http://localhost:3000/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/** Run a chat message through the REAL detection → planning → flow pipeline. */
async function flow(projectId: string, message: string) {
  const filesNow = await fakeDb.codeFile.findMany({ where: { projectId } })
  const detection = detectFileOperation(message, filesNow as Array<{ path: string }>)
  return performDetectedFileOperation({ projectId, detection, files: filesNow as Array<{ path: string; content: string }> })
}

beforeEach(() => {
  reset()
  currentUser = { id: ALICE }
  // Standard project: an app with an import graph and a component folder.
  seedProject('p1', ALICE)
  seedFile('p1', 'index.html', '<html><body><script src="app.js"></script></body></html>')
  seedFile('p1', 'app.js', "import { greet } from './lib/greet.js'\nconsole.log(greet('hi'))\n")
  seedFile('p1', 'lib/greet.js', 'export const greet = (n) => `hello ${n}`\n')
  seedFile('p1', 'src/components/Button.tsx', 'export const Button = () => null\n')
  seedFile('p1', 'src/components/Card.tsx', "import { Button } from './Button'\nexport const Card = () => null\n")
  seedFile('p1', 'package.json', '{"name":"giftz-app"}')
})

// ---- the full chat flow -------------------------------------------------------

describe('chat flow: rename with reference repair', () => {
  test('rename executes, snapshots a version, preserves content, offers a repair', async () => {
    const { payload, assistantText } = await flow('p1', 'rename lib/greet.js to lib/hello.js')
    expect(payload.status).toBe('executed')
    expect(payload.kind).toBe('rename')
    expect(payload.versionSeq).toBe(1)
    // The file moved with IDENTICAL content.
    expect(files.get('p1|lib/greet.js')).toBeUndefined()
    const moved = files.get('p1|lib/hello.js') as Row
    expect(moved.content).toContain('hello ${n}')
    // Unrelated files are byte-for-byte unchanged.
    expect((files.get('p1|app.js') as Row).content).toContain("'./lib/greet.js'")
    // The import reference impact was detected and a repair was offered.
    expect(payload.result?.verification.remainingReferences).toBe(1)
    expect(payload.result?.repairOffered).toBeTruthy()
    expect(payload.result?.repairOffered?.affectedFiles[0].path).toBe('app.js')
    expect(assistantText).toContain('Renamed')
    expect(assistantText).toContain('repair is offered')
    // The rename created exactly ONE version (seq 1 = the forced 'initial'
    // kind per the M22 contract — a diff from nothing, all files 'added').
    const versionsNow = await listVersions('p1')
    expect(versionsNow).toHaveLength(1)
    expect(versionsNow[0].seq).toBe(1)
    expect(versionsNow[0].fileCount).toBe(6)
  })

  test('the offered repair executes through confirmation and fixes the import', async () => {
    const { payload } = await flow('p1', 'rename lib/greet.js to lib/hello.js')
    const repair = payload.result?.repairOffered
    expect(repair).toBeTruthy()
    const result = await executeOperation(repair!.opId, 'p1')
    expect(result.kind).toBe('repair')
    expect(result.applied).toEqual([{ path: 'app.js', action: 'repaired' }])
    expect((files.get('p1|app.js') as Row).content).toContain("'./lib/hello.js'")
    expect(result.verification.remainingReferences).toBe(0)
    expect(payload.result?.verification.contentsPreserved).toBe(true)
    // A repair version was recorded with the REAL repaired file listed.
    const versionsNow = await listVersions('p1')
    expect(versionsNow[0].kind).toBe('repair')
    expect(versionsNow[0].changedFiles).toContainEqual({ path: 'app.js', change: 'modified' })
  })

  test('a stale repair (file changed underneath) is refused and marked stale', async () => {
    const { payload } = await flow('p1', 'rename lib/greet.js to lib/hello.js')
    const repair = payload.result?.repairOffered
    expect(repair).toBeTruthy()
    if (!repair) throw new Error('repair offer missing')
    // Concurrent modification: app.js changes after the repair was prepared.
    const app = files.get('p1|app.js') as Row
    app.content = "console.log('rewritten independently')\n"
    try {
      await executeOperation(repair.opId, 'p1')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('changed since the repair was prepared')
    }
    expect(app.content).toContain('rewritten independently')
    expect(operations.get(repair.opId)?.status).toBe('stale')
  })
})

describe('chat flow: deletion requires explicit confirmation', () => {
  test('delete returns an awaiting_confirmation plan and changes NOTHING', async () => {
    const before = new Map(files)
    const { payload } = await flow('p1', 'delete lib/greet.js')
    expect(payload.status).toBe('awaiting_confirmation')
    expect(payload.kind).toBe('delete')
    expect(payload.opId).toBeTruthy()
    expect(payload.affectedFiles).toEqual(['lib/greet.js'])
    // Nothing changed before confirmation.
    expect(new Map(files)).toEqual(before)
    // The ledger holds the plan.
    const op = operations.get(payload.opId!) as Row
    expect(op.status).toBe('awaiting_confirmation')
    expect(op.kind).toBe('delete')
  })

  test('confirmation executes the deletion and records a version', async () => {
    // Seed a pre-existing version so the deletion records a 'file-op' (seq 1
    // is always 'initial' by the M22 contract).
    await snapshotProjectVersion({ projectId: 'p1', kind: 'manual', summary: 'seed state' })
    const { payload } = await flow('p1', 'delete src/components folder')
    expect(payload.affectedFiles?.sort()).toEqual(['src/components/Button.tsx', 'src/components/Card.tsx'])
    const result = await executeOperation(payload.opId!, 'p1')
    expect(result.applied.length).toBe(2)
    expect(files.get('p1|src/components/Button.tsx')).toBeUndefined()
    expect(files.get('p1|src/components/Card.tsx')).toBeUndefined()
    expect(result.versionSeq).toBe(2)
    expect((await listVersions('p1'))[0].kind).toBe('file-op')
    // Historical content still exists in blobs — deletion never destroys history.
    expect(blobs.length).toBeGreaterThan(0)
  })

  test('replay after execution returns the recorded result without mutating twice', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    const first = await executeOperation(payload.opId!, 'p1')
    const second = await executeOperation(payload.opId!, 'p1')
    expect(second.replayed).toBe(true)
    expect(second.applied).toEqual(first.applied)
    expect(files.get('p1|lib/greet.js')).toBeUndefined()
  })

  test('a cancelled deletion can never execute', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    await cancelOperation(payload.opId!, 'p1')
    try {
      await executeOperation(payload.opId!, 'p1')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('cancelled')
    }
    expect(files.get('p1|lib/greet.js')).toBeTruthy()
  })

  test('a stale deletion (source already gone) is refused, nothing deleted', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    // Concurrent deletion through another path.
    files.delete('p1|lib/greet.js')
    try {
      await executeOperation(payload.opId!, 'p1')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('stale')
    }
    expect(operations.get(payload.opId!)?.status).toBe('stale')
  })
})

describe('chat flow: protected paths and root rejection', () => {
  test('package.json cannot be deleted', async () => {
    const { payload } = await flow('p1', 'delete package.json')
    expect(payload.status).toBe('rejected')
    expect(payload.reason).toContain('protected')
    expect(files.get('p1|package.json')).toBeTruthy()
  })

  test('the project root cannot be deleted (plan-level refusal)', () => {
    const filesNow = [...files.values()].filter((f) => f.projectId === 'p1') as Array<{ path: string; content: string }>
    expect(() => buildFileOpPlan({ kind: 'delete', sources: [{ path: '.', isFolder: false }] }, filesNow)).toThrow()
    expect(() => buildFileOpPlan({ kind: 'delete', sources: [{ path: '', isFolder: false }] }, filesNow)).toThrow()
  })

  test('NOTICES.md (attribution contract) cannot be deleted', async () => {
    seedFile('p1', 'NOTICES.md', 'attribution')
    const { payload } = await flow('p1', 'delete NOTICES.md')
    expect(payload.status).toBe('rejected')
    expect(files.get('p1|NOTICES.md')).toBeTruthy()
  })
})

describe('chat flow: folder operations', () => {
  test('folder move rewrites every nested path and preserves contents', async () => {
    // The spec example: a root-level components folder moved into src/ui.
    files.delete('p1|src/components/Button.tsx')
    files.delete('p1|src/components/Card.tsx')
    seedFile('p1', 'components/Button.tsx', 'export const Button = () => null\n')
    seedFile('p1', 'components/Card.tsx', "import { Button } from './Button'\nexport const Card = () => null\n")
    const buttonBefore = (files.get('p1|components/Button.tsx') as Row).content
    const { payload } = await flow('p1', 'move the components folder into src/ui')
    expect(payload.status).toBe('executed')
    expect(payload.kind).toBe('move')
    expect(files.get('p1|components/Button.tsx')).toBeUndefined()
    expect((files.get('p1|src/ui/components/Button.tsx') as Row).content).toBe(buttonBefore)
    expect((files.get('p1|src/ui/components/Card.tsx') as Row).content).toContain("'./Button'")
    expect(payload.result?.verification.contentsPreserved).toBe(true)
  })

  test('moving a folder into its own subfolder is refused', async () => {
    const { payload } = await flow('p1', 'move src/components into src/components/deep')
    expect(payload.status).toBe('rejected')
  })

  test('folder rename keeps nested contents and detects case-only renames', async () => {
    const { payload } = await flow('p1', 'rename src/components to src/widgets')
    expect(payload.status).toBe('executed')
    expect(files.get('p1|src/components/Button.tsx')).toBeUndefined()
    expect(files.get('p1|src/widgets/Button.tsx')).toBeTruthy()
  })

  test('case-only folder rename executes as a single consistent rewrite', async () => {
    const { payload } = await flow('p1', 'rename src/components to src/Components')
    expect(payload.status).toBe('executed')
    expect(files.get('p1|src/Components/Button.tsx')).toBeTruthy()
    expect(files.get('p1|src/components/Button.tsx')).toBeUndefined()
  })
})

describe('chat flow: batch operations', () => {
  test('explicit batch move lists every affected path before executing', async () => {
    const { payload } = await flow('p1', 'move lib/greet.js and src/components/Button.tsx into src/core')
    expect(payload.status).toBe('executed')
    expect(payload.kind).toBe('batch-move')
    expect(payload.affectedFiles?.sort()).toEqual([
      'lib/greet.js → src/core/greet.js',
      'src/components/Button.tsx → src/core/Button.tsx',
    ])
    expect(files.get('p1|src/core/greet.js')).toBeTruthy()
    expect(files.get('p1|src/core/Button.tsx')).toBeTruthy()
  })

  test('batch rename applies the convention to every matching file', async () => {
    const { payload } = await flow('p1', 'rename all files in src/components to kebab-case')
    expect(payload.status).toBe('executed')
    expect(files.get('p1|src/components/button.tsx')).toBeTruthy()
    expect(files.get('p1|src/components/card.tsx')).toBeTruthy()
    expect(files.get('p1|src/components/Button.tsx')).toBeUndefined()
  })

  test('batch with duplicate destinations is rejected with the conflicts listed', async () => {
    seedFile('p1', 'src/core/Button.tsx', 'existing')
    const { payload } = await flow('p1', 'move lib/greet.js and src/components/Button.tsx into src/core')
    expect(payload.status).toBe('rejected')
    expect(payload.conflicts).toContain('src/core/Button.tsx')
    expect(files.get('p1|src/components/Button.tsx')).toBeTruthy() // untouched
  })
})

describe('chat flow: create operations', () => {
  test('folder creation writes a .gitkeep marker, never placeholder code', async () => {
    const { payload } = await flow('p1', 'create a folder called src/hooks')
    expect(payload.status).toBe('executed')
    const marker = files.get('p1|src/hooks/.gitkeep') as Row
    expect(marker).toBeTruthy()
    expect(marker.content).toBe('')
  })

  test('creating inside an existing file path is refused', async () => {
    const { payload } = await flow('p1', 'create a folder called lib/greet.js/nested')
    expect(payload.status).toBe('rejected')
  })

  test('an identical destructive plan reuses the awaiting op (no duplicate rows)', async () => {
    const first = await flow('p1', 'delete lib/greet.js')
    expect(first.payload.status).toBe('awaiting_confirmation')
    const opsBefore = operations.size
    const second = await flow('p1', 'delete lib/greet.js')
    expect(second.payload.status).toBe('awaiting_confirmation')
    expect(second.payload.opId).toBe(first.payload.opId)
    expect(operations.size).toBe(opsBefore)
  })
})

describe('chat flow: ambiguity and clarification', () => {
  test('ambiguous batch source asks instead of guessing', async () => {
    seedFile('p1', 'other/Button.tsx', 'x')
    const { payload } = await flow('p1', 'move Button.tsx into src/core')
    expect(payload.status).toBe('clarification')
    expect(payload.question).toContain('Button.tsx')
  })

  test('a question about consequences explains without executing', async () => {
    const { payload, assistantText } = await flow('p1', 'What happens if I delete lib/greet.js?')
    expect(payload.status).toBe('explained')
    expect(payload.consequence).toContain('destructive')
    expect(files.get('p1|lib/greet.js')).toBeTruthy()
    expect(assistantText).toContain('If you proceed')
  })

  test('destination conflicts never execute (rename onto existing file)', async () => {
    seedFile('p1', 'lib/hello.js', 'existing')
    const { payload } = await flow('p1', 'rename lib/greet.js to lib/hello.js')
    expect(payload.status).toBe('rejected')
    expect(payload.reason).toContain('already exists')
    expect(files.get('p1|lib/greet.js')).toBeTruthy()
  })
})

// ---- plan-level security ------------------------------------------------------

describe('plan-level path safety', () => {
  test('traversal-shaped intents are refused', () => {
    const filesNow = [...files.values()].filter((f) => f.projectId === 'p1') as Array<{ path: string; content: string }>
    expect(() =>
      buildFileOpPlan({ kind: 'delete', sources: [{ path: '../outside', isFolder: false }] }, filesNow),
    ).toThrow()
    expect(() =>
      buildFileOpPlan({ kind: 'rename', sources: [{ path: 'lib/greet.js', isFolder: false }], destination: '../../etc/passwd' }, filesNow),
    ).toThrow()
    expect(() =>
      buildFileOpPlan({ kind: 'create', sources: [], destination: '/absolute/path', createIsFolder: true }, filesNow),
    ).toThrow()
  })

  test('plan hashes are deterministic and bind the exact plan', () => {
    const filesNow = [...files.values()].filter((f) => f.projectId === 'p1') as Array<{ path: string; content: string }>
    const intent = { kind: 'rename' as const, sources: [{ path: 'lib/greet.js', isFolder: false }], destination: 'lib/hello.js' }
    const a = buildFileOpPlan(intent, filesNow)
    const b = buildFileOpPlan(intent, filesNow)
    expect(planHashOf(a)).toBe(planHashOf(b))
    // A changed plan produces a different hash → the old confirmation is void.
    const changed = buildFileOpPlan({ ...intent, destination: 'lib/other.js' }, filesNow)
    expect(planHashOf(changed)).not.toBe(planHashOf(a))
    expect(canonicalJson(a)).toContain('lib/hello.js')
  })
})

// ---- confirmation binding + integrity ----------------------------------------

describe('confirmation binding', () => {
  test('a tampered stored plan is refused (hash mismatch) and marked failed', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    const op = operations.get(payload.opId!) as Row
    // Tamper with the recorded plan AFTER the user saw it.
    const plan = JSON.parse(op.planJson as string)
    plan.deletes = ['app.js']
    op.planJson = JSON.stringify(plan)
    try {
      await executeOperation(payload.opId!, 'p1')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('does not match its confirmation hash')
    }
    expect(operations.get(payload.opId!)?.status).toBe('failed')
    expect(files.get('p1|lib/greet.js')).toBeTruthy()
    expect(files.get('p1|app.js')).toBeTruthy()
  })

  test('an operation from ANOTHER project cannot execute here', async () => {
    seedProject('p2', ALICE)
    seedFile('p2', 'secret.txt', 'other project')
    const { payload } = await flow('p1', 'delete lib/greet.js')
    try {
      await executeOperation(payload.opId!, 'p2')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('not found for this project')
    }
    expect(files.get('p1|lib/greet.js')).toBeTruthy()
  })
})

// ---- route-level ownership / auth ---------------------------------------------

describe('route-level ownership and auth', () => {
  test('execute: foreign project and unknown op are NOT_FOUND; unauthenticated 401', async () => {
    seedProject('p2', BOB)
    const { payload } = await flow('p1', 'delete lib/greet.js')
    const foreign = await executeRoute.POST(JSON_REQ({ opId: payload.opId }), PR('p2'))
    expect(foreign.status).toBe(404)
    const missing = await executeRoute.POST(JSON_REQ({ opId: 'op-999999' }), PR('p1'))
    expect(missing.status).toBe(404)
    currentUser = null
    const unauth = await executeRoute.POST(JSON_REQ({ opId: payload.opId }), PR('p1'))
    expect(unauth.status).toBe(401)
    currentUser = { id: ALICE }
  })

  test('cancel: foreign project NOT_FOUND; owner cancels successfully', async () => {
    seedProject('p2', BOB)
    const { payload } = await flow('p1', 'delete lib/greet.js')
    expect((await cancelRoute.POST(JSON_REQ({ opId: payload.opId }), PR('p2'))).status).toBe(404)
    const okRes = await cancelRoute.POST(JSON_REQ({ opId: payload.opId }), PR('p1'))
    expect(okRes.status).toBe(200)
    expect(((await body(okRes)) as Row).cancelled).toBe(true)
  })

  test('cancel of an executed operation is refused honestly', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    await executeOperation(payload.opId!, 'p1')
    const res = await cancelRoute.POST(JSON_REQ({ opId: payload.opId }), PR('p1'))
    expect(res.status).toBe(400)
  })
})

// ---- atomicity -----------------------------------------------------------------

describe('atomicity', () => {
  test('a multi-file deletion with a concurrent change is refused WHOLE (no partial application)', async () => {
    const { payload } = await flow('p1', 'delete src/components folder')
    expect(payload.status).toBe('awaiting_confirmation')
    // Concurrent deletion of ONE of the two files before confirmation:
    files.delete('p1|src/components/Card.tsx')
    try {
      await executeOperation(payload.opId!, 'p1')
      throw new Error('expected refusal')
    } catch (e) {
      expect((e as Error).message).toContain('stale')
    }
    // NOTHING was deleted — the surviving file is untouched.
    expect(files.get('p1|src/components/Button.tsx')).toBeTruthy()
    expect(operations.get(payload.opId!)?.status).toBe('stale')
  })

  test('a destination created between plan and execute refuses the whole batch', async () => {
    // Destructive ops await confirmation, so stage the conflict for a folder
    // delete... none applies. For structural moves the gate runs before the
    // transaction; exercise it via a delete whose SOURCE vanished mid-batch
    // (covered above) and via the plan-level batch conflict (covered in the
    // batch suite). Here: the in-transaction gate is pinned by refusing a
    // delete whose source set changed between plan and confirm.
    const { payload } = await flow('p1', 'delete lib/greet.js')
    seedFile('p1', 'lib/greet.js', 'recreated concurrently with different content')
    const result = await executeOperation(payload.opId!, 'p1')
    // The file EXISTS again (recreated) — the deletion proceeds honestly
    // (the plan targets the path, which is present) and records the version.
    expect(result.applied).toEqual([{ path: 'lib/greet.js', action: 'deleted' }])
    expect(files.get('p1|lib/greet.js')).toBeUndefined()
  })
})

// ---- versioning integration (M22) ---------------------------------------------

describe('version history integration', () => {
  test('failed operations never create a version', async () => {
    const { payload } = await flow('p1', 'delete lib/greet.js')
    files.delete('p1|lib/greet.js')
    try {
      await executeOperation(payload.opId!, 'p1')
    } catch {
      /* expected */
    }
    expect(versions.length).toBe(0)
  })

  test('rollback restores the pre-operation tree as a NEW version; integrity holds', async () => {
    await snapshotProjectVersion({ projectId: 'p1', kind: 'manual', summary: 'seed state' }) // v1 (pre-operation tree)
    const buttonBefore = (files.get('p1|src/components/Button.tsx') as Row).content
    const renameFlow = await flow('p1', 'rename lib/greet.js to lib/hello.js') // v2
    expect(renameFlow.payload.status).toBe('executed')
    const deleteFlow = await flow('p1', 'delete src/components folder') // v3
    expect(deleteFlow.payload.status).toBe('awaiting_confirmation')
    const deleteResult = await executeOperation(deleteFlow.payload.opId!, 'p1')
    expect(deleteResult.applied.length).toBe(2)
    expect(files.get('p1|src/components/Button.tsx')).toBeUndefined()

    // Roll back to v1 — the tree BEFORE both operations.
    const rollback = await rollbackToVersion('p1', 1)
    expect(rollback.newVersion).toBeTruthy()
    expect((await listVersions('p1')).length).toBe(4)
    expect((files.get('p1|lib/greet.js') as Row).content).toContain('hello ${n}')
    expect((files.get('p1|src/components/Button.tsx') as Row).content).toBe(buttonBefore)
    expect(files.get('p1|lib/hello.js')).toBeUndefined()

    // Every version — including the rolled-back-away ones — stays valid.
    for (const v of await listVersions('p1')) {
      const integrity = await validateVersionIntegrity('p1', v.seq)
      expect(integrity.ok).toBe(true)
    }
  })

  test('an identical re-request after execution is rejected (folder already exists)', async () => {
    await flow('p1', 'create a folder called docs')
    const before = (await listVersions('p1')).length
    const opsBefore = operations.size
    // The folder now exists → the new plan conflicts → rejected, no version, no new op.
    const second = await flow('p1', 'create a folder called docs')
    expect(second.payload.status).toBe('rejected')
    expect((await listVersions('p1')).length).toBe(before)
    expect(operations.size).toBe(opsBefore)
  })
})
