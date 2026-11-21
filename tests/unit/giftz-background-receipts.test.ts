/**
 * TRUST SPECIALIST COVERAGE — CODE GIFTZ background coding-turn receipts.
 *
 * The background coding handler runs the REAL turn core (continuation,
 * self-verification hook, file-fence extraction with real diffs, workspace
 * application) over an in-memory database. Pinned receipt behavior:
 *
 *  - success → the receipt settles from the ACTUAL result: applied files as
 *    evidence, the version reference, and the self-verification outcome —
 *    verification disabled ⇒ completed_with_limitations, never plain done;
 *  - upstream failure BEFORE the apply stage ⇒ failed, and the receipt states
 *    that no workspace change was applied (established, not guessed);
 *  - failure DURING the apply stage ⇒ failed with the mutations that DID
 *    land recorded as evidence (the workspace is never claimed untouched);
 *  - cancellation observed AFTER the turn applied its files ⇒ cancelled WITH
 *    the applied mutations kept visible (cancellation never erases them).
 *
 * The receipt system under test is the SHARED Trust Engine (same tasks.ts
 * lifecycle as every other specialist) — no second receipt system exists.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

// ---- in-memory Prisma fake -------------------------------------------------
const rows = {
  codeProject: [] as Array<Record<string, unknown>>,
  codeMessage: [] as Array<Record<string, unknown>>,
  codeFile: [] as Array<Record<string, unknown>>,
  generationJob: [] as Array<Record<string, unknown>>,
  usageRecord: [] as Array<Record<string, unknown>>,
  auditLog: [] as Array<Record<string, unknown>>,
}
let cancelAnswer = false

const trust = createTrustFakeDb()

function fakeTable(name: keyof typeof rows, defaults: () => Record<string, unknown> = () => ({})) {
  return {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `fake_${name}_${rows[name].length + 1}`, ...defaults(), ...data }
      rows[name].push(row)
      return row
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows[name].find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null,
    findMany: async ({ where, orderBy, take }: { where?: Record<string, unknown>; orderBy?: Record<string, string>; take?: number } = {}) => {
      let out = rows[name].filter((r) =>
        where ? Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object' && 'not' in (v as Record<string, unknown>)) {
            return (r as Record<string, unknown>)[k] !== (v as Record<string, unknown>).not
          }
          return (r as Record<string, unknown>)[k] === v
        }) : true,
      )
      if (orderBy && orderBy.createdAt === 'desc') out = [...out].reverse()
      if (orderBy && orderBy.path === 'asc') out = [...out].sort((a, b) => String(a.path).localeCompare(String(b.path)))
      if (orderBy && orderBy.createdAt === 'asc') out = [...out].reverse().reverse()
      return typeof take === 'number' ? out.slice(0, take) : out
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows[name].find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
      if (!row) throw new Error(`fake: ${name} update target not found`)
      Object.assign(row, data)
      return row
    },
  }
}

const fakeDb = {
  codeProject: fakeTable('codeProject'),
  codeMessage: fakeTable('codeMessage'),
  codeFile: fakeTable('codeFile', () => ({ origin: 'generated', content: '' })),
  codeVersion: {
    findFirst: async () => null,
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'fake_version', seq: 1, ...data }),
  },
  codeBlob: { findUnique: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'fake_blob', ...data }) },
  generationJob: {
    ...fakeTable('generationJob'),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const target = rows.generationJob.find((r) => Object.entries(where).every(([k, v]) => {
        if (k === 'status' && v && typeof v === 'object' && Array.isArray((v as { in?: string[] }).in)) {
          return (v as { in?: string[] }).in!.includes(r.status as string)
        }
        if (k === 'workerId' || k === 'id') return (r as Record<string, unknown>)[k] === v
        return true
      }))
      if (!target) return { count: 0 }
      Object.assign(target, data)
      return { count: 1 }
    },
  },
  usageRecord: { count: async () => 0, create: async ({ data }: { data: Record<string, unknown> }) => (rows.usageRecord.push(data), data) },
  auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => (rows.auditLog.push(data), data) },
  document: { findMany: async () => [] },
  ...trust.fakeDb,
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- engine collaborators ---------------------------------------------------
let streamScript: Array<() => AsyncGenerator<string>> = []

mock.module('@/lib/router/router', () => ({
  resolveBackgroundAdapter: async () => ({
    adapter: {
      chatStream: async function* () {
        const make = streamScript[0]
        if (!make) throw new Error('no scripted stream')
        yield* make()
      },
    },
    backend: { id: 'be-code', timeouts: { requestMs: 30_000 }, limits: { maxPromptChars: 12_000 } },
    servedBy: { backendId: 'be-code' },
  }),
}))
mock.module('@/lib/ai-engine/queue', () => ({
  isCancelRequested: async () => cancelAnswer,
  transitionJob: async () => undefined,
}))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async () => undefined,
  appendJobEvent: async () => undefined,
}))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))
mock.module('@/lib/verification/config', () => ({
  verificationConfig: async () => ({ enabled: false, verificationModel: null, maxAttempts: 2, regenerationLimit: 1, minConfidence: 0.6, maxInputChars: 8000 }),
}))
mock.module('@/lib/intel/techdocs-reach', () => ({
  buildTechDocsWithReach: async () => ({ techDocs: null, research: undefined }),
}))

const { handleGiftzCodingJob } = await import('../../src/lib/ai-engine/giftz-coding-handler')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
const { WorkspaceApplyError } = await import('../../src/lib/giftz/workspace')

const OWNER = 'user-giftz'
const PROJECT = 'proj-giftz'
/** Live view of the handler's cooperative-cancel signal (engine abort contract). */
const signalState = { aborted: false }

