/**
 * M49.2 BEAN AUTOBOT TEAMS — team service tests (validation + owner-scoped
 * CRUD) with the same hermetic discipline as the M49.1 agent-service suite.
 *
 * Pins:
 *  - every stored field passes the bounded normalization (client JSON never
 *    reaches storage raw);
 *  - workflow/assignment preferences come ONLY from the fixed vocabularies;
 *  - every read/write is owner-scoped with honest NOT_FOUND misses;
 *  - membership rules: same-owner ACTIVE agents only, 2..8 members, no
 *    duplicates, leader must be a member;
 *  - the per-account team cap is enforced;
 *  - archive/delete refuse while a team mission is ACTIVE (never silently
 *    damage a running mission);
 *  - duplicates copy the roster but never mission history;
 *  - template instantiation reuses the user's existing agents and rides the
 *    SAME validation as a custom team.
 *
 * Run: bun test tests/unit/m49-2-team-service.test.ts
 */
import { mock, describe, test, expect, beforeEach } from 'bun:test'

// ---- fake db (teams + agents + missions) ------------------------------------

interface FakeAgent {
  id: string; userId: string; name: string; role: string
  capabilityKey: string; status: string; templateKey: string | null
  instructions: string | null; personality: string | null
}
interface FakeTeam {
  id: string; userId: string; name: string; description: string
  leaderMemberId: string | null; workflowPreference: string; assignmentPreference: string
  templateKey: string | null; status: string; createdAt: Date; updatedAt: Date
}
interface FakeMember {
  id: string; teamId: string; agentId: string; responsibility: string; orderIndex: number
}
interface FakeMission {
  id: string; userId: string; teamId: string | null; status: string
  createdAt: Date; startedAt: Date | null
}

const agents = new Map<string, FakeAgent>()
const teams = new Map<string, FakeTeam>()
const members = new Map<string, FakeMember>()
const missions = new Map<string, FakeMission>()

let seq = 0
const nextId = (p: string) => `${p}-${++seq}`

/** Attach member rows (with their agent) to a fake team row — mirrors the
 *  service's `includeMembers` read shape. */
