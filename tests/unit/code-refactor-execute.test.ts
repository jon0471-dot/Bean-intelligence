/**
 * BEAN Intelligence — CODE GIFTZ refactoring execution tests (M25).
 *
 * Pins the atomic-execution contract over a fully mocked Prisma boundary
 * (self-contained in-memory fake — no test touches the real DB):
 *  - execution applies EVERY planned mutation in ONE transaction and records
 *    exactly ONE version (kind 'refactor') on success;
 *  - replay: an executed operation returns its recorded result verbatim
 *    (replayed:true) and never mutates twice;
 *  - staleness: a plan whose `before` content no longer matches the live
 *    workspace is refused and NOTHING is applied (ledger → stale);
 *  - hash tampering: a stored plan whose bytes no longer match its
 *    confirmation hash is refused;
 *  - failure: an exception mid-transaction rolls back completely, the ledger
 *    records 'failed', and NO version is snapshotted;
 *  - post-execution verification: content preservation, unresolved-import
 *    count and duplicate-export detection over the new file set;
 *  - cancel: a cancelled operation refuses execution.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- in-memory fake of the Prisma boundary (the ONLY mocked boundary) ------

interface FileRow {
  id: string
  projectId: string
  path: string
  content: string
  origin: string
  updatedAt: Date
}
interface OpRow {
  id: string
  projectId: string
  kind: string
  status: string
  planJson: string
  planHash: string
  resultJson: string | null
  createdAt: Date
  executedAt: Date | null
}
interface VersionRow {
  id: string
  projectId: string
  seq: number
  kind: string
}

let files = new Map<string, FileRow>()
let ops = new Map<string, OpRow>()
let versions: VersionRow[] = []
let idCounter = 0
let snapshotCalls = 0
let failMidTransaction = false

function reset() {
  files = new Map()
  ops = new Map()
  versions = []
  idCounter = 0
  snapshotCalls = 0
  failMidTransaction = false
}

function seedFile(projectId: string, path: string, content: string): FileRow {
  const row: FileRow = { id: `file-${++idCounter}`, projectId, path, content, origin: 'generated', updatedAt: new Date() }
  files.set(`${projectId}|${path}`, row)
  return row
}

const fakeDb = {
  codeFile: {
    async findMany({ where }: { where: { projectId: string } }) {
      return [...files.values()]
        .filter((f) => f.projectId === where.projectId)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    },
    async create({ data }: { data: { projectId: string; path: string; content: string; origin?: string } }) {
      const row: FileRow = { id: `file-${++idCounter}`, projectId: data.projectId, path: data.path, content: data.content, origin: data.origin ?? 'generated', updatedAt: new Date() }
      files.set(`${row.projectId}|${row.path}`, row)
      return row
    },
    async update({ where, data }: { where: { id: string }; data: { content?: string; path?: string } }) {
      for (const row of files.values()) {
        if (row.id === where.id) {
          if (data.content !== undefined) row.content = data.content
          if (data.path !== undefined) {
            files.delete(`${row.projectId}|${row.path}`)
            row.path = data.path
            files.set(`${row.projectId}|${row.path}`, row)
          }
          row.updatedAt = new Date()
          return row
        }
      }
      throw new Error('file row not found')
    },
  },
  codeFileOperation: {
    async findUnique({ where }: { where: { id: string } }) {
      return ops.get(where.id) ?? null
    },
    async findFirst({ where }: { where: { projectId: string; planHash: string; status: string } }) {
      for (const row of ops.values()) {
        if (row.projectId === where.projectId && row.planHash === where.planHash && row.status === where.status) return row
      }
      return null
    },
    async create({ data }: { data: { projectId: string; kind: string; status: string; planJson: string; planHash: string } }) {
      const row: OpRow = {
        id: `op-${++idCounter}`,
        projectId: data.projectId,
        kind: data.kind,
        status: data.status,
        planJson: data.planJson,
        planHash: data.planHash,
        resultJson: null,
        createdAt: new Date(),
        executedAt: null,
      }
      ops.set(row.id, row)
      return row
    },
    async update({ where, data }: { where: { id: string }; data: { status?: string; resultJson?: string | null; executedAt?: Date | null } }) {
      const row = ops.get(where.id)
      if (!row) throw new Error('operation row not found')
      if (data.status !== undefined) row.status = data.status
      if (data.resultJson !== undefined) row.resultJson = data.resultJson
      if (data.executedAt !== undefined) row.executedAt = data.executedAt
      return row
    },
  },
  async $transaction(fn: (tx: typeof fakeDb) => Promise<void>) {
    const backupFiles = new Map(files)
    try {
      if (failMidTransaction) throw new Error('simulated mid-transaction failure')
      await fn(fakeDb)
    } catch (e) {
      files = backupFiles // rollback: nothing applied
      throw e
    }
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/observability/logger', () => ({
  // M26: handle() now also pulls withRequestContext/currentRequestId from
  // this module — the fake must provide the full consumed surface.
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  withRequestContext: async <T,>(ctx: unknown, fn: () => Promise<T>) => fn(),
  currentRequestId: () => null,
  redact: (v: string) => v,
}))
mock.module('@/lib/code/versioning', () => ({
  snapshotProjectVersion: async (input: { projectId: string; kind: string; summary?: string }) => {
    snapshotCalls += 1
    const seq = versions.length + 1
    versions.push({ id: `v-${seq}`, projectId: input.projectId, seq, kind: input.kind })
    return { created: true, version: { id: `v-${seq}`, seq, kind: input.kind, summary: input.summary ?? null, fileCount: files.size, contentHash: 'x', changedFiles: [], createdAt: new Date().toISOString() } }
  },
}))

const { createRefactorOperation, executeRefactorOperation } = await import('../../src/lib/code/refactoring/execute')
const { planRenameSymbol, refactorPlanHashOf } = await import('../../src/lib/code/refactoring/plan')
const { FileOpError } = await import('../../src/lib/code/file-ops/types')

const PID = 'p1'
const FILES = [
  { path: 'src/utils/format.ts', content: 'export function formatValue(n: number) {\n  return String(n)\n}' },
  { path: 'src/app.tsx', content: "import { formatValue } from './utils/format'\nexport const label = formatValue(2)" },
]

describe('M25 refactor execution', () => {
  beforeEach(reset)

  async function seedAndPlan() {
    for (const f of FILES) seedFile(PID, f.path, f.content)
    const plan = planRenameSymbol(FILES, { symbol: 'formatValue', newName: 'money' })
    const { opId, planHash } = await createRefactorOperation(PID, plan)
    return { plan, opId, planHash }
  }

  test('happy path: atomic apply + ONE refactor version + honest verification', async () => {
    const { opId } = await seedAndPlan()
    const result = await executeRefactorOperation(opId, PID)
    expect(result.status).toBe('executed')
    expect(result.replayed).toBeUndefined()
    expect(result.applied).toHaveLength(2)
    expect(result.versionSeq).toBe(1)
    expect(snapshotCalls).toBe(1)
    const after = await fakeDb.codeFile.findMany({ where: { projectId: PID } })
    const byPath = new Map(after.map((f) => [f.path, f.content]))
    expect(byPath.get('src/utils/format.ts')).toContain('export function money(')
    expect(byPath.get('src/app.tsx')).toContain("import { money } from './utils/format'")
    expect(result.verification.contentsPreserved).toBe(true)
    expect(result.verification.unresolvedImports).toBe(0)
  })

  test('replay returns the recorded result and does not mutate twice', async () => {
    const { opId } = await seedAndPlan()
    const first = await executeRefactorOperation(opId, PID)
    snapshotCalls = 0
    const second = await executeRefactorOperation(opId, PID)
    expect(second.replayed).toBe(true)
    expect(second.applied).toEqual(first.applied)
    expect(snapshotCalls).toBe(0)
    const after = await fakeDb.codeFile.findMany({ where: { projectId: PID } })
    expect(after.filter((f) => f.content.includes('money(')).length).toBe(2)
  })

  test('stale plan (concurrent content change) refuses with NOTHING applied', async () => {
    const { opId } = await seedAndPlan()
    // Concurrent edit AFTER the plan was created.
    const row = [...files.values()].find((f) => f.path === 'src/utils/format.ts')!
    row.content = row.content + '\n// concurrent edit'
    await expect(executeRefactorOperation(opId, PID)).rejects.toThrow(/no longer matches the project/)
    const op = ops.get(opId)!
    expect(op.status).toBe('stale')
    const after = await fakeDb.codeFile.findMany({ where: { projectId: PID } })
    expect(after.find((f) => f.path === 'src/utils/format.ts')!.content).toContain('// concurrent edit')
    expect(after.find((f) => f.path === 'src/utils/format.ts')!.content).toContain('formatValue')
    expect(snapshotCalls).toBe(0)
    expect(versions).toHaveLength(0)
  })

  test('hash tampering on the stored plan is refused', async () => {
    const { plan, opId } = await seedAndPlan()
    const op = ops.get(opId)!
    const tamperedPlan = { ...plan, title: 'tampered title' }
    op.planJson = JSON.stringify(tamperedPlan)
    await expect(executeRefactorOperation(opId, PID)).rejects.toThrow(/confirmation hash/)
    expect(op.status).toBe('failed')
    expect(snapshotCalls).toBe(0)
  })

  test('plan hash recomputation binds the exact stored plan', async () => {
    const { plan, planHash } = await seedAndPlan()
    expect(refactorPlanHashOf(plan)).toBe(planHash)
  })

  test('mid-transaction failure rolls back completely and records failure — no snapshot', async () => {
    const { opId } = await seedAndPlan()
    failMidTransaction = true
    await expect(executeRefactorOperation(opId, PID)).rejects.toThrow(/rolled back completely/)
    failMidTransaction = false
    const op = ops.get(opId)!
    expect(op.status).toBe('failed')
    expect(snapshotCalls).toBe(0)
    expect(versions).toHaveLength(0)
    const after = await fakeDb.codeFile.findMany({ where: { projectId: PID } })
    expect(after.find((f) => f.path === 'src/utils/format.ts')!.content).toContain('formatValue')
  })

  test('cancelled operation refuses execution', async () => {
    const { opId } = await seedAndPlan()
    ops.get(opId)!.status = 'cancelled'
    await expect(executeRefactorOperation(opId, PID)).rejects.toThrow(/cancelled/)
    expect(snapshotCalls).toBe(0)
  })

  test('non-refactor rows are refused by the refactor executor', async () => {
    reset()
    const row: OpRow = {
      id: 'op-x', projectId: PID, kind: 'rename', status: 'awaiting_confirmation',
      planJson: '{}', planHash: 'h', resultJson: null, createdAt: new Date(), executedAt: null,
    }
    ops.set(row.id, row)
    await expect(executeRefactorOperation('op-x', PID)).rejects.toThrow(/not a refactoring/)
  })

  test('duplicate exports and unresolved imports are counted honestly after execution', async () => {
    const base: Array<{ path: string; content: string }> = [
      { path: 'src/a.ts', content: 'export const thing = 1' },
      { path: 'src/b.ts', content: "import { thing } from './a'\nexport const label = 'b'" },
    ]
    for (const f of base) seedFile(PID, f.path, f.content)
    // A MODIFY that introduces a duplicate export (validation only blocks
    // CREATED files for collisions — the post-execution pass catches this).
    const plan = {
      planVersion: 1 as const,
      kind: 'extract-module' as const,
      title: 't',
      reason: 'r',
      engine: 'provider-assisted' as const,
      steps: [],
      edits: [
        {
          path: 'src/b.ts',
          before: base[1].content,
          after: "import { thing } from './a'\nexport const thing = 2\nexport const label = 'b'",
          changeType: 'modify' as const,
        },
      ],
      moves: [],
      createdPaths: [],
      scopeFiles: ['src/a.ts', 'src/b.ts'],
      risks: [],
      unresolved: [],
      notes: [],
      sourceHashes: { 'src/b.ts': 'ignored' },
      affectedTests: [],
      requiresConfirmation: true as const,
    }
    const { opId } = await createRefactorOperation(PID, plan)
    const result = await executeRefactorOperation(opId, PID)
    expect(result.verification.duplicateExports.some((d) => d.name === 'thing')).toBe(true)
    expect(result.verification.contentsPreserved).toBe(true)
  })
})