function turnContent(paths: Array<{ path: string; content: string }>): string {
  return (
    'Here is the change.\n\n' +
    paths.map((p) => '```js path=' + p.path + '\n' + p.content + '\n```').join('\n\n')
  )
}

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-giftz-1',
    userId: OWNER,
    product: 'code-giftz',
    task: 'coding-task',
    status: 'running',
    workerId: 'worker-claim-3',
    paramsJson: JSON.stringify({ message: 'add a hello file', projectId: PROJECT }),
    resultJson: null,
    ...overrides,
  } as Record<string, unknown>
}

async function seedProject(): Promise<void> {
  await fakeDb.codeProject.create({ data: { id: PROJECT, userId: OWNER, title: 'Hello Console' } })
  await fakeDb.codeMessage.create({ data: { id: 'msg-user-1', projectId: PROJECT, role: 'user', content: 'add a hello file' } })
  await fakeDb.generationJob.create({ data: makeJob() })
}

beforeEach(async () => {
  for (const list of Object.values(rows)) list.length = 0
  cancelAnswer = false
  signalState.aborted = false
  streamScript = []
  trust.reset()
  await seedProject()
})

describe('CODE GIFTZ background receipts (shared Trust Engine)', () => {
  test('successful turn: receipt settles from the actual result; verification disabled stays limited', async () => {
    streamScript.push(async function* () {
      yield turnContent([{ path: 'main.js', content: "console.log('hello BEAN')\n" }])
    })
    const outcome = await handleGiftzCodingJob(makeJob() as never, { signal: { aborted: false } })
    expect(outcome.errorClass).toBeUndefined()
    const task = trust.trustTask.rows.find((t) => t.kind === 'coding-task')
    expect(task).toBeTruthy()
    const receipt = await composeTrustReceipt(task!.id as string, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.toLowerCase().includes('self-verification did not run'))).toBe(true)
    expect(receipt!.task.verificationSummary).toContain('did not run')
    // the applied mutation is real evidence, bound to the file path
    const fileEvidence = receipt!.evidence.find((e) => e.ref === 'code-file:main.js')
    expect(fileEvidence).toBeTruthy()
    expect(fileEvidence!.title).toContain('added main.js')
    // the turn actually mutated the workspace
    const file = rows.codeFile.find((f) => f.path === 'main.js')
    expect(file).toBeTruthy()
    expect((file as Record<string, unknown>).content).toContain('hello BEAN')
    // the delivery step records the applied mutations + version reference
    const delivery = receipt!.steps.find((s) => s.title.includes('Workspace persistence'))!
    expect(delivery.status).toBe('done')
    expect(delivery.detail).toBeTruthy()
  })

  test('upstream failure before the apply stage: failed receipt, untouched workspace stated', async () => {
    streamScript.push(async function* () {
      yield 'starting the work…'
      throw new Error('gateway socket exploded before finishing')
    })
    const outcome = await handleGiftzCodingJob(makeJob() as never, { signal: { aborted: false } })
    expect(outcome.errorCode).toBeTruthy()
    const task = trust.trustTask.rows.find((t) => t.kind === 'coding-task')!
    const receipt = await composeTrustReceipt(task.id as string, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('No workspace changes were applied')
    expect(receipt!.task.limitations.some((l) => l.includes('failed before any workspace change was applied'))).toBe(true)
    expect(rows.codeFile.length).toBe(0)
  })

  test('failure during the apply stage: the mutations that DID land stay visible', async () => {
    const unsafe = '../escape.js'
    streamScript.push(async function* () {
      yield turnContent([
        { path: 'main.js', content: "console.log('first')\n" },
        { path: unsafe, content: 'evil\n' },
      ])
    })
    const outcome = await handleGiftzCodingJob(makeJob() as never, { signal: { aborted: false } })
    expect(outcome.errorCode).toBeTruthy()
    expect(rows.codeFile.length).toBe(1) // the FIRST file was applied, then the loop refused the unsafe path
    const task = trust.trustTask.rows.find((t) => t.kind === 'coding-task')!
    const receipt = await composeTrustReceipt(task.id as string, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('already applied')
    expect(receipt!.task.failureNote).toContain('main.js')
    const appliedEvidence = receipt!.evidence.find((e) => e.ref === 'code-file:main.js')
    expect(appliedEvidence).toBeTruthy()
    expect(receipt!.task.limitations.some((l) => l.includes('failed after applying 1 workspace change'))).toBe(true)
  })

  test('cancel observed AFTER the turn applied files: cancelled receipt keeps the mutations visible', async () => {
    streamScript.push(async function* () {
      yield turnContent([{ path: 'main.js', content: "console.log('cancelled late')\n" }])
      // The engine aborts the cooperative signal after the stream completes;
      // the turn still finishes and applies its files before the flag is read.
      signalState.aborted = true
    })
    const outcome = await handleGiftzCodingJob(makeJob() as never, { signal: signalState })
    expect(outcome.result).toBeDefined()
    const jobRow = rows.generationJob[0]
    expect(jobRow.status).toBe('cancelled')
    const task = trust.trustTask.rows.find((t) => t.kind === 'coding-task')!
    const receipt = await composeTrustReceipt(task.id as string, OWNER)
    expect(receipt!.task.status).toBe('cancelled')
    expect(receipt!.task.failureNote).toContain('already applied 1 workspace change')
    expect(receipt!.task.failureNote).toContain('main.js')
    expect(receipt!.task.failureNote).toContain('remain in the workspace')
    expect(rows.codeFile.length).toBe(1)
  })

  test('cancel during generation: cancelled receipt with NO applied changes', async () => {
    const { ClientDisconnectedError } = await import('../../src/lib/giftz/chat-stream')
    streamScript.push(async function* () {
      yield 'partial thought'
      // The engine aborted the signal mid-generation; the guard throws the
      // typed disconnect — the EXACT production unwind (guard-aborted throw).
      signalState.aborted = true
      throw new ClientDisconnectedError()
    })
    const outcome = await handleGiftzCodingJob(makeJob() as never, { signal: signalState })
    expect(outcome.result).toBeDefined()
    const jobRow = rows.generationJob[0]
    expect(jobRow.status).toBe('cancelled')
    const task = trust.trustTask.rows.find((t) => t.kind === 'coding-task')!
    const receipt = await composeTrustReceipt(task.id as string, OWNER)
    expect(receipt!.task.status).toBe('cancelled')
    expect(receipt!.task.failureNote).toContain('No workspace changes were applied')
    expect(rows.codeFile.length).toBe(0)
  })
})

describe('workspace apply truth (WorkspaceApplyError)', () => {
  test('the error carries the mutations applied before the failure', async () => {
    // Direct unit proof of the contract the receipt relies on.
    await fakeDb.codeProject.create({ data: { id: 'proj-apply', userId: OWNER, title: 'x' } })
    const { applyFiles } = await import('../../src/lib/giftz/workspace')
    let caught: WorkspaceApplyError | null = null
    try {
      await applyFiles('proj-apply', [
        { path: 'ok.js', content: 'console.log(1)\n' },
        { path: '../bad.js', content: 'x' },
      ])
    } catch (e) {
      caught = e as WorkspaceApplyError
    }
    expect(caught).toBeInstanceOf(WorkspaceApplyError)
    expect(caught!.appliedSoFar.length).toBe(1)
    expect(caught!.appliedSoFar[0].path).toBe('ok.js')
    expect(caught!.failedPath).toBe('../bad.js')
  })
})
