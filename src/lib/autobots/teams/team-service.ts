/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS service (SERVER ONLY).
 *
 * Owner-scoped CRUD for user-configured team compositions over their OWN
 * Autobot agents. Mirrors the M49.1 agent-service discipline:
 *
 *  - every field passes bounded normalization here — API routes NEVER trust
 *    raw client shapes; vocabulary comes ONLY from the pure modules;
 *  - every read/write is owner-scoped: rows matched by (id, userId), a miss
 *    is an honest NOT_FOUND (no existence leak across users);
 *  - membership rules: same-owner agents only, active agents only, unique
 *    per team, 2..8 members, leader must be a member of the same team;
 *  - active-mission protection: a team with a planned/running mission
 *    refuses archive and delete (an active mission is never silently
 *    damaged); missions already carry their immutable snapshot, so edits
 *    never change a running mission's execution context anyway;
 *  - rate limits + audit records ride the existing metering/ratelimit.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import {
  TEAM_LIMITS,
  TEAM_WORKFLOW_PREFERENCES,
  TEAM_ASSIGNMENT_PREFERENCES,
  getTeamTemplate,
} from './catalog'

// ---------------------------------------------------------------------------
// Public view shapes (customer-safe; no internals)
// ---------------------------------------------------------------------------

export interface AutobotTeamMemberView {
  id: string
  agentId: string
  agentName: string
  agentRole: string
  capabilityKey: string
  capabilityLabel: string
  responsibility: string
  orderIndex: number
  isLeader: boolean
  agentStatus: string
}

export interface AutobotTeamStats {
  completedMissions: number
  lastMissionAt: string | null
  activeMissionId: string | null
}

export interface AutobotTeamView {
  id: string
  name: string
  description: string
  leaderMemberId: string | null
  workflowPreference: string
  assignmentPreference: string
  templateKey: string | null
  status: string
  members: AutobotTeamMemberView[]
  stats: AutobotStats
  createdAt: string
  updatedAt: string
}

type AutobotStats = AutobotTeamStats

interface MemberRow {
  id: string
  teamId: string
  agentId: string
  responsibility: string
  orderIndex: number
  agent: {
    id: string
    name: string
    role: string
    capabilityKey: string
    status: string
  } | null
}

interface TeamRow {
  id: string
  userId: string
  name: string
  description: string
  leaderMemberId: string | null
  workflowPreference: string
  assignmentPreference: string
  templateKey: string | null
  status: string
  createdAt: Date
  updatedAt: Date
  members?: MemberRow[]
}

import { CAPABILITY_INFO, isAutobotCapability } from '../catalog'

function memberView(m: MemberRow): AutobotTeamMemberView | null {
  if (!m.agent) return null // agent deleted → cascade removes the row; guard reads anyway
  const cap = isAutobotCapability(m.agent.capabilityKey) ? CAPABILITY_INFO[m.agent.capabilityKey] : null
  return {
    id: m.id,
    agentId: m.agentId,
    agentName: m.agent.name,
    agentRole: m.agent.role,
    capabilityKey: m.agent.capabilityKey,
    capabilityLabel: cap?.label ?? m.agent.capabilityKey,
    responsibility: m.responsibility,
    orderIndex: m.orderIndex,
    isLeader: false, // set by the team view builder
    agentStatus: m.agent.status,
  }
}

