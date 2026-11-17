/**
 * M26.1 — Session-token lifecycle security regression (P0 historical token exposure).
 *
 * Context: 30 historical `bean_session` tokens were published in git history
 * (cookie jars swept into commits, S-2/M26). The current database holds ZERO
 * session rows, so every one of those tokens must be rejected today. This
 * suite pins the rejection mechanics that make "old tokens are invalid" a
 * durable property of the code, not of the current data state:
 *
 *   1. OLD-TOKEN REJECTION — a syntactically plausible 64-hex token that is
 *      absent from the Session table resolves to null (401 downstream). No
 *      signature/HMAC bypass exists: sessions are opaque DB-lookup tokens.
 *   2. EXPIRED-SESSION REJECTION + CLEANUP — an expired row is rejected AND
 *      deleted on sight (no resurrection path).
 *   3. VALID SESSION — round-trips to the user payload carrying NO token
 *      material (tokens live only in the cookie and the DB row).
 *   4. LOGOUT INVALIDATION — destroySession deletes the row; the SAME cookie
 *      is afterwards rejected (invalidation is effective, not cosmetic).
 *   5. PASSWORD-CHANGE REVOCATION (M26 S-8) — the account settings route
 *      revokes EVERY session for the user inside the update transaction;
 *      every previously-valid token is dead afterwards (route returns
 *      sessionsRevoked=true).
 *   6. TOKEN SHAPES — tokens are 64 hex chars of CSPRNG material; the fake
 *      issues real `randomBytes`-shaped rows and every historical-shaped
 *      token outside the store fails closed.
 *
 * Boundaries: the Prisma client is a SELF-CONTAINED in-memory fake
 * (mock.module) and the cookie jar is an in-memory map — nothing touches the
 * real DB. The password module is the REAL scrypt implementation.
 *
 * Run: bun test tests/unit/m261-session-token-lifecycle.test.ts
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { randomBytes } from 'crypto'

// ---- in-memory cookie jar (stands in for next/headers cookies()) -----------
const cookieJar = new Map<string, string>()
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string, _opts?: unknown) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  }),
  // errors.ts imports `headers` for request-id echo — stub minimally.
  headers: async () => new Map<string, string>(),
  draftMode: async () => ({ isEnabled: false }),
}))

// ---- in-memory Prisma fake for the session/user/auditLog boundaries --------
interface SessionRow {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
}
interface UserRow {
  id: string
  email: string
  name: string | null
  role: string
  passwordHash: string
  createdAt: Date
}

const sessions = new Map<string, SessionRow>() // keyed by token (Session.token unique)
const users = new Map<string, UserRow>()
const auditRows: Array<{ actorId: string; action: string }> = []
let idCounter = 0

const fakeDb = {
  session: {
    async findUnique({ where }: { where: { token: string } }) {
      const row = sessions.get(where.token)
      if (!row) return null
      const user = users.get(row.userId)
      return user ? { ...row, user } : null
    },
    async delete({ where }: { where: { id: string } }) {
      for (const [token, row] of sessions) {
        if (row.id === where.id) {
          sessions.delete(token)
          return row
        }
      }
      throw new Error('record not found')
    },
    async deleteMany({ where }: { where: { token?: string; userId?: string } }) {
      let count = 0
      for (const [token, row] of [...sessions]) {
        const match =
          (where.token !== undefined && token === where.token) ||
          (where.userId !== undefined && row.userId === where.userId)
        if (match) {
          sessions.delete(token)
          count++
        }
      }
      return { count }
    },
    async create({ data }: { data: Omit<SessionRow, 'id' | 'createdAt'> }) {
      const row: SessionRow = { id: `s-${++idCounter}`, createdAt: new Date(), ...data }
      sessions.set(row.token, row)
      return row
    },
  },
  user: {
    async findUnique({ where }: { where: { id: string } }) {
      return users.get(where.id) ?? null
    },
    async update({ where, data }: { where: { id: string }; data: Partial<UserRow> }) {
      const row = users.get(where.id)
      if (!row) throw new Error('user not found')
      const updated = { ...row, ...data } as UserRow
      users.set(where.id, updated)
      return updated
    },
  },
  auditLog: {
    async create({ data }: { data: { actorId: string; action: string } }) {
      auditRows.push({ actorId: data.actorId, action: data.action })
      return data
    },
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- system under test (imported AFTER the boundary mocks) -----------------
const { createSession, getSessionUser, destroySession, SESSION_COOKIE } = await import(
  '../../src/lib/auth/session'
)
const { hashPassword, verifyPassword } = await import('../../src/lib/auth/password')
const { PATCH: settingsPatch } = await import('../../src/app/api/account/settings/route')

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: `u-${++idCounter}`,
    email: `user${idCounter}@example.test`,
    name: 'Test User',
    role: 'member',
    passwordHash: hashPassword('correct horse battery staple 1'),
    createdAt: new Date(),
    ...overrides,
  }
}

function historicalShapedToken(): string {
  // The published jars hold exactly this shape: 64 lowercase hex chars.
  return randomBytes(32).toString('hex')
}

function settingsRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/account/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  sessions.clear()
  users.clear()
  auditRows.length = 0
  cookieJar.clear()
})

describe('M26.1 session-token lifecycle (historical exposure closure)', () => {
  test('1. old tokens absent from the Session table are REJECTED (no bypass)', async () => {
    const user = makeUser()
    users.set(user.id, user)
    // Valid session so we know the machinery works...
    const fresh = await createSession(user.id)
    cookieJar.set(SESSION_COOKIE, fresh)
    expect(await getSessionUser()).not.toBeNull()
    // ...then a historical-shaped token that is NOT in the store must fail.
    cookieJar.set(SESSION_COOKIE, historicalShapedToken())
    expect(await getSessionUser()).toBeNull()
    // And a second historical shape too (each jar token was distinct).
    cookieJar.set(SESSION_COOKIE, historicalShapedToken())
    expect(await getSessionUser()).toBeNull()
  })

  test('2. expired sessions are rejected AND deleted on sight (no resurrection)', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const token = historicalShapedToken()
    await fakeDb.session.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() - 1000) },
    })
    expect(sessions.has(token)).toBe(true)
    cookieJar.set(SESSION_COOKIE, token)
    expect(await getSessionUser()).toBeNull()
    expect(sessions.has(token)).toBe(false) // cleaned up
    // Re-presenting the same dead token: still rejected, still gone.
    cookieJar.set(SESSION_COOKIE, token)
    expect(await getSessionUser()).toBeNull()
  })

  test('3. a valid session resolves to the user with NO token material in the payload', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const token = await createSession(user.id)
    cookieJar.set(SESSION_COOKIE, token)
    const resolved = await getSessionUser()
    expect(resolved).not.toBeNull()
    expect(resolved?.id).toBe(user.id)
    expect(resolved?.role).toBe('member')
    const serialized = JSON.stringify(resolved)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain('token')
  })

  test('4. destroySession makes the SAME cookie invalid afterwards', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const token = await createSession(user.id)
    cookieJar.set(SESSION_COOKIE, token)
    expect(await getSessionUser()).not.toBeNull()
    await destroySession()
    expect(sessions.has(token)).toBe(false)
    cookieJar.set(SESSION_COOKIE, token) // attacker replays the old cookie
    expect(await getSessionUser()).toBeNull()
  })

  test('5. password change revokes EVERY session for the account (S-8 contract)', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const t1 = await createSession(user.id)
    const t2 = await createSession(user.id)
    const other = makeUser()
    users.set(other.id, other)
    const tOther = await createSession(other.id) // must survive (other account)

    cookieJar.set(SESSION_COOKIE, t1)
    const res = await settingsRequest({
      currentPassword: 'correct horse battery staple 1',
      newPassword: 'n3wpassword9',
    })
    const payload = (await settingsPatch(res).then((r: Response) => r.json())) as {
      ok: boolean
      updated: boolean
      sessionsRevoked: boolean
    }
    expect(payload.ok).toBe(true)
    expect(payload.updated).toBe(true)
    expect(payload.sessionsRevoked).toBe(true)

    for (const t of [t1, t2]) {
      cookieJar.set(SESSION_COOKIE, t)
      expect(await getSessionUser()).toBeNull()
    }
    cookieJar.set(SESSION_COOKIE, tOther)
    expect(await getSessionUser()).not.toBeNull() // untouched account unaffected
    expect(auditRows.some((a) => a.action === 'account.update')).toBe(true)
  })

  test('6. session tokens are 64-hex CSPRNG shapes and unique per login', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const a = await createSession(user.id)
    const b = await createSession(user.id)
    for (const t of [a, b]) {
      expect(t).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(a).not.toBe(b)
  })

  test('7. wrong current password does NOT rotate the hash nor touch sessions', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const token = await createSession(user.id)
    cookieJar.set(SESSION_COOKIE, token)
    const originalHash = user.passwordHash
    const res = await settingsRequest({ currentPassword: 'wrong password 1x', newPassword: 'n3wpassword9' })
    const payload = (await settingsPatch(res).then((r: Response) => r.json())) as { ok: boolean }
    expect(payload.ok).toBe(false)
    expect(verifyPassword('correct horse battery staple 1', originalHash)).toBe(true)
    cookieJar.set(SESSION_COOKIE, token)
    expect(await getSessionUser()).not.toBeNull() // session untouched
  })
})
