/**
 * M33 — RIISHE memory management API route tests.
 *
 * Pattern (same idiom as tests/unit/client-compute-report-route.test.ts):
 * handlers invoked with real Request objects; the session resolver, the
 * memory delegate and the trust receipt boundary are mocked; the error
 * envelope + zod validation are REAL.
 *
 * Covered: create / list / edit / export / delete-one / delete-all /
 * duplicate refusal / 50-cap / 480-limit / sensitive refusal / conflict
 * decision point (replace + keep-both + stale-replace) / stale edit /
 * cross-user isolation / malformed input / receipt privacy.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controlled session ------------------------------------------------------
interface CtlUser { id: string; email: string; name: string | null; role: 'member' | 'admin' }
const ALICE: CtlUser = { id: 'user-alice', email: 'alice@example.test', name: 'Alice', role: 'member' }
const BOB: CtlUser = { id: 'user-bob', email: 'bob@example.test', name: 'Bob', role: 'member' }
let currentUser: CtlUser | null = ALICE
mock.module('@/lib/auth/session', () => ({
  getSessionUser: async () => currentUser,
  // Faithful copy of the real requireUser (pinned by other suites).
  requireUser: async () => {
    const user = await currentUser
    if (!user) {
      const { BeanApiError } = await import('@/lib/api/errors')
      throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    }
    return user
  },
}))

// ---- in-memory memory delegate (Prisma-shaped, updatedAt-aware) --------------
interface MemoryRecord {
  id: string
  userId: string
  content: string
  createdAt: Date
  updatedAt: Date
}
let rows: MemoryRecord[] = []
let seq = 0
function freshRow(userId: string, content: string, ageMinutes = 0): MemoryRecord {
  seq += 1
  const t = new Date(Date.parse('2026-11-23T09:00:00.000Z') - ageMinutes * 60_000)
  return { id: `mem-${seq}`, userId, content, createdAt: t, updatedAt: t }
}
function resetRows(): void {
  rows = []
  seq = 0
}

const delegate = {
  findMany: async ({ where, orderBy, take }: { where: { userId: string }; orderBy?: { createdAt: 'desc' }; take?: number }) => {
    const found = rows.filter((r) => r.userId === where.userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const limited = typeof take === 'number' ? found.slice(0, take) : found
    return limited.map((r) => ({ ...r }))
  },
  count: async ({ where }: { where: { userId: string } }) => rows.filter((r) => r.userId === where.userId).length,
  create: async ({ data }: { data: { userId: string; content: string } }) => {
    seq += 1
    const now = new Date()
    const row: MemoryRecord = { id: `mem-${seq}`, userId: data.userId, content: data.content, createdAt: now, updatedAt: now }
    rows.push(row)
    return { ...row }
  },
  deleteMany: async ({ where }: { where: { userId: string; id?: string | { in: string[] }; updatedAt?: Date } }) => {
    const before = rows.length
    rows = rows.filter((r) => {
      if (r.userId !== where.userId) return true
      const idMatch =
        where.id === undefined ||
        (typeof where.id === 'string' ? r.id === where.id : where.id.in.includes(r.id))
      const versionMatch = where.updatedAt === undefined || r.updatedAt.getTime() === where.updatedAt.getTime()
      return !(idMatch && versionMatch)
    })
    return { count: before - rows.length }
  },
  findFirst: async ({ where }: { where: { userId: string; id?: string } }) => {
    const row = rows.find((r) => r.userId === where.userId && (where.id === undefined || r.id === where.id))
    return row ? { ...row } : null
  },
  updateMany: async ({
    where,
    data,
  }: {
    where: { userId: string; id: string; updatedAt?: Date }
    data: { content: string }
  }) => {
    let count = 0
    for (const r of rows) {
      if (r.userId !== where.userId || r.id !== where.id) continue
      if (where.updatedAt && r.updatedAt.getTime() !== where.updatedAt.getTime()) continue
      r.content = data.content
      r.updatedAt = new Date()
      count += 1
    }
    return { count }
  },
}

let degraded = false
mock.module('@/lib/riishe/memory-db', () => ({
  getMemoryDelegate: () => (degraded ? null : delegate),
}))

// ---- trust receipt spy (content-privacy assertions ride on this) -------------
const receipts: Array<{ op: string; memoryIds?: ReadonlyArray<string>; itemCount?: number; verification: string }> = []
mock.module('@/lib/trust/adapters/riishe-memory', () => ({
  recordMemoryManagementReceipt: async (input: { op: string; memoryIds?: ReadonlyArray<string>; itemCount?: number; verification: string }) => {
    receipts.push(input)
  },
}))

const { GET, POST, PATCH, DELETE } = await import('@/app/api/riishe/memory/route')

function post(body: unknown, url = 'http://localhost/api/riishe/memory'): Promise<Response> {
  return POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
}
function patch(body: unknown): Promise<Response> {
  return PATCH(new Request('http://localhost/api/riishe/memory', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
}

beforeEach(() => {
  currentUser = ALICE
  degraded = false
  resetRows()
  receipts.length = 0
})

describe('M33 memory API — list (GET)', () => {
  test('lists only the authenticated user\'s rows, newest first, exact customer surface', async () => {
    rows.push(freshRow('user-alice', 'my timezone is IST', 1), freshRow('user-bob', 'bob secret fact', 0), freshRow('user-alice', 'I prefer concise answers', 5))
    const res = await GET(new Request('http://localhost/api/riishe/memory'))
    const data = (await res.json()) as { memories: Array<{ id: string; content: string; createdAt: string; updatedAt: string }> }
    expect(data.memories).toHaveLength(2)
    expect(data.memories[0].content).toBe('my timezone is IST') // newest first
    expect(data.memories.every((m) => m.content !== 'bob secret fact')).toBe(true)
    // Exactly the promised fields — no internal identifiers beyond the row id.
    expect(Object.keys(data.memories[0]).sort()).toEqual(['content', 'createdAt', 'id', 'updatedAt'])
  })

  test('unauthenticated list is refused (401 envelope)', async () => {
    currentUser = null
    const res = await GET(new Request('http://localhost/api/riishe/memory'))
    expect(res.status).toBe(401)
    const data = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(data.ok).toBe(false)
    expect(data.error.code).toBe('UNAUTHENTICATED')
  })

  test('degraded (pre-model client) lists empty with an honest note', async () => {
    degraded = true
    const res = await GET(new Request('http://localhost/api/riishe/memory'))
    const data = (await res.json()) as { memories: unknown[]; degraded?: string }
    expect(data.memories).toEqual([])
    expect(data.degraded).toContain('initializing')
  })
})

describe('M33 memory API — export (GET ?export=json)', () => {
  test('streams an attachment with ONLY this user\'s rows and the required fields', async () => {
    rows.push(freshRow('user-alice', 'my timezone is IST', 1), freshRow('user-bob', 'bob private fact', 2))
    const res = await GET(new Request('http://localhost/api/riishe/memory?export=json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain('.json')
    const payload = (await res.json()) as {
      format: string
      exportedAt: string
      count: number
      memories: Array<{ id: string; content: string; createdAt: string; updatedAt: string }>
    }
    expect(payload.count).toBe(1)
    expect(payload.memories[0].content).toBe('my timezone is IST')
    expect(Object.keys(payload.memories[0]).sort()).toEqual(['content', 'createdAt', 'id', 'updatedAt'])
    expect(typeof payload.exportedAt).toBe('string')
    // Export isolation: no foreign rows, no tokens/keys/credentials fields.
    expect(JSON.stringify(payload)).not.toContain('bob')
    expect(JSON.stringify(payload)).not.toContain('token')
    // Receipt recorded, and no memory content in it.
    expect(receipts.some((r) => r.op === 'export' && r.itemCount === 1)).toBe(true)
    expect(receipts.every((r) => !r.verification.includes('my timezone is IST'))).toBe(true)
  })

  test('export is authenticated', async () => {
    currentUser = null
    const res = await GET(new Request('http://localhost/api/riishe/memory?export=json'))
    expect(res.status).toBe(401)
  })
})

describe('M33 memory API — create (POST)', () => {
  test('stores an explicit memory and returns the row', async () => {
    const res = await post({ content: 'my timezone is IST' })
    const data = (await res.json()) as { memory: { id: string; content: string } }
    expect(res.status).toBe(200)
    expect(data.memory.content).toBe('my timezone is IST')
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(1)
  })

  test('duplicate refusal (exact, case/whitespace-insensitive — today\'s contract)', async () => {
    rows.push(freshRow('user-alice', 'my timezone is IST'))
    const res = await post({ content: '  MY   timezone  is IST  ' })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { message: string } }
    expect(data.error.message).toContain('already stored')
    expect(rows).toHaveLength(1)
  })

  test('sensitive-data refusal', async () => {
    const res = await post({ content: 'my api key is sk-abcdef1234567890' })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { message: string } }
    expect(data.error.message).toContain('API keys or tokens')
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(0)
  })

  test('480-character limit enforced', async () => {
    const res = await post({ content: 'x'.repeat(481) })
    expect(res.status).toBe(400)
    const res2 = await post({ content: 'x'.repeat(480) })
    expect(res2.status).toBe(200)
  })

  test('50-item cap enforced', async () => {
    for (let i = 0; i < 50; i += 1) rows.push(freshRow('user-alice', `fact number ${i} is stored here`, i))
    const res = await post({ content: 'one more fact that will not fit' })
    expect(res.status).toBe(429)
    const data = (await res.json()) as { error: { code: string; message: string } }
    expect(data.error.code).toBe('QUOTA_EXCEEDED')
  })

  test('potential conflict → decision point, nothing stored', async () => {
    rows.push(freshRow('user-alice', 'My timezone is IST'))
    const before = rows.length
    const res = await post({ content: 'my timezone is UTC' })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { requiresChoice: boolean; candidates: Array<{ id: string; content: string; confidence: string; updatedAt: string }> }
    expect(data.requiresChoice).toBe(true)
    expect(data.candidates).toHaveLength(1)
    expect(data.candidates[0].content).toBe('My timezone is IST')
    expect(data.candidates[0].confidence).toBe('likely')
    expect(rows.length).toBe(before) // NOTHING was stored
    // Receipt: conflicts presented, nothing replaced.
    expect(receipts.some((r) => r.op === 'potential-conflicts-presented')).toBe(true)
    expect(receipts.every((r) => !JSON.stringify(r).includes('my timezone is UTC'))).toBe(true)
  })

  test('keep-both decision stores the new memory', async () => {
    rows.push(freshRow('user-alice', 'My timezone is IST'))
    const res = await post({ content: 'my timezone is UTC', decision: { kind: 'keep-both' } })
    expect(res.status).toBe(200)
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(2)
  })

  test('user-confirmed replace: removes the confirmed version and stores the new one', async () => {
    const target = freshRow('user-alice', 'My timezone is IST')
    rows.push(target)
    const res = await post({
      content: 'my timezone is UTC',
      decision: { kind: 'replace', memoryId: target.id, expectedUpdatedAt: target.updatedAt.toISOString() },
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { memory: { content: string } }
    expect(data.memory.content).toBe('my timezone is UTC')
    expect(rows.some((r) => r.content === 'My timezone is IST')).toBe(false)
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(1)
    expect(receipts.some((r) => r.op === 'user-confirmed-replacement')).toBe(true)
  })

  test('stale replace (version moved) → 409 with the current row, nothing changed', async () => {
    const target = freshRow('user-alice', 'My timezone is IST')
    rows.push(target)
    // The row was edited after the user reviewed it:
    target.content = 'My timezone is IST (Asia/Kolkata)'
    target.updatedAt = new Date(target.updatedAt.getTime() + 5_000)
    const res = await post({
      content: 'my timezone is UTC',
      decision: { kind: 'replace', memoryId: target.id, expectedUpdatedAt: new Date(target.updatedAt.getTime() - 5_000).toISOString() },
    })
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: { code: string; detail?: string } }
    expect(data.error.code).toBe('EDIT_CONFLICT')
    const detail = JSON.parse(data.error.detail ?? '{}') as { current: { content: string } }
    expect(detail.current.content).toBe('My timezone is IST (Asia/Kolkata)')
    expect(rows.some((r) => r.content === 'my timezone is UTC')).toBe(false)
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(1)
  })

  test('cross-user replace attempt is a clean 404 and never touches the foreign row', async () => {
    const target = freshRow('user-bob', 'bob deployment window is Sunday')
    rows.push(target)
    const res = await post({
      content: 'bob deployment window is Monday',
      decision: { kind: 'replace', memoryId: target.id, expectedUpdatedAt: target.updatedAt.toISOString() },
    })
    expect(res.status).toBe(404)
    expect(rows.some((r) => r.id === target.id)).toBe(true) // untouched
  })
})

describe('M33 memory API — edit (PATCH)', () => {
  test('edits under the optimistic-concurrency guard', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target)
    const versionBefore = target.updatedAt.toISOString()
    const res = await patch({ id: target.id, content: 'my timezone is GMT+5:30', expectedUpdatedAt: versionBefore })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { memory: { content: string; updatedAt: string } }
    expect(data.memory.content).toBe('my timezone is GMT+5:30')
    // The version moved: the client's next edit would need the NEW stamp.
    expect(data.memory.updatedAt).not.toBe(versionBefore)
    expect(receipts.some((r) => r.op === 'edit')).toBe(true)
  })

  test('stale edit → 409 EDIT_CONFLICT with current row; old content never discarded', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target)
    const staleVersion = new Date(target.updatedAt.getTime() - 60_000).toISOString()
    const res = await patch({ id: target.id, content: 'some other fact', expectedUpdatedAt: staleVersion })
    expect(res.status).toBe(409)
    const data = (await res.json()) as { error: { code: string; detail?: string; message: string } }
    expect(data.error.code).toBe('EDIT_CONFLICT')
    const detail = JSON.parse(data.error.detail ?? '{}') as { current: { content: string } }
    expect(detail.current.content).toBe('my timezone is IST') // still intact
    expect(rows[0].content).toBe('my timezone is IST') // unchanged
  })

  test('edit refuses duplicate-of-another-row', async () => {
    rows.push(freshRow('user-alice', 'my timezone is IST'), freshRow('user-alice', 'I prefer concise answers', 3))
    const target = rows[1]
    const res = await patch({ id: target.id, content: 'my timezone is IST', expectedUpdatedAt: target.updatedAt.toISOString() })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { message: string } }
    expect(data.error.message).toContain('already stored')
  })

  test('cross-user edit is 404 (IDOR-safe)', async () => {
    const target = freshRow('user-bob', 'bob private note')
    rows.push(target)
    const res = await patch({ id: target.id, content: 'hijacked', expectedUpdatedAt: target.updatedAt.toISOString() })
    expect(res.status).toBe(404)
    expect(rows[0].content).toBe('bob private note')
  })

  test('sensitive content refused on edit too', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target)
    const res = await patch({ id: target.id, content: 'my password is hunter2', expectedUpdatedAt: target.updatedAt.toISOString() })
    expect(res.status).toBe(400)
    expect(rows[0].content).toBe('my timezone is IST')
  })

  test('malformed expectedUpdatedAt is a clean 400', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target)
    const res = await patch({ id: target.id, content: 'fine content', expectedUpdatedAt: 'not-a-timestamp' })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: { message: string } }
    expect(data.error.message).toContain('expectedUpdatedAt')
  })

  test('malformed / too-short content refused', async () => {
    const res = await patch({ id: 'whatever', content: 'ab', expectedUpdatedAt: new Date().toISOString() })
    expect(res.status).toBe(400)
  })
})

describe('M33 memory API — delete (DELETE)', () => {
  test('deletes one owned row', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target, freshRow('user-alice', 'another fact', 5))
    const res = await DELETE(new Request(`http://localhost/api/riishe/memory?id=${target.id}`, { method: 'DELETE' }))
    const data = (await res.json()) as { deleted: number }
    expect(data.deleted).toBe(1)
    expect(rows.some((r) => r.id === target.id)).toBe(false)
    expect(receipts.some((r) => r.op === 'delete')).toBe(true)
  })

  test('cross-user delete is 404 and the foreign row survives', async () => {
    const target = freshRow('user-bob', 'bob private note')
    rows.push(target)
    const res = await DELETE(new Request(`http://localhost/api/riishe/memory?id=${target.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(404)
    expect(rows.some((r) => r.id === target.id)).toBe(true)
  })

  test('delete-all removes only the owner\'s rows', async () => {
    rows.push(freshRow('user-alice', 'a'), freshRow('user-alice', 'b', 1), freshRow('user-bob', 'keep me', 2))
    const res = await DELETE(new Request('http://localhost/api/riishe/memory?all=1', { method: 'DELETE' }))
    const data = (await res.json()) as { deleted: number }
    expect(data.deleted).toBe(2)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('keep me')
    expect(receipts.some((r) => r.op === 'delete-all' && r.itemCount === 2)).toBe(true)
  })

  test('unauthenticated delete is refused', async () => {
    currentUser = null
    const res = await DELETE(new Request('http://localhost/api/riishe/memory?all=1', { method: 'DELETE' }))
    expect(res.status).toBe(401)
  })

  test('concurrent replacement: second conditional delete on a moved version removes nothing', async () => {
    const target = freshRow('user-alice', 'my timezone is IST')
    rows.push(target)
    const versionA = target.updatedAt.toISOString()
    // First replacement wins…
    target.updatedAt = new Date(target.updatedAt.getTime() + 1_000)
    // …the second actor still holds versionA:
    const res = await post({
      content: 'my timezone is UTC',
      decision: { kind: 'replace', memoryId: target.id, expectedUpdatedAt: versionA },
    })
    expect(res.status).toBe(409)
    expect(rows.filter((r) => r.userId === 'user-alice')).toHaveLength(1)
  })
})