function membersFor(teamId: string) {
  return [...members.values()]
    .filter((m) => m.teamId === teamId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((m) => ({ ...m, agent: agents.get(m.agentId) ?? null }))
}

function agentRow(partial: Partial<FakeAgent>): FakeAgent & Record<string, unknown> {
  const now = new Date()
  return {
    id: nextId('agent'), userId: 'u1', name: 'Test Agent', role: 'Specialist',
    capabilityKey: 'research', status: 'active', templateKey: null,
    instructions: null, personality: null,
    // The agent-service view layer expects these real-row fields (they ride
    // the shared createAgent path during template instantiation).
    executionCount: 0, lastExecutedAt: null, createdAt: now, updatedAt: now,
    memoryMode: 'disabled', industry: null, description: 'Test agent', language: null,
    ...partial,
  }
}

const dbFake = {
  autobotAgent: {
    async findMany({ where }: { where: { id?: { in?: string[] }, userId?: string, templateKey?: string, status?: string } }) {
      let rows = [...agents.values()]
      if (where.id?.in) rows = rows.filter((a) => where.id!.in!.includes(a.id))
      if (where.userId) rows = rows.filter((a) => a.userId === where.userId)
      if (where.templateKey) rows = rows.filter((a) => a.templateKey === where.templateKey)
      if (where.status) rows = rows.filter((a) => a.status === where.status)
      return rows
    },
    async count({ where }: { where: { userId: string } }) {
      return [...agents.values()].filter((a) => a.userId === where.userId).length
    },
    async findFirst({ where }: { where: { userId?: string; templateKey?: string; status?: string } }) {
      const rows = [...agents.values()].filter(
        (a) =>
          (!where.userId || a.userId === where.userId) &&
          (!where.templateKey || a.templateKey === where.templateKey) &&
          (!where.status || a.status === where.status),
      )
      return rows[0] ?? null
    },
    async create({ data }: { data: Partial<FakeAgent> }) {
      const r = agentRow(data)
      agents.set(r.id, r)
      return r
    },
  },
  autobotTeam: {
    async findMany({ where }: { where: { userId: string } }) {
      return [...teams.values()]
        .filter((t) => t.userId === where.userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((t) => ({ ...t, members: membersFor(t.id) }))
    },
    async findUnique({ where }: { where: { id: string } }) {
      const t = teams.get(where.id)
      return t ? { ...t, members: membersFor(t.id) } : null
    },
    async count({ where }: { where: { userId: string } }) {
      return [...teams.values()].filter((t) => t.userId === where.userId).length
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const now = new Date()
      const t: FakeTeam = {
        id: nextId('team'), userId: 'u1', name: '', description: '',
        leaderMemberId: null, workflowPreference: 'auto', assignmentPreference: 'team-order',
        templateKey: null, status: 'active', createdAt: now, updatedAt: now,
        ...(data as Partial<FakeTeam>),
      }
      teams.set(t.id, t)
      return t
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakeTeam> }) {
      const cur = teams.get(where.id)
      if (!cur) throw new Error('team missing')
      const next = { ...cur, ...data, updatedAt: new Date() }
      teams.set(where.id, next)
      return next
    },
    async delete({ where }: { where: { id: string } }) {
      const cur = teams.get(where.id)
      if (!cur) throw new Error('team missing')
      teams.delete(where.id)
      return cur
    },
  },
  autobotTeamMember: {
    async findMany({ where }: { where: { teamId?: string }, orderBy?: unknown }) {
      let rows = [...members.values()]
      if (where.teamId) rows = rows.filter((m) => m.teamId === where.teamId)
      return rows.sort((a, b) => a.orderIndex - b.orderIndex)
    },
    async deleteMany({ where }: { where: { teamId: string } }) {
      let n = 0
      for (const [id, m] of members) {
        if (m.teamId === where.teamId) {
          members.delete(id)
          n += 1
        }
      }
      return { count: n }
    },
    async create({ data }: { data: { teamId: string; agentId: string; responsibility: string; orderIndex: number } }) {
      const m: FakeMember = { id: nextId('member'), ...data }
      members.set(m.id, m)
      return m
    },
  },
  agentMission: {
    async findMany({ where }: { where: { userId: string; teamId?: { in?: string[] } } }) {
      let rows = [...missions.values()].filter((m) => m.userId === where.userId)
      if (where.teamId?.in) rows = rows.filter((m) => m.teamId && where.teamId!.in!.includes(m.teamId))
      return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },
    async findFirst({ where }: { where: { teamId?: string; userId?: string; status?: { in?: string[] } } }) {
      const rows = [...missions.values()].filter(
        (m) =>
          (!where.teamId || m.teamId === where.teamId) &&
          (!where.userId || m.userId === where.userId) &&
          (!where.status?.in || where.status.in.includes(m.status)),
      )
      return rows[0] ?? null
    },
  },
}

mock.module('@/lib/db', () => ({ db: dbFake }))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))
mock.module('@/lib/auth/ratelimit', () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 10, retryAfterSec: 0 }),
}))

const {
  createTeam,
  createTeamFromTemplate,
  deleteTeam,
  duplicateTeam,
  getTeamRow,
  getTeamView,
  listTeams,
  normalizeTeamInput,
  TeamValidationError,
  updateTeam,
} = await import('../../src/lib/autobots/teams/team-service')

const BeanApiError = (await import('@/lib/api/errors')).BeanApiError