function teamView(team: TeamRow, stats: AutobotStats): AutobotTeamView {
  const members = (team.members ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(memberView)
    .filter((m): m is AutobotTeamMemberView => m !== null)
    .map((m) => ({ ...m, isLeader: team.leaderMemberId ? m.id === team.leaderMemberId : m.orderIndex === 0 }))
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    leaderMemberId: team.leaderMemberId,
    workflowPreference: team.workflowPreference,
    assignmentPreference: team.assignmentPreference,
    templateKey: team.templateKey,
    status: team.status,
    members,
    stats,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Bounded input normalization — the ONLY path from client JSON to storage
// ---------------------------------------------------------------------------

export class TeamValidationError extends Error {}

export interface NormalizedMemberInput {
  agentId: string
  responsibility: string
}

export interface NormalizedTeamInput {
  name: string
  description: string
  workflowPreference: string
  /** The deterministic multi-member assignment rule (pure ordering). */
  assignmentPreference: string
  members: NormalizedMemberInput[]
  /** The leader as an AGENT id (resolved to the member row after write). */
  leaderAgentId: string | null
}

function boundedText(value: unknown, min: number, max: number, field: string): string {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (s.length < min) throw new TeamValidationError(`${field} must be at least ${min} character${min === 1 ? '' : 's'}.`)
  if (s.length > max) throw new TeamValidationError(`${field} must be at most ${max} characters.`)
  return s
}

function boundedOptional(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return ''
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length > max) throw new TeamValidationError(`${field} must be at most ${max} characters.`)
  return s
}

/** Normalize + validate a team create/update payload. Unknown workflow
 *  preferences, out-of-bounds sizes, duplicate members and non-string agent
 *  ids are honest 422s — never a fallback. */
export function normalizeTeamInput(input: unknown): NormalizedTeamInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const name = boundedText(rec.name, 1, TEAM_LIMITS.nameChars, 'Team name')
  const description = boundedOptional(rec.description, TEAM_LIMITS.descriptionChars, 'Team description')
  const workflowPreference = typeof rec.workflowPreference === 'string' && rec.workflowPreference !== '' ? rec.workflowPreference : 'auto'
  if (!(TEAM_WORKFLOW_PREFERENCES as readonly string[]).includes(workflowPreference)) {
    throw new TeamValidationError(`Workflow preference must be one of: ${TEAM_WORKFLOW_PREFERENCES.join(', ')}.`)
  }
  const assignmentPreference = typeof rec.assignmentPreference === 'string' && rec.assignmentPreference !== '' ? rec.assignmentPreference : 'team-order'
  if (!(TEAM_ASSIGNMENT_PREFERENCES as readonly string[]).includes(assignmentPreference)) {
    throw new TeamValidationError(`Assignment preference must be one of: ${TEAM_ASSIGNMENT_PREFERENCES.join(', ')}.`)
  }
  const rawMembers = Array.isArray(rec.members) ? rec.members : []
  if (rawMembers.length < TEAM_LIMITS.minMembers || rawMembers.length > TEAM_LIMITS.maxMembers) {
    throw new TeamValidationError(`A team needs ${TEAM_LIMITS.minMembers} to ${TEAM_LIMITS.maxMembers} members.`)
  }
  const seen = new Set<string>()
  const members: NormalizedMemberInput[] = []
  for (const raw of rawMembers) {
    const m = (raw ?? {}) as Record<string, unknown>
    const agentId = typeof m.agentId === 'string' ? m.agentId.trim() : ''
    if (!agentId || agentId.length > 64) throw new TeamValidationError('Every member needs a valid agent id.')
    if (seen.has(agentId)) throw new TeamValidationError('The same agent cannot join the team twice.')
    seen.add(agentId)
    members.push({ agentId, responsibility: boundedOptional(m.responsibility, TEAM_LIMITS.responsibilityChars, 'Member responsibility') })
  }
  let leaderAgentId: string | null = null
  if (typeof rec.leaderAgentId === 'string' && rec.leaderAgentId.trim().length > 0) {
    leaderAgentId = rec.leaderAgentId.trim().slice(0, 64)
  }
  return { name, description, workflowPreference, assignmentPreference, members, leaderAgentId }
}

// ---------------------------------------------------------------------------
// CRUD (owner-scoped)
// ---------------------------------------------------------------------------

function crudRateLimit(userId: string): void {
  const rl = checkRateLimit(`autobots-teams-crud:${userId}`, TEAM_LIMITS.crudBurstLimit, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError('RATE_LIMITED', `Too many team changes — try again in ${rl.retryAfterSec}s.`)
  }
}

