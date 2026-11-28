/**
 * P0 R2 — EARLY CONVERSATION ID + ROBUST DEAD-WIRE RECOVERY tests.
 *
 * Owner-rejected failure being fixed: for a NEW conversation, an early
 * connection loss used to leave the client without the conversation ID (the
 * key its dead-wire recovery needs), so a server-completed persisted answer
 * became unreachable and the user saw a connection error instead of their
 * finished answer.
 *
 * Pinned contracts (hermetic — real route handler + real SSE writer with the
 * Prisma boundary faked, same idiom as riishe-chat-slot-release.test.ts):
 *  1. the FIRST valid data event carries the conversation ID, before any
 *     research/model/tool work; the `: connected` comment stays; the rest of
 *     the wire protocol is unchanged;
 *  2. the client SSE parser passes a conversationId-only event through
 *     onEvent and never mistakes it for completion;
 *  3. when the client disconnects early, the server STILL completes and
 *     persists exactly ONE user row + ONE assistant row (no duplicates);
 *  4. the recovery schedule is BOUNDED (four attempts, ~68s window sized
 *     from the 90s server request timeout; never infinite polling);
 *  5. adoption refuses a persisted answer that is not THIS turn's
 *     (never another turn's answer, never a fabricated reconciliation).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controlled session ------------------------------------------------------
let currentUserId = 'user-p0r2'
mock.module('@/lib/auth/session', () => ({
  requireUser: async () => {
    const { BeanApiError } = await import('@/lib/api/errors')
    if (!currentUserId) throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    return { id: currentUserId, email: `${currentUserId}@example.test`, name: 'P0 R2', role: 'member' as const }
  },
}))

// ---- fake Prisma boundary -----------------------------------------------------
interface MsgRow { id: string; conversationId: string; role: string; content: string; createdAt: Date }
const convs: Array<{ id: string; userId: string; title: string; summary: string | null; summaryCount: number }> = []
const msgs: MsgRow[] = []
let idSeq = 0
function resetDb(): void {
  convs.length = 0
  msgs.length = 0
  idSeq = 0
}
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${idSeq}`
}
const dbFake = {
  conversation: {
    findUnique: async ({ where }: { where: { id: string } }) => convs.find((c) => c.id === where.id) ?? null,
    create: async ({ data }: { data: { userId: string; title: string } }) => {
      const row = { id: nextId('conv'), userId: data.userId, title: data.title, summary: null, summaryCount: 0 }
      convs.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = convs.find((c) => c.id === where.id)
      if (row) Object.assign(row, data)
      return row ?? null
    },
  },
  message: {
    findFirst: async ({ where, orderBy }: { where: { conversationId: string }; orderBy?: { createdAt: string } }) => {
      const rows = msgs.filter((m) => m.conversationId === where.conversationId)
      const sorted = orderBy?.createdAt === 'desc' ? [...rows].reverse() : rows
      return sorted[0] ?? null
    },
    findMany: async ({ where, orderBy, take }: { where: { conversationId: string }; orderBy?: { createdAt: string }; take?: number }) => {
      const rows = msgs.filter((m) => m.conversationId === where.conversationId)
      const sorted = orderBy?.createdAt === 'desc' ? [...rows].reverse() : rows
      const limited = typeof take === 'number' ? sorted.slice(0, take) : sorted
      return limited.map((m) => ({ ...m }))
    },
    count: async ({ where }: { where: { conversationId: string } }) => msgs.filter((m) => m.conversationId === where.conversationId).length,
    create: async ({ data }: { data: { conversationId: string; role: string; content: string } }) => {
      const row: MsgRow = { id: nextId('msg'), ...data, createdAt: new Date() }
      msgs.push(row)
      return { ...row }
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const idx = msgs.findIndex((m) => m.id === where.id)
      if (idx >= 0) msgs.splice(idx, 1)
      return {}
    },
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      let count = 0
      for (const id of where.id.in) {
        const idx = msgs.findIndex((m) => m.id === id)
        if (idx >= 0) {
          msgs.splice(idx, 1)
          count += 1
        }
      }
      return { count }
    },
  },
  document: { findMany: async () => [] },
  usageRecord: { count: async () => 0, create: async () => ({}), findMany: async () => [] },
  auditLog: { create: async () => ({}) },
  systemSetting: { findMany: async () => [] },
  providerCredential: { findMany: async () => [] },
  trustTask: { create: async () => ({}), update: async () => ({}) },
}
mock.module('@/lib/db', () => ({ db: dbFake }))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))
mock.module('@/lib/trust/adapters/riishe', () => ({
  createRiisheTurnRecorder: () => ({
    begin: async () => undefined,
    addDocuments: async () => undefined,
    onEvent: () => undefined,
    complete: async () => undefined,
    completeMemory: async () => undefined,
    failed: async () => undefined,
  }),
}))
mock.module('@/lib/riishe/memory-db', () => ({ getMemoryDelegate: () => null }))
mock.module('@/lib/riishe/memory-actions', () => ({ performMemoryCommandIfPresent: async () => null }))
mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' },
      functions: { invoke: async () => [] },
      chat: { completions: { create: async () => ({ choices: [{ message: { content: 'OK' } }] }) } },
    }),
  },
}))

// ---- controllable orchestrator ------------------------------------------------
type TurnResult = {
  content: string
  metadata: Record<string, unknown>
  searchRan: boolean
  tokensInEst: number
  tokensOutEst: number
  durationMs: number
  task: string
}
const turnState = {
  impl: null as null | ((input: { onEvent?: (e: unknown) => void }) => Promise<TurnResult>),
}
function defaultTurn(input: { onEvent?: (e: unknown) => void }): Promise<TurnResult> {
  input.onEvent?.({ type: 'delta', delta: 'streamed answer' })
  return Promise.resolve({
    content: 'streamed answer',
    metadata: { states: ['UNVERIFIED'], sources: [], verification: [], stages: [], degraded: [] },
    searchRan: false,
    tokensInEst: 10,
    tokensOutEst: 5,
    durationMs: 1,
    task: 'general',
  })
}
mock.module('@/lib/riishe/orchestrator', () => ({
  orchestrateTurn: async (input: { onEvent?: (e: unknown) => void }) => {
    const impl = turnState.impl ?? defaultTurn
    return impl(input)
  },
}))

const { POST } = await import('@/app/api/riishe/chat/route')

// ---- helpers -------------------------------------------------------------------
function chatRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/riishe/chat?stream=1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

interface Frame { json: Record<string, unknown> }
function parseSse(text: string): Frame[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => ({ json: JSON.parse(line.slice('data: '.length)) as Record<string, unknown> }))
}

beforeEach(() => {
  resetDb()
  turnState.impl = null
  currentUserId = 'user-p0r2'
})

// ---- 1. the FIRST data event carries the conversation ID ----------------------
describe('P0-R2 route — early conversation ID event', () => {
  test('a NEW conversation receives conversationId in the FIRST data frame (before deltas/done)', async () => {
    const res = await POST(chatRequest({ message: 'hello there' }))
    expect(res.status).toBe(200)
    const raw = await res.text()
    // The honest keepalive comment is still present (unchanged wire hygiene).
    expect(raw).toContain(': connected')
    const frames = parseSse(raw)
    expect(frames.length).toBeGreaterThan(0)
    const first = frames[0]
    expect(typeof first.json.conversationId).toBe('string')
    expect((first.json.conversationId as string).length).toBeGreaterThan(0)
    // The early event carries NO fabricated content — identity only.
    expect(first.json.delta).toBeUndefined()
    expect(first.json.done).toBeUndefined()
    // The rest of the protocol is intact: deltas and done still flow, and
    // every frame repeats the same conversation ID.
    const delta = frames.find((f) => typeof f.json.delta === 'string')
    const done = frames.find((f) => f.json.done === true)
    expect(delta).toBeDefined()
    expect(done).toBeDefined()
    expect(delta?.json.conversationId).toBe(first.json.conversationId)
    expect(done?.json.conversationId).toBe(first.json.conversationId)
    // The conversation actually exists (the ID is live, not decorative).
    expect(convs.some((c) => c.id === first.json.conversationId)).toBe(true)
  })
})

// ---- 2. client parser passes the identity-only event through ------------------
describe('P0-R2 client parser — conversationId-only event', () => {
  test('the identity event reaches onEvent and is never mistaken for completion', async () => {
    const { consumeRiisheStream } = await import('@/lib/riishe/sse-client')
    const wire =
      ': connected\n\n' +
      `data: ${JSON.stringify({ conversationId: 'conv-early-1' })}\n\n` +
      `data: ${JSON.stringify({ delta: 'partial an', conversationId: 'conv-early-1' })}\n\n` +
      `data: ${JSON.stringify({ done: true, conversationId: 'conv-early-1', partial: false })}\n\n`
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire))
        controller.close()
      },
    })
    const res = new Response(stream, { status: 200 })
    const events: Array<Record<string, unknown>> = []
    let completed = false
    await consumeRiisheStream(res, {
      onEvent: (e) => events.push(e as Record<string, unknown>),
      onComplete: () => {
        completed = true
      },
      onFailure: () => {
        throw new Error('a clean stream must not fail')
      },
    })
    expect(completed).toBe(true)
    expect(events[0]?.conversationId).toBe('conv-early-1')
    expect(events[0]?.delta).toBeUndefined()
    expect(events[0]?.done).toBeUndefined()
    expect(events.some((e) => typeof e.delta === 'string')).toBe(true)
  })
})

// ---- 3. server completes and persists after an early client disconnect --------
describe('P0-R2 server persistence after client disconnect', () => {
  test('the turn settles with exactly ONE user row and ONE assistant row (no duplicates)', async () => {
    let releaseTurn: () => void = () => undefined
    const turnPromise = new Promise<TurnResult>((resolve) => {
      releaseTurn = () =>
        resolve({
          content: 'the complete persisted answer',
          metadata: { states: ['UNVERIFIED'], sources: [], verification: [], stages: [], degraded: [] },
          searchRan: false,
          tokensInEst: 1,
          tokensOutEst: 1,
          durationMs: 1,
          task: 'general',
        })
    })
    turnState.impl = async (input) => {
      // A partial prefix reached the wire before the disconnect.
      input.onEvent?.({ type: 'delta', delta: 'partial an' })
      return turnPromise
    }
    const res = await POST(chatRequest({ message: 'answer me across a dropped connection' }))
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    await reader.read() // early frames (comment + conversation id) flush
    await reader.cancel() // the connection dies here
    // The server still finishes the turn (containment contract).
    releaseTurn()
    await new Promise((r) => setTimeout(r, 30))
    // The conversation exists and holds exactly one clean turn.
    expect(convs).toHaveLength(1)
    const rows = msgs.filter((m) => m.conversationId === convs[0]!.id)
    const userRows = rows.filter((m) => m.role === 'user')
    const asstRows = rows.filter((m) => m.role === 'assistant')
    expect(userRows).toHaveLength(1)
    expect(asstRows).toHaveLength(1)
    expect(userRows[0]!.content).toBe('answer me across a dropped connection')
    // The PERSISTED answer is the complete one — recovery can adopt it.
    expect(asstRows[0]!.content).toBe('the complete persisted answer')
  })
})

// ---- 4+5. pure recovery contracts ----------------------------------------------
describe('P0-R2 bounded recovery schedule + honest adoption', () => {
  test('the schedule is bounded: four attempts over ~68s, then it STOPS (no infinite polling)', async () => {
    const { RECOVERY_SCHEDULE_MS, recoveryDelayForAttempt } = await import('@/lib/riishe/retry')
    expect(RECOVERY_SCHEDULE_MS).toHaveLength(4)
    expect(RECOVERY_SCHEDULE_MS[0]).toBe(0)
    // Window math: 0 + 8 + 20 + 40 = 68s < the 90s server request timeout,
    // so a still-running turn is observed at least once before the client
    // gives up; afterwards there is no attempt index left.
    expect(RECOVERY_SCHEDULE_MS.reduce((a, b) => a + b, 0)).toBe(68_000)
    expect(recoveryDelayForAttempt(0)).toBe(0)
    expect(recoveryDelayForAttempt(3)).toBe(40_000)
    expect(recoveryDelayForAttempt(4)).toBeUndefined()
    expect(recoveryDelayForAttempt(9)).toBeUndefined()
  })

  test('adoption refuses a persisted answer that is not THIS turn (never fabricate reconciliation)', async () => {
    const { persistedAnswerMatchesTurn } = await import('@/lib/riishe/retry')
    // The persisted answer for a DIFFERENT question shares no head with the
    // partial — refusal, not adoption.
    expect(persistedAnswerMatchesTurn('The capital of France is Paris.', 'The solar charger market grew')).toBe(false)
    // A partial that genuinely belongs to the persisted answer adopts.
    expect(persistedAnswerMatchesTurn('The solar charger market grew steadily in 2026.', 'The solar charger market')).toBe(true)
    // Nothing streamed at all (early death): adopt the completed turn.
    expect(persistedAnswerMatchesTurn('The complete answer.', '')).toBe(true)
    // Empty persisted content is never adoptable.
    expect(persistedAnswerMatchesTurn('', '')).toBe(false)
  })
})
