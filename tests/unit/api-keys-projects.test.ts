/**
 * Phase 1 — project-scoped API key infrastructure tests.
 *
 * Extends the contract pinned by tests/unit/api-keys.test.ts (that file's
 * assertions remain untouched and green). Pinned here:
 *  - product scopes (images:generate, videos:generate, code:generate,
 *    files:read) are REAL registered scopes, validated at creation and
 *    enforced by the same central assertScope gate;
 *  - a project-scoped key is bound to exactly one project the owner owns;
 *    unknown / cross-user projects are NOT_FOUND (no existence leak);
 *  - archived projects cannot mint keys;
 *  - project keys can NEVER hold the admin wildcard;
 *  - legacy administrator keys (projectId = null) keep platform-wide
 *    behavior — including the wildcard — unchanged;
 *  - verification returns the key's project binding; the central
 *    assertProjectBinding gate contains project keys to their project;
 *  - rotation preserves the binding; revocation works unchanged.
 *
 * The database boundary is a SELF-CONTAINED in-memory fake (mock.module) —
 * no test writes anywhere near the real DB.
 *
 * Run: bun test tests/unit/api-keys-projects.test.ts
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { BeanApiError } from '../../src/lib/api/errors'

// ---- in-memory fakes for the Prisma boundary (the ONLY mocked boundary) ----

interface FakeKeyRow {
  id: string
  userId: string
  name: string
  prefix: string
  keyHash: string
  permissions: string
  rateLimitPerMin: number
  status: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  requestCount: number
  createdAt: Date
  revokedAt: Date | null
  projectId: string | null
}

interface FakeProjectRow {
  id: string
  userId: string
  name: string
  status: string
  createdAt: Date
  updatedAt: Date
}

const keyStore = new Map<string, FakeKeyRow>()
const projectStore = new Map<string, FakeProjectRow>()
let idCounter = 0

const fakeDb = {
  apiKey: {
    async create({ data }: { data: Partial<FakeKeyRow> & Pick<FakeKeyRow, 'userId' | 'name' | 'prefix' | 'keyHash' | 'permissions'> }) {
      const row = {
        id: `key-${++idCounter}`,
        createdAt: new Date(),
        requestCount: 0,
        lastUsedAt: null,
        ...data,
      } as FakeKeyRow
      // Prisma schema defaults — the fake must behave identically.
      row.status ??= 'active'
      row.permissions ??= '[]'
      row.rateLimitPerMin ??= 60
      row.revokedAt ??= null
      row.projectId ??= null
      keyStore.set(row.id, row)
      return row
    },
    async findUnique({ where }: { where: { id: string } }) {
      return keyStore.get(where.id) ?? null
    },
    async findMany({ where }: { where: { prefix?: string; status?: string } }) {
      return [...keyStore.values()].filter(
        (r) => (where.prefix === undefined || r.prefix === where.prefix) && (where.status === undefined || r.status === where.status),
      )
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakeKeyRow> & { requestCount?: { increment: number } } }) {
      const row = keyStore.get(where.id)
      if (!row) throw new Error('not found')
      const inc = typeof data.requestCount === 'object' && data.requestCount !== null && 'increment' in data.requestCount ? (data.requestCount as { increment: number }).increment : undefined
      const { requestCount: _rc, ...rest } = data
      Object.assign(row, rest)
      if (inc !== undefined) row.requestCount += inc
      return row
    },
  },
  project: {
    async findUnique({ where }: { where: { id: string } }) {
      return projectStore.get(where.id) ?? null
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

beforeEach(() => {
  keyStore.clear()
  projectStore.clear()
})

const { createApiKey, verifyApiKey, revokeApiKey, rotateApiKey, assertScope, assertProjectBinding, API_KEY_SCOPES, PORTAL_KEY_SCOPES, API_KEY_PREFIX } =
  await import('../../src/lib/security/api-keys')

const ALICE = 'user-alice'
const BOB = 'user-bob'

function seedProject(overrides: Partial<FakeProjectRow> = {}): FakeProjectRow {
  const row: FakeProjectRow = {
    ...{
      id: `proj-${projectStore.size + 1}`,
      userId: ALICE,
      name: 'Alice project',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  }
  projectStore.set(row.id, row)
  return row
}

async function makeKey(overrides: Partial<{ name: string; permissions: string[]; rateLimitPerMin: number; ownerId: string; projectId: string | null }> = {}) {
  return createApiKey({
    ownerId: overrides.ownerId ?? ALICE,
    name: overrides.name ?? 'Test key',
    permissions: overrides.permissions ?? ['chat:completions'],
    rateLimitPerMin: overrides.rateLimitPerMin ?? 60,
    expiresAt: null,
    projectId: overrides.projectId ?? null,
  })
}

describe('Phase 1 — product scope registry', () => {
  test('the four planned product scopes are registered gateway scopes', () => {
    for (const s of ['images:generate', 'videos:generate', 'code:generate', 'files:read'] as const) {
      expect(API_KEY_SCOPES).toContain(s)
    }
  })

  test('the portal scope subset excludes the wildcard and providers:read', () => {
    expect(PORTAL_KEY_SCOPES).not.toContain('*')
    expect(PORTAL_KEY_SCOPES).not.toContain('providers:read')
    for (const s of ['chat:completions', 'images:generate', 'videos:generate', 'code:generate', 'files:read'] as const) {
      expect(PORTAL_KEY_SCOPES).toContain(s)
    }
  })

  test('assertScope enforces product scopes with the same central gate as chat', async () => {
    const created = await makeKey({ permissions: ['images:generate'] })
    const auth = await verifyApiKey(created.key)
    expect(() => assertScope(auth, 'images:generate')).not.toThrow()
    // Denied OUTSIDE the granted scope — an images key cannot chat.
    expect(() => assertScope(auth, 'chat:completions')).toThrow(/does not grant/)
    expect(() => assertScope(auth, 'videos:generate')).toThrow(/does not grant/)
  })
})

describe('Phase 1 — project-scoped key creation', () => {
  test('a project key is created bound to the project and returns the raw key exactly once', async () => {
    const project = seedProject()
    const created = await makeKey({ permissions: ['chat:completions', 'images:generate'], projectId: project.id })
    expect(created.projectId).toBe(project.id)
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true)
    const row = keyStore.get(created.id)!
    expect(row.projectId).toBe(project.id)
    expect(row.keyHash).toHaveLength(64)
    expect(JSON.stringify(row)).not.toContain(created.key) // raw never persisted
  })

  test('key creation for ANOTHER USER’s project is NOT_FOUND (no existence leak)', async () => {
    const project = seedProject({ userId: ALICE })
    expect(makeKey({ ownerId: BOB, projectId: project.id })).rejects.toThrow(BeanApiError)
    try {
      await makeKey({ ownerId: BOB, projectId: project.id })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
    }
  })

  test('key creation for an UNKNOWN project is NOT_FOUND', async () => {
    expect(makeKey({ ownerId: ALICE, projectId: 'proj-does-not-exist' })).rejects.toThrow(/Project not found/)
  })

  test('an ARCHIVED project cannot mint keys', async () => {
    const project = seedProject({ status: 'archived' })
    try {
      await makeKey({ projectId: project.id })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('VALIDATION_ERROR')
      expect((e as BeanApiError).message).toMatch(/archived/i)
    }
  })

  test('a project-scoped key can NEVER hold the admin wildcard', async () => {
    const project = seedProject()
    try {
      await makeKey({ permissions: ['*'], projectId: project.id })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('VALIDATION_ERROR')
      expect((e as BeanApiError).message).toMatch(/wildcard/i)
    }
    // Control: a legacy key with the same owner CAN hold it.
    expect((await makeKey({ permissions: ['*'] })).projectId).toBeNull()
  })
})

describe('Phase 1 — legacy administrator keys (projectId = null) unchanged', () => {
  test('a legacy key stores null projectId and verifies with null binding', async () => {
    const created = await makeKey({ permissions: ['*'] })
    expect(created.projectId).toBeNull()
    const auth = await verifyApiKey(created.key)
    expect(auth.projectId).toBeNull()
    expect(auth.userId).toBe(ALICE)
    // Wildcard behavior intact.
    expect(() => assertScope(auth, 'chat:completions')).not.toThrow()
    expect(() => assertScope(auth, 'images:generate')).not.toThrow()
  })

  test('existing rotation/revocation semantics are untouched for legacy keys', async () => {
    const created = await makeKey({ permissions: ['chat:completions'] })
    const auth = await verifyApiKey(created.key)
    const rotated = await rotateApiKey(auth.keyId, ALICE)
    expect(rotated.projectId).toBeNull()
    expect(verifyApiKey(created.key)).rejects.toThrow(BeanApiError)
    expect((await verifyApiKey(rotated.key)).projectId).toBeNull()
    await revokeApiKey(rotated.id, ALICE)
    expect(verifyApiKey(rotated.key)).rejects.toThrow(BeanApiError)
  })
})

describe('Phase 1 — verification returns the project binding', () => {
  test('verifyApiKey exposes the bound project for project keys', async () => {
    const project = seedProject()
    const created = await makeKey({ projectId: project.id })
    const auth = await verifyApiKey(created.key)
    expect(auth.projectId).toBe(project.id)
    expect(auth.userId).toBe(ALICE) // attribution still the owner user
  })
})

describe('Phase 1 — central project containment (assertProjectBinding)', () => {
  test('a project key passes its own project and is FORBIDDEN elsewhere', async () => {
    const project = seedProject()
    const other = seedProject()
    const auth = await verifyApiKey((await makeKey({ projectId: project.id })).key)
    expect(() => assertProjectBinding(auth, project.id)).not.toThrow()
    expect(() => assertProjectBinding(auth, other.id)).toThrow(/different project/)
    try {
      assertProjectBinding(auth, other.id)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('FORBIDDEN')
    }
    expect(() => assertProjectBinding(auth, null)).toThrow(BeanApiError)
    expect(() => assertProjectBinding(auth, undefined)).toThrow(BeanApiError)
  })

  test('a legacy key passes any binding (platform-wide)', async () => {
    const auth = await verifyApiKey((await makeKey({ permissions: ['chat:completions'] })).key)
    expect(() => assertProjectBinding(auth, 'any-project')).not.toThrow()
    expect(() => assertProjectBinding(auth, null)).not.toThrow()
  })
})

describe('Phase 1 — rotation preserves the project binding', () => {
  test('rotated key keeps the same project; old key dies', async () => {
    const project = seedProject()
    const created = await makeKey({ projectId: project.id })
    const auth = await verifyApiKey(created.key)
    const rotated = await rotateApiKey(auth.keyId, ALICE)
    expect(rotated.projectId).toBe(project.id)
    expect(verifyApiKey(created.key)).rejects.toThrow(BeanApiError)
    expect((await verifyApiKey(rotated.key)).projectId).toBe(project.id)
  })

  test("another user cannot rotate a project key (ownership enforced)", async () => {
    const project = seedProject({ userId: ALICE })
    const created = await makeKey({ projectId: project.id })
    const auth = await verifyApiKey(created.key)
    expect(rotateApiKey(auth.keyId, BOB)).rejects.toThrow(BeanApiError)
  })
})