async function missionStatsFor(userId: string, teamIds: readonly string[]): Promise<Map<string, AutobotStats>> {
  const stats = new Map<string, AutobotStats>()
  if (teamIds.length === 0) return stats
  const missions = await db.agentMission.findMany({
    where: { userId, teamId: { in: [...teamIds] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, teamId: true, status: true, createdAt: true, startedAt: true },
    take: 500,
  })
  for (const teamId of teamIds) {
    stats.set(teamId, { completedMissions: 0, lastMissionAt: null, activeMissionId: null })
  }
  // Missions arrive newest-first; the first active mission seen per team is
  // the latest one. Stats are DERIVED from real mission rows — never
  // counters that could drift from the truth.
  for (const m of missions) {
    if (!m.teamId) continue
    const s = stats.get(m.teamId)
    if (!s) continue
    if (m.status === 'completed' || m.status === 'completed_partial') s.completedMissions += 1
    if ((m.status === 'planned' || m.status === 'running') && !s.activeMissionId) s.activeMissionId = m.id
    if (!s.lastMissionAt) s.lastMissionAt = (m.startedAt ?? m.createdAt).toISOString()
  }
  return stats
}

const includeMembers = { members: { orderBy: { orderIndex: 'asc' as const }, include: { agent: { select: { id: true, name: true, role: true, capabilityKey: true, status: true } } } } }

export async function listTeams(userId: string): Promise<AutobotTeamView[]> {
  const rows = (await db.autobotTeam.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: includeMembers,
  })) as unknown as TeamRow[]
  const stats = await missionStatsFor(userId, rows.map((r) => r.id))
  return rows.map((r) => teamView(r, stats.get(r.id) ?? { completedMissions: 0, lastMissionAt: null, activeMissionId: null }))
}

export async function getTeamRow(userId: string, teamId: string): Promise<TeamRow> {
  const row = (await db.autobotTeam.findUnique({ where: { id: teamId }, include: includeMembers })) as unknown as TeamRow | null
  if (!row || row.userId !== userId) {
    throw new BeanApiError('NOT_FOUND', 'Team not found.')
  }
  return row
}

export async function getTeamView(userId: string, teamId: string): Promise<AutobotTeamView> {
  const row = await getTeamRow(userId, teamId)
  const stats = (await missionStatsFor(userId, [row.id])).get(row.id) ?? { completedMissions: 0, lastMissionAt: null, activeMissionId: null }
  return teamView(row, stats)
}

/** Verify the member agent list: every agent must exist, belong to THIS
 *  user and be active. Returns the validated agent rows (same order as the
 *  deduped input). Foreign or archived ids are honest errors. */
async function resolveMemberAgents(userId: string, members: readonly NormalizedMemberInput[]) {
  const ids = members.map((m) => m.agentId)
  const rows = await db.autobotAgent.findMany({ where: { id: { in: ids }, userId } })
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const m of members) {
    const agent = byId.get(m.agentId)
    if (!agent) {
      // Owner-scoped miss: a foreign agent id is an honest not-found (no
      // existence leak, no cross-user composition).
      throw new BeanApiError('NOT_FOUND', 'One of the selected agents was not found in your roster.')
    }
    if (agent.status !== 'active') {
      throw new TeamValidationError(`"${agent.name}" is archived — activate the agent before adding it to a team.`)
    }
  }
  return byId
}

async function assertNoTeamQuota(userId: string): Promise<void> {
  const count = await db.autobotTeam.count({ where: { userId } })
  if (count >= TEAM_LIMITS.maxTeamsPerUser) {
    throw new BeanApiError('QUOTA_EXCEEDED', `You already have ${TEAM_LIMITS.maxTeamsPerUser} teams — archive or delete one to create another.`)
  }
}

async function writeMembers(teamId: string, members: readonly NormalizedMemberInput[], leaderAgentId: string | null): Promise<void> {
  await db.autobotTeamMember.deleteMany({ where: { teamId } })
  let idx = 0
  let leaderMemberId: string | null = null
  for (const m of members) {
    const row = await db.autobotTeamMember.create({
      data: { teamId, agentId: m.agentId, responsibility: m.responsibility, orderIndex: idx },
    })
    // Resolve the requested leader (an AGENT id) to its NEW member row id.
    // Leadership is coordination copy only — it never grants tools or
    // permissions. No explicit leader ⇒ default-first-member semantics in
    // the view builder.
    if (leaderAgentId && m.agentId === leaderAgentId) leaderMemberId = row.id
    idx += 1
  }
  await db.autobotTeam.update({
    where: { id: teamId },
    data: { leaderMemberId },
  })
}