function seedAgents() {
  agents.clear()
  const a1 = agentRow({ id: 'a1', name: 'Researcher', capabilityKey: 'research', userId: 'u1' })
  const a2 = agentRow({ id: 'a2', name: 'Engineer', capabilityKey: 'engineering', userId: 'u1' })
  const a3 = agentRow({ id: 'a3', name: 'Foreign Agent', capabilityKey: 'visual', userId: 'u2' })
  const a4 = agentRow({ id: 'a4', name: 'Archived', capabilityKey: 'voice', status: 'archived', userId: 'u1' })
  for (const a of [a1, a2, a3, a4]) agents.set(a.id, a)
}

function teamInput() {
  return {
    name: 'Launch Squad',
    description: 'A small launch team',
    workflowPreference: 'auto',
    assignmentPreference: 'team-order',
    members: [
      { agentId: 'a1', responsibility: 'Research lead' },
      { agentId: 'a2', responsibility: 'Builds things' },
    ],
    leaderAgentId: null as string | null,
  }
}

beforeEach(() => {
  seedAgents()
  teams.clear()
  members.clear()
  missions.clear()
})

describe('M49.2 team service — bounded normalization', () => {
  test('every stored field passes the bounded normalization', () => {
    const n = normalizeTeamInput({
      name: '  Squad   One  ',
      description: 'desc',
      workflowPreference: 'research-first',
      assignmentPreference: 'leader-first',
      members: [
        { agentId: ' a1 ', responsibility: '  Lead  ' },
        { agentId: 'a2' },
      ],
      leaderAgentId: 'a1',
    })
    expect(n.name).toBe('Squad One')
    expect(n.workflowPreference).toBe('research-first')
    expect(n.assignmentPreference).toBe('leader-first')
    expect(n.members[0].agentId).toBe('a1')
    expect(n.members[0].responsibility).toBe('Lead')
    expect(n.members[1].responsibility).toBe('')
    expect(n.leaderAgentId).toBe('a1')
  })

  test('vocabularies are honest 422s — never silent fallbacks', () => {
    expect(() => normalizeTeamInput({ ...teamInput(), workflowPreference: 'chaos-mode' })).toThrow(TeamValidationError)
    expect(() => normalizeTeamInput({ ...teamInput(), assignmentPreference: 'random' })).toThrow(TeamValidationError)
    expect(() => normalizeTeamInput({ ...teamInput(), name: '' })).toThrow(TeamValidationError)
    expect(() => normalizeTeamInput({ ...teamInput(), name: 'x'.repeat(200) })).toThrow(TeamValidationError)
    expect(() => normalizeTeamInput({ ...teamInput(), members: [{ agentId: 'a1', responsibility: 'r'.repeat(500) }, { agentId: 'a2' }] })).toThrow(TeamValidationError)
  })

  test('size boundaries: below minimum and above maximum are refused', () => {
    expect(() => normalizeTeamInput({ ...teamInput(), members: [{ agentId: 'a1' }] })).toThrow(TeamValidationError)
    expect(() =>
      normalizeTeamInput({
        ...teamInput(),
        members: Array.from({ length: 9 }, (_, i) => ({ agentId: `x${i}`, responsibility: '' })),
      }),
    ).toThrow(TeamValidationError)
    // Duplicate members are rejected.
    expect(() =>
      normalizeTeamInput({ ...teamInput(), members: [{ agentId: 'a1' }, { agentId: 'a1' }] }),
    ).toThrow(TeamValidationError)
  })
})

