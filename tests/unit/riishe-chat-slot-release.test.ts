/**
 * SHARED JOB CONCURRENCY DIAGNOSTIC (2026-11-23) — RIISHE chat slot release.
 *
 * Reported error: "You already have the maximum number of concurrent jobs
 * for this product. Wait for one to finish." — thrown ONLY by the router's
 * per-user in-flight counter (src/lib/router/router.ts acquireSlot).
 *
 * Historical live evidence (committed artifacts, pre-M26 run of
 * scripts/e2e-riishe-upgrade.sh section 8 — 26 sequential streamed turns in
 * ONE conversation, ONE user): dig-1..13.sse streamed fine, dig-14.sse died
 * with an INTERNAL_ERROR envelope, dig-15..26.sse all received the
 * CONCURRENCY_LIMIT envelope — the user was locked out for the rest of the
 * run. The M26 commit (254fde6) fixed the then-unguarded awaits but its SSE
 * ownership handoff sets `slotReleased = true` at response-return time,
 * which POISONS the shared releaseOnce guard: the stream's own finally
 * calls releaseOnce() and silently no-ops. Every streamed RIISHE turn
 * therefore acquires one slot and never returns it (the counter is
 * in-memory; only a process restart clears it).
 *
 * These tests drive the REAL route handler + REAL router (acquireSlot /
 * releaseSlot) with the Prisma boundary faked, and pin the contract:
 *   1. completed streamed turns release capacity (per-user cap is 2 for the
 *      hosted chat backend — the 3rd turn MUST stream, not 429);
 *   2. failed streamed turns release capacity;
 *   3. cancelled streams (client disconnect / Stop button) release capacity;
 *   4. timeout-classified failures release capacity;
 *   5. concurrent requests never exceed the configured per-user limit, and
 *      the surviving requests release everything when they finish;
 *   6. the non-streaming JSON path keeps its (already correct) release;
 *   7. product isolation: RIISHE slots never block CODE GIFTZ, and user
 *      isolation holds (router-level, real preflight).
 *
 * No product limits are changed by the fix these tests pin; the SAME caps
 * are enforced before and after.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controlled session -------------------------------------------------------
let currentUserId = 'user-slot-a'
mock.module('@/lib/auth/session', () => ({
  requireUser: async () => {
    const { BeanApiError } = await import('@/lib/api/errors')
    if (!currentUserId) {
      throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    }
    return { id: currentUserId, email: `${currentUserId}@example.test`, name: 'Slot Test', role: 'member' as const }
  },
}))

// ---- fake Prisma boundary (only the rows these paths touch) -------------------
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
  // Preflight collateral (quota / budgets / credential vault) — all empty.
  usageRecord: { count: async () => 0, create: async () => ({}), findMany: async () => [] },
  auditLog: { create: async () => ({}) },
  systemSetting: { findMany: async () => [] },
  providerCredential: { findMany: async () => [] },
  trustTask: { create: async () => ({}), update: async () => ({}) },
}
mock.module('@/lib/db', () => ({ db: dbFake }))

// ---- metering spy (usage/audit recording never blocks these paths) ------------
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))

// ---- trust receipt recorder (best-effort by contract) -------------------------
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

// ---- memory subsystems (degraded store; no memory command in these turns) -----
mock.module('@/lib/riishe/memory-db', () => ({ getMemoryDelegate: () => null }))
mock.module('@/lib/riishe/memory-actions', () => ({ performMemoryCommandIfPresent: async () => null }))

// ---- the SDK stays hermetic (adapters load with the router; never called) -----
mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' },
      functions: { invoke: async () => [] },
      chat: { completions: { create: async () => ({ choices: [{ message: { content: 'OK' } }] }) } },
    }),
  },
}))

// ---- controllable orchestrator (the turn generator under the route) -----------
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
  // A real turn streams deltas through onEvent; the route accumulates them
  // into the persisted answer (full.trim().length > 0 => partial:false).
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

// Import AFTER the mocks register (route binds the real router).
const { POST } = await import('@/app/api/riishe/chat/route')
const { preflight } = await import('@/lib/router/router')

// ---- helpers -------------------------------------------------------------------
function chatRequest(body: Record<string, unknown>, stream: boolean): Request {
  const url = `http://localhost/api/riishe/chat${stream ? '?stream=1' : ''}`
  return new Request(url, {
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

async function postTurn(userId: string, message: string, stream: boolean): Promise<Response> {
  currentUserId = userId
  return POST(chatRequest({ message }, stream))
}

beforeEach(() => {
  resetDb()
  turnState.impl = null
})

// ---- 1+4. completed and failed streamed turns release capacity ----------------

describe('streamed RIISHE turns release their concurrency slot (per-user cap is 2)', () => {
  test('three COMPLETED streamed turns in a row all stream — the 3rd is not locked out', async () => {
    const user = 'user-complete'
    for (let i = 1; i <= 3; i += 1) {
      const res = await postTurn(user, `completed turn ${i}`, true)
      expect(res.status).toBe(200)
      const frames = parseSse(await res.text())
      const done = frames.find((f) => f.json.done === true)
      expect(done).toBeDefined()
      expect(done?.json.partial).toBe(false)
    }
  })

  test('two FAILED streamed turns (backend error frame) still leave capacity for the next turn', async () => {
    const user = 'user-failed'
    turnState.impl = async () => {
      throw new Error('API request failed with status 500: simulated backend failure')
    }
    for (let i = 1; i <= 2; i += 1) {
      const res = await postTurn(user, `failed turn ${i}`, true)
      expect(res.status).toBe(200) // streamed error frames ride a 200 SSE response
      const frames = parseSse(await res.text())
      const err = frames.find((f) => typeof f.json.error === 'string')
      expect(err).toBeDefined()
    }
    // Capacity must be free again: this turn completes normally.
    turnState.impl = null
    const res = await postTurn(user, 'the turn after failures', true)
    expect(res.status).toBe(200)
    const frames = parseSse(await res.text())
    expect(frames.find((f) => f.json.done === true)).toBeDefined()
  })

  test('two TIMEOUT-classified streamed failures still leave capacity for the next turn', async () => {
    const user = 'user-timeout'
    turnState.impl = async () => {
      throw new Error('web_search timed out after 20000ms')
    }
    for (let i = 1; i <= 2; i += 1) {
      const res = await postTurn(user, `timeout turn ${i}`, true)
      expect(res.status).toBe(200)
      const frames = parseSse(await res.text())
      expect(frames.find((f) => f.json.code === 'UPSTREAM_TIMEOUT')).toBeDefined()
    }
    turnState.impl = null
    const res = await postTurn(user, 'the turn after timeouts', true)
    expect(res.status).toBe(200)
    expect(parseSse(await res.text()).find((f) => f.json.done === true)).toBeDefined()
  })
})

// ---- 3. cancelled streams (client disconnect) release capacity ----------------

describe('cancelled streams do not permanently consume slots', () => {
  test('a client that cancels mid-stream frees the slot once the turn settles', async () => {
    const user = 'user-cancel'
    let releaseTurn: () => void = () => undefined
    const turnPromise = new Promise<TurnResult>((resolve) => {
      releaseTurn = () =>
        resolve({
          content: 'late answer',
          metadata: { states: ['UNVERIFIED'], sources: [], verification: [], stages: [], degraded: [] },
          searchRan: false,
          tokensInEst: 1,
          tokensOutEst: 1,
          durationMs: 1,
          task: 'general',
        })
    })
    turnState.impl = async () => turnPromise

    currentUserId = user
    const res = await POST(chatRequest({ message: 'cancel me mid-stream' }, true))
    expect(res.status).toBe(200)

    // Read ONE frame then cancel — the browser "Stop" path.
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel('user pressed stop')

    // Let the turn settle (the orchestrator finishes server-side by design).
    releaseTurn()
    await turnPromise.catch(() => undefined)
    await new Promise((r) => setTimeout(r, 25))

    // The slot must be free: two more turns stream fine (cap is 2).
    turnState.impl = null
    for (let i = 1; i <= 2; i += 1) {
      const next = await postTurn(user, `after cancel ${i}`, true)
      expect(next.status).toBe(200)
      expect(parseSse(await next.text()).find((f) => f.json.done === true)).toBeDefined()
    }
  })
})

// ---- 5. concurrent requests cannot exceed the configured limits ---------------

describe('concurrent requests never exceed the configured per-user limit', () => {
  test('5 concurrent streamed turns: at most 2 admitted (cap), ALL slots free afterwards', async () => {
    const user = 'user-burst'
    const pending: Array<() => void> = []
    turnState.impl = async () =>
      new Promise<TurnResult>((resolve) => {
        pending.push(() =>
          resolve({
            content: 'burst answer',
            metadata: { states: ['UNVERIFIED'], sources: [], verification: [], stages: [], degraded: [] },
            searchRan: false,
            tokensInEst: 1,
            tokensOutEst: 1,
            durationMs: 1,
            task: 'general',
          }),
        )
      })

    currentUserId = user
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => POST(chatRequest({ message: `burst ${i}` }, true))),
    )
    const admitted = responses.filter((r) => r.status === 200)
    const rejected = responses.filter((r) => r.status === 429)
    expect(admitted.length).toBeLessThanOrEqual(2) // backend maxInFlightPerUser
    expect(rejected.length).toBe(5 - admitted.length)
    for (const r of rejected) {
      const body = (await r.json()) as { error?: { code?: string } }
      expect(body.error?.code).toBe('CONCURRENCY_LIMIT')
    }

    // Settle the admitted turns BEFORE consuming their bodies: an SSE body
    // only ends when its turn settles, so reading earlier would deadlock.
    for (const release of pending.splice(0)) release()
    await new Promise((r) => setTimeout(r, 25))
    for (const r of admitted) {
      expect(parseSse(await r.text()).find((f) => f.json.done === true)).toBeDefined()
    }

    // Prove every slot came back.
    turnState.impl = null
    for (let i = 1; i <= 2; i += 1) {
      const next = await postTurn(user, `after burst ${i}`, true)
      expect(next.status).toBe(200)
      expect(parseSse(await next.text()).find((f) => f.json.done === true)).toBeDefined()
    }
  })
})

// ---- 6. JSON path regression (already correct; stays correct) -----------------

describe('non-streaming JSON turns keep releasing capacity', () => {
  test('three completed JSON turns in a row all succeed', async () => {
    const user = 'user-json'
    for (let i = 1; i <= 3; i += 1) {
      const res = await postTurn(user, `json turn ${i}`, false)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok?: boolean; content?: string }
      expect(body.ok).toBe(true)
      expect(body.content).toBe('streamed answer')
    }
  })

  test('a failed JSON turn (typed upstream error) releases the slot for the next turn', async () => {
    const user = 'user-json-fail'
    turnState.impl = async () => {
      throw new Error('API request failed with status 429: throttled')
    }
    const failed = await postTurn(user, 'json failure', false)
    expect(failed.status).toBe(429)
    turnState.impl = null
    for (let i = 1; i <= 2; i += 1) {
      const next = await postTurn(user, `json after failure ${i}`, false)
      expect(next.status).toBe(200)
    }
  })
})

// ---- 7. product + user isolation (real router, real preflight) ----------------

describe('one product at its cap never blocks another product or another user', () => {
  test('RIISHE slots at the per-user cap leave CODE GIFTZ and other users unaffected', async () => {
    const a = 'user-iso-a'
    const b = 'user-iso-b'
    const held: Array<() => void> = []
    try {
      // Fill user A's RIISHE per-user capacity (hosted chat backend cap = 2).
      const first = await preflight(a, 'riishe', 'chat')
      held.push(first.release)
      const second = await preflight(a, 'riishe', 'chat')
      held.push(second.release)
      await expect(preflight(a, 'riishe', 'chat')).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' })

      // User B is unaffected (per-user isolation).
      const otherUser = await preflight(b, 'riishe', 'chat')
      otherUser.release()

      // CODE GIFTZ rides a DIFFERENT backend id — its slot is independent.
      const giftz = await preflight(a, 'code-giftz', 'coding-task')
      giftz.release()

      // Releasing restores user A's capacity exactly.
      held.pop()!()
      held.pop()!()
      const again = await preflight(a, 'riishe', 'chat')
      again.release()
    } finally {
      for (const release of held.splice(0)) release()
    }
  })
})
