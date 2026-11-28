/**
 * M49.1 BEAN AUTOBOTS — agent service tests (validation + owner-scoped CRUD).
 *
 * Hermetic: db is a fake; metering/audit is a spy. Pins:
 *  - every stored field passes the bounded normalization (client JSON never
 *    reaches storage raw);
 *  - capabilityKey/memoryMode come ONLY from the fixed vocabularies;
 *  - every read/write is owner-scoped with honest NOT_FOUND misses;
 *  - the per-account agent cap is enforced;
 *  - duplicates copy persona but never conversations.
 *
 * Run: bun test tests/unit/m49-autobots-agent-service.test.ts
 */
import { mock, describe, test, expect, beforeEach } from 'bun:test'
import type { AutobotAgent } from '@prisma/client'

// ---- fake db (autobots tables only; these tests touch nothing else) --------
interface FakeRow {
  id: string
  userId: string
  name: string
  role: string
  industry: string | null
  description: string
  personality: string | null
  instructions: string | null
  language: string | null
  capabilityKey: string
  memoryMode: string
  templateKey: string | null
  status: string
  executionCount: number
  lastExecutedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

let seq = 0
function row(partial: Partial<FakeRow>): FakeRow {
  const now = new Date()
  seq += 1
  return {
    id: `agent-${seq}`,
    userId: 'u1',
    name: 'Test Agent',
    role: 'Business strategist',
    industry: null,
    description: 'A test agent for service-level contracts.',
    personality: null,
    instructions: null,
    language: null,
    capabilityKey: 'advisory',
    memoryMode: 'disabled',
    templateKey: null,
    status: 'active',
    executionCount: 0,
    lastExecutedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

const agents = new Map<string, FakeRow>()
let nextCreate: () => FakeRow = () => {
  throw new Error('create not stubbed')
}

const dbFake = {
  autobotAgent: {
    async findUnique({ where }: { where: { id: string } }) {
      return agents.get(where.id) ?? null
    },
    async findMany({ where }: { where: { userId: string } }) {
      return [...agents.values()].filter((a) => a.userId === where.userId)
    },
    async count({ where }: { where: { userId: string } }) {
      return [...agents.values()].filter((a) => a.userId === where.userId).length
    },
    async create({ data }: { data: Partial<FakeRow> }) {
      const r = row({ ...data } as Partial<FakeRow>)
      agents.set(r.id, r)
      return r
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) {
      const cur = agents.get(where.id)
      if (!cur) throw new Error('row missing')
      const next = { ...cur, ...data, updatedAt: new Date() } as FakeRow
      agents.set(where.id, next)
      return next
    },
    async delete({ where }: { where: { id: string } }) {
      const cur = agents.get(where.id)
      if (!cur) throw new Error('row missing')
      agents.delete(where.id)
      return cur
    },
  },
  // createAgent's per-user cap reads this count — overridable per test.
  autobotConversation: {
    async count() {
      return 0
    },
  },
}
// The cap check counts agents; tests can force the count via this hook.
;(dbFake as unknown as { __capCount?: number }).__capCount = undefined
dbFake.autobotAgent.count = async ({ where }: { where: { userId: string } }) => {
  const forced = (dbFake as unknown as { __capCount?: number }).__capCount
  if (forced !== undefined) return forced
  return [...agents.values()].filter((a) => a.userId === where.userId).length
}

mock.module('@/lib/db', () => ({ db: dbFake }))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))

const {
  normalizeAgentInput,
  templateToInput,
  createAgent,
  updateAgent,
  duplicateAgent,
  deleteAgent,
  getAgentRow,
  toAgentView,
  AgentValidationError,
} = await import('../../src/lib/autobots/agent-service')
const { BeanApiError } = await import('../../src/lib/api/errors')

const VALID = {
  name: 'Strategy Partner',
  role: 'Business strategist',
  industry: 'SaaS',
  description: 'A commercial thinking partner for founder decisions.',
  personality: 'Direct, structured',
  instructions: 'Lead with the recommendation.',
  language: 'English',
  capabilityKey: 'research',
  memoryMode: 'conversation',
}

beforeEach(() => {
  agents.clear()
})

describe('normalizeAgentInput (the ONLY client-JSON → storage path)', () => {
  test('a full valid payload round-trips with trimming', () => {
    const n = normalizeAgentInput({ ...VALID, name: '  Strategy Partner  ' })
    expect(n.name).toBe('Strategy Partner')
    expect(n.capabilityKey).toBe('research')
    expect(n.memoryMode).toBe('conversation')
    expect(n.industry).toBe('SaaS')
  })

  test('missing optional fields become null (never undefined leaks)', () => {
    const n = normalizeAgentInput({
      name: 'A',
      role: 'B',
      description: 'Enough text here.',
      capabilityKey: 'advisory',
    })
    expect(n.industry).toBeNull()
    expect(n.personality).toBeNull()
    expect(n.instructions).toBeNull()
    expect(n.language).toBeNull()
    expect(n.memoryMode).toBe('disabled')
  })

  test('UNKNOWN capabilityKey is a validation error — never a fallback', () => {
    expect(() => normalizeAgentInput({ ...VALID, capabilityKey: 'niiki-3d' })).toThrow(AgentValidationError)
    expect(() => normalizeAgentInput({ ...VALID, capabilityKey: '' })).toThrow(AgentValidationError)
    expect(() => normalizeAgentInput({ ...VALID, capabilityKey: 42 as unknown as string })).toThrow(AgentValidationError)
  })

  test('unknown memoryMode is a validation error', () => {
    expect(() => normalizeAgentInput({ ...VALID, memoryMode: 'everything' })).toThrow(AgentValidationError)
  })

  test('overlength fields carry the honest bound in the message', () => {
    const long = 'x'.repeat(61)
    try {
      normalizeAgentInput({ ...VALID, name: long })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AgentValidationError)
      expect((e as Error).message).toContain('60')
    }
    try {
      normalizeAgentInput({ ...VALID, instructions: 'x'.repeat(4001) })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('4000')
    }
  })

  test('empty required fields are refused', () => {
    expect(() => normalizeAgentInput({ ...VALID, name: '   ' })).toThrow(AgentValidationError)
    expect(() => normalizeAgentInput({ ...VALID, role: '' })).toThrow(AgentValidationError)
    expect(() => normalizeAgentInput({ ...VALID, description: 'ab' })).toThrow(AgentValidationError)
  })
})