export async function createTeam(userId: string, input: NormalizedTeamInput & { templateKey?: string }): Promise<AutobotTeamView> {
  crudRateLimit(userId)
  await assertNoTeamQuota(userId)
  await resolveMemberAgents(userId, input.members)
  const team = await db.autobotTeam.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      workflowPreference: input.workflowPreference,
      assignmentPreference: input.assignmentPreference,
      templateKey: input.templateKey ?? null,
      status: 'active',
      leaderMemberId: null,
    },
  })
  await writeMembers(team.id, input.members, input.leaderAgentId)
  await recordAudit({
    actorId: userId,
    action: 'autobots.team_create',
    target: team.id,
    meta: { templateKey: input.templateKey ?? null, members: input.members.length, workflowPreference: input.workflowPreference },
  })
  return getTeamView(userId, team.id)
}

export interface TeamUpdateInput extends Partial<Omit<NormalizedTeamInput, 'leaderAgentId'>> {
  status?: string
  leaderAgentId?: string | null
}

const TEAM_STATUSES = ['active', 'archived'] as const

/** The leader of an existing team, expressed as an agent id (for edit forms). */
function leaderAgentIdOf(team: TeamRow): string | null {
  if (!team.leaderMemberId) return null
  const m = (team.members ?? []).find((mm) => mm.id === team.leaderMemberId)
  return m?.agentId ?? null
}

export async function updateTeam(userId: string, teamId: string, patch: TeamUpdateInput): Promise<AutobotTeamView> {
  crudRateLimit(userId)
  const team = await getTeamRow(userId, teamId)
  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = boundedText(patch.name, 1, TEAM_LIMITS.nameChars, 'Team name')
  if (patch.description !== undefined) data.description = boundedOptional(patch.description, TEAM_LIMITS.descriptionChars, 'Team description')
  if (patch.workflowPreference !== undefined) {
    if (!(TEAM_WORKFLOW_PREFERENCES as readonly string[]).includes(patch.workflowPreference)) {
      throw new TeamValidationError(`Workflow preference must be one of: ${TEAM_WORKFLOW_PREFERENCES.join(', ')}.`)
    }
    data.workflowPreference = patch.workflowPreference
  }
  if (patch.assignmentPreference !== undefined) {
    if (!(TEAM_ASSIGNMENT_PREFERENCES as readonly string[]).includes(patch.assignmentPreference)) {
      throw new TeamValidationError(`Assignment preference must be one of: ${TEAM_ASSIGNMENT_PREFERENCES.join(', ')}.`)
    }
    data.assignmentPreference = patch.assignmentPreference
  }
  if (patch.status !== undefined) {
    if (!(TEAM_STATUSES as readonly string[]).includes(patch.status)) {
      throw new TeamValidationError('Status must be "active" or "archived".')
    }
    if (patch.status === 'archived') {
      await assertNoActiveTeamMission(teamId)
    }
    data.status = patch.status
  }
  if (data.name !== undefined || data.description !== undefined || data.workflowPreference !== undefined || data.assignmentPreference !== undefined || data.status !== undefined) {
    await db.autobotTeam.update({ where: { id: teamId }, data })
  }
  if (patch.members !== undefined) {
    const normalized = normalizeTeamInput({
      name: (data.name as string) ?? team.name,
      description: (data.description as string) ?? team.description,
      workflowPreference: (data.workflowPreference as string) ?? team.workflowPreference,
      assignmentPreference: (data.assignmentPreference as string) ?? team.assignmentPreference,
      members: patch.members,
      leaderAgentId: patch.leaderAgentId ?? leaderAgentIdOf(team),
    })
    await resolveMemberAgents(userId, normalized.members)
    await writeMembers(teamId, normalized.members, normalized.leaderAgentId)
  } else if (patch.leaderAgentId !== undefined) {
    // Leadership change only — the leader must be a CURRENT member agent.
    const agentIds = (team.members ?? []).map((m) => m.agentId)
    if (patch.leaderAgentId !== null && !agentIds.includes(patch.leaderAgentId)) {
      throw new TeamValidationError('The team leader must be one of the team\u2019s members.')
    }
    const row = (team.members ?? []).find((m) => m.agentId === patch.leaderAgentId)
    await db.autobotTeam.update({ where: { id: teamId }, data: { leaderMemberId: row?.id ?? null } })
  }
  await recordAudit({
    actorId: userId,
    action: 'autobots.team_update',
    target: teamId,
    meta: { fields: Object.keys(data) },
  })
  return getTeamView(userId, teamId)
}

