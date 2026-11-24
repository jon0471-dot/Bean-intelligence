/**
 * M37 §5 — task progress + Trust receipts: the recorder turns REAL task
 * events into ledger rows (workflow planning evidence, delegation delivery
 * step, approval step), the SSE client passes task frames through, and the
 * UI files stay free of backend identities (customer-facing privacy).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- in-memory Prisma fake for the recorder ----------------------------------
const taskRows: Array<Record<string, unknown>> = []
const stepRows: Array<Record<string, unknown>> = []
const evidenceRows: Array<Record<string, unknown>> = []
const checkpointRows: Array<Record<string, unknown>> = []

function reset() {
  taskRows.length = 0
  stepRows.length = 0
  evidenceRows.length = 0
  checkpointRows.length = 0
}

function installDbFake() {
  mock.module('@/lib/db', () => ({
    db: {
      trustTask: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data, id: `task-${taskRows.length + 1}`, status: 'planned' }
          taskRows.push(row)
          return row
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          taskRows.find((r) => r.id === where.id) ?? null,
        findMany: async () => taskRows,
        updateMany: async ({ where, data }: { where: { id: string; status?: unknown }; data: Record<string, unknown> }) => {
          const row = taskRows.find((r) => r.id === where.id)
          if (!row) return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        },
      },
      trustStep: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `step-${stepRows.length + 1}`, status: 'planned', startedAt: null, finishedAt: null, errorNote: null, ...data }
          stepRows.push(row)
          return row
        },
        findFirst: async ({ where, orderBy }: { where: { taskId: string }; orderBy?: { seq: string } }) => {
          const rows = stepRows.filter((r) => r.taskId === where.taskId)
          return rows[rows.length - 1] ?? null
        },
        findUnique: async ({ where }: { where: { taskId_seq: { taskId: string; seq: number } } }) =>
          stepRows.find((r) => r.taskId === where.taskId_seq.taskId && r.seq === where.taskId_seq.seq) ?? null,
        findMany: async ({ where }: { where: { taskId: string } }) =>
          stepRows.filter((r) => r.taskId === where.taskId).sort((a, b) => (a.seq as number) - (b.seq as number)),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = stepRows.find((r) => r.id === where.id)
          if (row) Object.assign(row, data)
          return row
        },
      },
      trustEvidence: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evidenceRows.push({ ...data, createdAt: new Date() })
          return data
        },
        count: async () => evidenceRows.length,
      },
      trustCheckpoint: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          checkpointRows.push(data)
          return data
        },
        findFirst: async () => checkpointRows[checkpointRows.length - 1] ?? null,
        updateMany: async () => ({ count: 0 }),
      },
      trustApproval: { count: async () => 0 },
      trustCheckpointCounter: undefined,
    },
  }))
  mock.module('@/lib/trust/resume', () => ({
    registerResumableKind: () => undefined,
    writeResumeCheckpoint: async () => undefined,
  }))
}

beforeEach(reset)
installDbFake()

const { createRiisheTurnRecorder } = await import('../../src/lib/trust/adapters/riishe')

describe('M37 recorder — task events become REAL ledger rows', () => {
  test('begin() plans the four orchestration steps; a planning event records workflow evidence', async () => {
    const rec = createRiisheTurnRecorder({ userId: 'u1', message: 'Research and build a landing page', conversationId: 'c1' })
    await rec.begin()
    rec.onTaskEvent({ stage: 'planning', detail: 'research+coding' })
    await new Promise((r) => setTimeout(r, 20))
    expect(taskRows).toHaveLength(1)
    const kinds = stepRows.map((s) => s.kind)
    expect(kinds).toEqual(['retrieval', 'tool', 'generation', 'verification'])
    const wfEvidence = evidenceRows.find((e) => e.ref === 'workflow-plan')
    expect(wfEvidence).toBeDefined()
    expect(wfEvidence!.kind).toBe('measurement')
    expect((wfEvidence!.note as string).toLowerCase()).toContain('research+coding')
    // Nothing invented: no delivery/approval steps before real events.
    expect(stepRows.some((s) => s.kind === 'delivery')).toBe(false)
    expect(stepRows.some((s) => s.kind === 'approval')).toBe(false)
  })

  test('a delegating event appends a delivery step (running), settled on completion', async () => {
    const rec = createRiisheTurnRecorder({ userId: 'u1', message: 'Build the page', conversationId: 'c1' })
    await rec.begin()
    rec.onTaskEvent({ stage: 'delegating', detail: 'job queued' })
    await new Promise((r) => setTimeout(r, 20))
    const delivery = stepRows.find((s) => s.kind === 'delivery')
    expect(delivery).toBeDefined()
    expect(delivery!.status).toBe('running')
    expect(delivery!.seq).toBe(5) // after the four fixed orchestration steps
    await rec.complete(
      { metadata: { states: ['VERIFIED_FROM_SOURCES'], degraded: [], sources: [{ url: 'https://example.com', title: 'Example', hostName: 'example.com' }], toolRuns: [{ tool: 'delegate_coding', ok: true, durationMs: 12 }] } },
      { persisted: true },
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(stepRows.find((s) => s.kind === 'delivery')!.status).toBe('done')
    // The delegation tool execution is recorded as tool-output evidence.
    expect(evidenceRows.some((e) => e.kind === 'tool-output' && e.ref === 'delegate_coding')).toBe(true)
  })

  test('an approval-waiting event appends an approval step (never skipped silently)', async () => {
    const rec = createRiisheTurnRecorder({ userId: 'u1', message: 'Build and check', conversationId: 'c1' })
    await rec.begin()
    rec.onTaskEvent({ stage: 'approval-waiting' })
    await new Promise((r) => setTimeout(r, 20))
    const approval = stepRows.find((s) => s.kind === 'approval')
    expect(approval).toBeDefined()
    expect(approval!.status).toBe('running')
  })

  test('cancelled: delegation and approval steps settle as skipped (honest ledger)', async () => {
    const rec = createRiisheTurnRecorder({ userId: 'u1', message: 'Build and cancel', conversationId: 'c1' })
    await rec.begin()
    rec.onTaskEvent({ stage: 'delegating' })
    rec.onTaskEvent({ stage: 'approval-waiting' })
    await new Promise((r) => setTimeout(r, 20))
    await rec.cancelled()
    await new Promise((r) => setTimeout(r, 20))
    expect(stepRows.find((s) => s.kind === 'delivery')!.status).toBe('skipped')
    expect(stepRows.find((s) => s.kind === 'approval')!.status).toBe('skipped')
    const task = taskRows[0]
    expect(task['status']).toBe('cancelled')
  })

  test('ordinary turns without task events produce NO extra steps (no receipt noise)', async () => {
    const rec = createRiisheTurnRecorder({ userId: 'u1', message: 'plain question', conversationId: 'c1' })
    await rec.begin()
    await rec.complete({ metadata: { states: ['UNVERIFIED'], degraded: [] } }, { persisted: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(stepRows.some((s) => s.kind === 'delivery' || s.kind === 'approval')).toBe(false)
    expect(evidenceRows.some((e) => e.ref === 'workflow-plan')).toBe(false)
  })
})

describe('M37 SSE wire — task frames pass through the client parser', () => {
  test('a task frame is parsed as { task: { stage, detail } }', async () => {
    const { createSseFrameParser } = await import('../../src/lib/riishe/sse-client')
    const parser = createSseFrameParser()
    const events = parser.push('data: {"task": {"stage": "delegating", "detail": "job queued"}}\n\ndata: {"task": {"stage": "completed-with-limitations"}}\n\n')
    expect(events).toHaveLength(2)
    expect(events[0].task).toEqual({ stage: 'delegating', detail: 'job queued' })
    expect(events[1].task).toEqual({ stage: 'completed-with-limitations' })
  })
})

describe('M37 UI privacy — progress display stays free of backend identities', () => {
  test('riishe-messages.tsx and use-riishe-chat.ts expose no backend/model identities', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const base = path.join(import.meta.dir, '..', 'src', 'components', 'bean', 'riishe')
    const files = ['riishe-messages.tsx', 'use-riishe-chat.ts', 'riishe-composer.tsx']
    const forbidden = ['bean-llm', 'bean-gpt', 'gpt-4', 'gpt-5', 'claude', 'gemini', 'deepseek', 'qwen', 'openai', 'anthropic', 'z-ai', 'provider', 'model-id', 'backend-id']
    for (const f of files) {
      const text = fs.readFileSync(path.join(base, f), 'utf8').toLowerCase()
      for (const token of forbidden) {
        expect({ file: f, token, found: text.includes(token) }).toEqual({ file: f, token, found: false })
      }
    }
  })

  test('the live stage labels are operational only (no identities) and cover the M37 stages', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'components', 'bean', 'riishe', 'riishe-messages.tsx'), 'utf8')
    for (const label of ['Planning', 'Reading documents', 'Delegating', 'Waiting for approval', 'Executing']) {
      expect(text).toContain(label)
    }
  })
})