describe('M49.2 team service — owner-scoped CRUD', () => {
  test('create persists the team + ordered roster and resolves the leader', async () => {
    const view = await createTeam('u1', { ...teamInput(), leaderAgentId: 'a2' })
    expect(view.name).toBe('Launch Squad')
    expect(view.members.length).toBe(2)
    expect(view.members[0].orderIndex).toBe(0)
    expect(view.members.find((m) => m.agentId === 'a2')?.isLeader).toBe(true)
    expect(view.members.find((m) => m.agentId === 'a1')?.isLeader).toBe(false)
    // No leader ⇒ default-first-member semantics.
    const view2 = await createTeam('u1', teamInput())
    expect(view2.members[0].isLeader).toBe(true)
  })

  test('same-owner membership enforcement: foreign agents are honest NOT_FOUND', async () => {
    await createTeam('u1', teamInput())
    let thrown: unknown = null
    try {
      await createTeam('u1', { ...teamInput(), members: [{ agentId: 'a1' }, { agentId: 'a3' }] })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BeanApiError)
    expect((thrown as { code: string }).code).toBe('NOT_FOUND')
  })

  test('archived agents are refused as members with an honest message', async () => {
    let thrown: unknown = null
    try {
      await createTeam('u1', { ...teamInput(), members: [{ agentId: 'a1' }, { agentId: 'a4' }] })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TeamValidationError)
    expect((thrown as Error).message).toContain('archived')
  })

  test('foreign team ids are honest 404s (no existence leak)', async () => {
    await createTeam('u1', teamInput())
    const foreign = [...teams.values()][0]
    let thrown: unknown = null
    try {
      await getTeamRow('u2', foreign.id)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BeanApiError)
    expect((thrown as { code: string }).code).toBe('NOT_FOUND')
  })

  test('per-account team cap is enforced', async () => {
    for (let i = 0; i < 30; i++) {
      await createTeam('u1', { ...teamInput(), name: `Team ${i}` })
    }
    let thrown: unknown = null
    try {
      await createTeam('u1', { ...teamInput(), name: 'One too many' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BeanApiError)
    expect((thrown as { code: string }).code).toBe('QUOTA_EXCEEDED')
  })

  test('roster replace re-validates ownership and archives; leader must be a member agent', async () => {
    const view = await createTeam('u1', teamInput())
    const updated = await updateTeam('u1', view.id, {
      members: [
        { agentId: 'a2', responsibility: 'Now leads' },
        { agentId: 'a1', responsibility: 'Research' },
      ],
      leaderAgentId: 'a2',
    })
    expect(updated.members[0].agentId).toBe('a2')
    expect(updated.members[0].isLeader).toBe(true)
    // Leader change to a non-member is refused.
    let thrown: unknown = null
    try {
      await updateTeam('u1', view.id, { leaderAgentId: 'a3' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TeamValidationError)
  })
})

describe('M49.2 team service — active-mission protection + lifecycle', () => {
  test('archive and delete REFUSE while a team mission is planned/running', async () => {
    const view = await createTeam('u1', teamInput())
    missions.set('m-active', {
      id: 'm-active', userId: 'u1', teamId: view.id, status: 'running',
      createdAt: new Date(), startedAt: new Date(),
    })
    for (const op of ['archive', 'delete'] as const) {
      let thrown: unknown = null
      try {
        if (op === 'delete') await deleteTeam('u1', view.id)
        else await updateTeam('u1', view.id, { status: 'archived' })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(BeanApiError)
      expect((thrown as { code: string }).code).toBe('EDIT_CONFLICT')
    }
    // The team still exists and is still active.
    expect((await getTeamView('u1', view.id)).status).toBe('active')
  })

  test('archive/restore/delete work cleanly once no mission is active', async () => {
    const view = await createTeam('u1', teamInput())
    missions.set('m-done', {
      id: 'm-done', userId: 'u1', teamId: view.id, status: 'completed',
      createdAt: new Date(), startedAt: new Date(),
    })
    const archived = await updateTeam('u1', view.id, { status: 'archived' })
    expect(archived.status).toBe('archived')
    const restored = await updateTeam('u1', view.id, { status: 'active' })
    expect(restored.status).toBe('active')
    const result = await deleteTeam('u1', view.id)
    expect(result.deleted).toBe(true)
    let thrown: unknown = null
    try {
      await getTeamRow('u1', view.id)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(BeanApiError)
  })

  test('duplicate copies the roster (same agents/order) but never mission history', async () => {
    const view = await createTeam('u1', teamInput())
    const copy = await duplicateTeam('u1', view.id)
    expect(copy.id).not.toBe(view.id)
    expect(copy.name).toContain('(copy)')
    expect(copy.members.map((m) => m.agentId)).toEqual(view.members.map((m) => m.agentId))
    expect(copy.stats.completedMissions).toBe(0)
  })

  test('team stats are DERIVED from real mission rows (delivered count, last run, active mission)', async () => {
    const view = await createTeam('u1', teamInput())
    const base = Date.now()
    missions.set('m1', { id: 'm1', userId: 'u1', teamId: view.id, status: 'completed', createdAt: new Date(base), startedAt: new Date(base) })
    missions.set('m2', { id: 'm2', userId: 'u1', teamId: view.id, status: 'completed_partial', createdAt: new Date(base + 1), startedAt: new Date(base + 1) })
    missions.set('m3', { id: 'm3', userId: 'u1', teamId: view.id, status: 'failed', createdAt: new Date(base + 2), startedAt: new Date(base + 2) })
    const fresh = await getTeamView('u1', view.id)
    expect(fresh.stats.completedMissions).toBe(2) // completed + completed_partial, honestly counted
    expect(fresh.stats.lastMissionAt).not.toBeNull()
    expect(fresh.stats.activeMissionId).toBeNull()
    missions.set('m4', { id: 'm4', userId: 'u1', teamId: view.id, status: 'running', createdAt: new Date(base + 3), startedAt: null })
    const withActive = await getTeamView('u1', view.id)
    expect(withActive.stats.activeMissionId).toBe('m4')
    // Other users' missions never leak into the stats.
    missions.set('m5', { id: 'm5', userId: 'u2', teamId: view.id, status: 'running', createdAt: new Date(base + 4), startedAt: null })
    const scoped = await getTeamView('u1', view.id)
    expect(scoped.stats.activeMissionId).toBe('m4')
  })
})

describe('M49.2 team service — template instantiation', () => {
  test('a team template composes REAL agents through the same validation', async () => {
    const view = await createTeamFromTemplate('u1', 'research-team')
    expect(view.templateKey).toBe('research-team')
    expect(view.members.length).toBe(4)
    const caps = new Set(view.members.map((m) => m.capabilityKey))
    expect(caps.has('research')).toBe(true)
    expect(caps.has('engineering')).toBe(true) // the document-deliverable member
    // Every created agent is owned by the caller.
    for (const m of view.members) {
      expect(agents.get(m.agentId)?.userId).toBe('u1')
    }
  })

  test('template instantiation REUSES existing active agents from the same template', async () => {
    const seeded = agentRow({ id: 'existing-eng', userId: 'u1', templateKey: 'software-engineer', capabilityKey: 'engineering', name: 'Software Engineer' })
    agents.set(seeded.id, seeded)
    const before = agents.size
    await createTeamFromTemplate('u1', 'website-production-team')
    // The engineer seat reused the existing agent (no duplicate created).
    const countOf = [...agents.values()].filter((a) => a.templateKey === 'software-engineer' && a.userId === 'u1').length
    expect(countOf).toBe(1)
    expect(agents.size).toBeGreaterThan(before) // other members were created
  })

  test('unknown templates and the empty custom-team template are honest 422s', async () => {
    let thrown: unknown = null
    try {
      await createTeamFromTemplate('u1', 'no-such-team')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TeamValidationError)
    thrown = null
    try {
      await createTeamFromTemplate('u1', 'custom-team')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TeamValidationError)
    expect((thrown as Error).message).toContain('empty roster')
  })

  test('listTeams is owner-scoped end to end', async () => {
    await createTeam('u1', teamInput())
    const mine = await listTeams('u1')
    expect(mine.length).toBe(1)
    expect((await listTeams('u2')).length).toBe(0)
  })
})