export async function duplicateTeam(userId: string, teamId: string): Promise<AutobotTeamView> {
  crudRateLimit(userId)
  const src = await getTeamRow(userId, teamId)
  await assertNoTeamQuota(userId)
  const copy = await db.autobotTeam.create({
    data: {
      userId,
      name: `${src.name} (copy)`.slice(0, TEAM_LIMITS.nameChars),
      description: src.description,
      workflowPreference: src.workflowPreference,
      assignmentPreference: src.assignmentPreference,
      templateKey: src.templateKey,
      status: 'active',
      leaderMemberId: null,
    },
  })
  const members = (src.members ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((m) => ({ agentId: m.agentId, responsibility: m.responsibility }))
  if (members.length > 0) {
    await writeMembers(copy.id, members, null)
  }
  await recordAudit({ actorId: userId, action: 'autobots.team_duplicate', target: copy.id, meta: { from: teamId } })
  return getTeamView(userId, copy.id)
}

/** Honest active-mission protection: archive/delete refuse while a team
 *  mission is planned/running (it can never be silently damaged). */
async function assertNoActiveTeamMission(teamId: string): Promise<void> {
  const active = await db.agentMission.findFirst({
    where: { teamId, status: { in: ['planned', 'running'] } },
    select: { id: true },
  })
  if (active) {
    throw new BeanApiError('EDIT_CONFLICT', 'This team has a mission in progress — cancel or wait for it to finish before archiving or deleting the team.')
  }
}

export async function deleteTeam(userId: string, teamId: string): Promise<{ deleted: true }> {
  crudRateLimit(userId)
  await getTeamRow(userId, teamId)
  await assertNoActiveTeamMission(teamId)
  await db.autobotTeam.delete({ where: { id: teamId } })
  await recordAudit({ actorId: userId, action: 'autobots.team_delete', target: teamId, meta: {} })
  return { deleted: true }
}

// ---------------------------------------------------------------------------
// Template instantiation — real agents, real team, same validation
// ---------------------------------------------------------------------------

/** Instantiate a team template for a user: reuse the user's existing ACTIVE
 *  agent created from each referenced agent template, or create a fresh one
 *  through the SAME bounded agent-service path. Then create the team through
 *  createTeam (same quota/ownership/member validation as a custom team). */
export async function createTeamFromTemplate(userId: string, templateKey: string): Promise<AutobotTeamView> {
  crudRateLimit(userId)
  const template = getTeamTemplate(templateKey)
  if (!template) throw new TeamValidationError('That team template does not exist in the verified catalogue.')
  await assertNoTeamQuota(userId)

  const { createAgent, templateToInput } = await import('../agent-service')
  const memberInputs: NormalizedMemberInput[] = []
  for (const spec of template.memberSpecs) {
    const existing = await db.autobotAgent.findFirst({
      where: { userId, templateKey: spec.agentTemplateKey, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    })
    if (existing) {
      memberInputs.push({ agentId: existing.id, responsibility: spec.responsibility })
      continue
    }
    const seed = templateToInput(spec.agentTemplateKey)
    const agent = await createAgent(userId, seed)
    memberInputs.push({ agentId: agent.id, responsibility: spec.responsibility })
  }
  // Templates with zero memberSpecs (Custom Team) are not saveable as-is:
  // the roster must be built in the editor first (min-members rule).
  if (memberInputs.length < TEAM_LIMITS.minMembers) {
    throw new TeamValidationError(`"${template.name}" starts with an empty roster — add ${TEAM_LIMITS.minMembers} agents in the team editor before saving.`)
  }
  return createTeam(userId, {
    name: template.name,
    description: template.description,
    workflowPreference: template.workflowPreference,
    assignmentPreference: 'team-order',
    members: memberInputs,
    leaderAgentId: null,
    templateKey: template.key,
  })
}