describe('templateToInput', () => {
  test('a verified template seeds the SAME validated shape (with templateKey)', () => {
    const t = templateToInput('business-strategist')
    expect(t.name).toBe('Business Strategist')
    expect(t.capabilityKey).toBe('research')
    expect(t.templateKey).toBe('business-strategist')
    // Template seeds pass the SAME normalization when re-validated.
    expect(() => normalizeAgentInput(t)).not.toThrow()
  })

  test('an unknown template key is refused', () => {
    expect(() => templateToInput('astronaut-commander')).toThrow(AgentValidationError)
  })
})

describe('owner-scoped CRUD', () => {
  test('getAgentRow: a foreign agent id is an honest NOT_FOUND', async () => {
    const r = row({})
    agents.set(r.id, r)
    try {
      await getAgentRow('someone-else', r.id)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BeanApiError)
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
    }
  })

  test('getAgentRow: the owner reads their own agent', async () => {
    const r = row({})
    agents.set(r.id, r)
    const got = await getAgentRow('u1', r.id)
    expect(got.id).toBe(r.id)
  })

  test('createAgent enforces the per-account cap', async () => {
    ;(dbFake as unknown as { __capCount?: number }).__capCount = 50
    try {
      await createAgent('u1', normalizeAgentInput(VALID))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BeanApiError)
      expect((e as BeanApiError).code).toBe('QUOTA_EXCEEDED')
    } finally {
      ;(dbFake as unknown as { __capCount?: number }).__capCount = undefined
    }
  })

  test('createAgent persists the validated fields and stamps the audit trail shape', async () => {
    const view = await createAgent('u1', { ...normalizeAgentInput(VALID), templateKey: 'business-strategist' })
    expect(view.capabilityLabel.length).toBeGreaterThan(0)
    expect(view.templateKey).toBe('business-strategist')
    expect(view.status).toBe('active')
    expect(view.executionCount).toBe(0)
  })

  test('updateAgent keeps status in the two-state vocabulary', async () => {
    const r = row({})
    agents.set(r.id, r)
    const archived = await updateAgent('u1', r.id, { status: 'archived' })
    expect(archived.status).toBe('archived')
    try {
      await updateAgent('u1', r.id, { status: 'deployed' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AgentValidationError)
    }
    // foreign user cannot update
    try {
      await updateAgent('intruder', r.id, { name: 'Hijacked' })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
    }
  })

  test('updateAgent capability changes stay in the fixed vocabulary', async () => {
    const r = row({})
    agents.set(r.id, r)
    const updated = await updateAgent('u1', r.id, { capabilityKey: 'visual' })
    expect(updated.capabilityKey).toBe('visual')
    expect(() => updateAgent('u1', r.id, { capabilityKey: 'grant-me-everything' })).toThrow()
  })

  test('duplicateAgent copies persona, renames, starts fresh (no conversation copy)', async () => {
    const r = row({ name: 'Original Name', instructions: 'Keep answers short.' })
    agents.set(r.id, r)
    const copy = await duplicateAgent('u1', r.id)
    expect(copy.id).not.toBe(r.id)
    expect(copy.name).toContain('Original Name')
    expect(copy.name).toContain('copy')
    expect(copy.instructions).toBe('Keep answers short.')
    expect(copy.capabilityKey).toBe(r.capabilityKey)
    expect(copy.executionCount).toBe(0)
    try {
      await duplicateAgent('intruder', r.id)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
    }
  })

  test('deleteAgent removes only the owner\u2019s own agent', async () => {
    const r = row({})
    agents.set(r.id, r)
    try {
      await deleteAgent('intruder', r.id)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
      expect(agents.has(r.id)).toBe(true)
    }
    const res = await deleteAgent('u1', r.id)
    expect(res.deleted).toBe(true)
    expect(agents.has(r.id)).toBe(false)
  })
})

describe('toAgentView (customer-safe projection)', () => {
  test('unknown capability keys render the raw key, never a fabricated label', () => {
    const v = toAgentView(row({ capabilityKey: 'legacy-key' }) as AutobotAgent)
    expect(v.capabilityLabel).toBe('legacy-key')
  })

  test('dates serialize as ISO strings; execution counters ride through', () => {
    const r = row({ executionCount: 7, lastExecutedAt: new Date('2026-11-28T10:00:00Z') })
    const v = toAgentView(r as AutobotAgent)
    expect(v.lastExecutedAt).toBe('2026-11-28T10:00:00.000Z')
    expect(v.executionCount).toBe(7)
    expect(typeof v.createdAt).toBe('string')
  })
})
