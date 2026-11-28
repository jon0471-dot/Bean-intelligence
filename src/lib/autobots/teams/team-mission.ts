/**
 * BEAN Intelligence — M49.2 team mission bridge (SERVER ONLY).
 *
 * The ONLY path from a team to execution — and it creates REAL M41 missions:
 *
 *  - `planTeamMission` is READ-ONLY: it runs the EXISTING deterministic M41
 *    planner (planMission) + the assignment engine and returns the preview.
 *    It writes NOTHING and enqueues NOTHING (pinned by tests).
 *  - `runTeamMission` re-validates the team, the members, the plan and the
 *    assignment, records the IMMUTABLE team execution snapshot, then creates
 *    the mission through the EXISTING store (createMissionFromPlan) — the
 *    SAME durable 'mission-run' GenerationJob, the SAME duplicate guard, the
 *    SAME Trust task, the SAME executor. There is no second queue.
 *  - `listTeamMissions` returns owner-scoped, customer-safe progress views
 *    (the existing mission-progress contract, enriched with the per-task
 *    assigned member and real artifact references).
 *
 * Security properties (pinned by tests):
 *  - team + member ownership is enforced end to end; foreign ids are 404s;
 *  - archived teams and archived members cannot receive new assignments;
 *  - an active (planned/running) team mission refuses a second submission;
 *  - assignments and snapshots are built SERVER-SIDE from the saved team —
 *    client-supplied member labels are never trusted;
 *  - persona preferences ride ONLY as bounded, untrusted-framed user data.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { planMission } from '@/lib/riishe/mission/planner'
import type { MissionPlan, MissionTaskKind } from '@/lib/riishe/mission/types'
import { MISSION_LIMITS } from '@/lib/riishe/mission/types'
import { isAutobotCapability } from '../catalog'
import { TEAM_LIMITS } from './catalog'
import {
  assignPlanTasks,
  serializeAssignment,
  serializeTeamSnapshot,
  parseAssignment,
  type AssignmentResult,
  type TeamExecutionSnapshot,
  type TeamMemberAssignmentView,
} from './assignment'
import { getTeamRow } from './team-service'

// ---------------------------------------------------------------------------
// Member views for the assignment engine (server-derived, never client data)
// ---------------------------------------------------------------------------

interface MemberRowWithAgent {
  id: string
  agentId: string
  responsibility: string
  orderIndex: number
  agent: { id: string; name: string; role: string; capabilityKey: string; status: string; instructions: string | null; personality: string | null } | null
}

interface TeamRowWithMembers {
  id: string
  userId: string
  name: string
  description: string
  leaderMemberId: string | null
  workflowPreference: string
  assignmentPreference: string
  templateKey: string | null
  status: string
  members?: MemberRowWithAgent[]
}

/** Bounded persona preferences for one member agent (untrusted user data). */
function personaBoundedOf(agent: { instructions: string | null; personality: string | null }): string | null {
  const parts: string[] = []
  if (agent.personality) parts.push(`Communication style: ${agent.personality.trim().slice(0, 400)}`)
  if (agent.instructions) parts.push(`Working preferences: ${agent.instructions.trim().slice(0, 700)}`)
  const joined = parts.join(' | ')
  return joined.length > 0 ? joined.slice(0, TEAM_LIMITS.personaPreferenceChars) : null
}

function assignmentViews(team: TeamRowWithMembers): TeamMemberAssignmentView[] {
  const members = team.members ?? []
  return members
    .filter((m) => m.agent !== null)
    .map((m) => ({
      memberId: m.id,
      agentId: m.agent!.id,
      agentName: m.agent!.name,
      agentRole: m.agent!.role,
      capabilityKey: isAutobotCapability(m.agent!.capabilityKey) ? m.agent!.capabilityKey : m.agent!.capabilityKey,
      status: m.agent!.status,
      responsibility: m.responsibility,
      orderIndex: m.orderIndex,
      isLeader: team.leaderMemberId ? m.id === team.leaderMemberId : m.orderIndex === 0,
      personaBounded: personaBoundedOf(m.agent!),
    }))
}

// ---------------------------------------------------------------------------
// The plan preview (READ-ONLY) + the run (real M41 mission)
// ---------------------------------------------------------------------------

export interface TeamPlanPreview {
  ok: boolean
  /** Honest refusal reason from the M41 planner (when the objective is not
   *  a genuine multi-part objective). */
  reason: string | null
  missionType: string | null
  detected: string[]
  deliverableTaskId: string | null
  tasks: Array<{
    taskId: string
    kind: MissionTaskKind
    title: string
    dependsOn: string[]
    objective: string
    expectedOutput: string
    assignedMember: { memberId: string; agentId: string; agentName: string; capabilityKey: string; responsibility: string; isLeader: boolean } | null
    platformGate: boolean
  }>
  gaps: AssignmentResult['gaps']
  /** Descriptive coordination copy — never authorization. */
  workflowPreference: string
}

const PLAN_RATE_KEY = (userId: string) => `autobots-teams-plan:${userId}`
const RUN_RATE_KEY = (userId: string) => `autobots-teams-run:${userId}`

async function loadActiveTeamOr409(userId: string, teamId: string): Promise<TeamRowWithMembers> {
  const team = (await getTeamRow(userId, teamId)) as unknown as TeamRowWithMembers
  if (team.status !== 'active') {
    throw new BeanApiError('EDIT_CONFLICT', 'This team is archived — restore it before planning or running missions.')
  }
  return team
}

/** Shared plan+assign path. `planMission` is the ONLY planner; the team
 *  cannot author its own task graph. */
function planAndAssign(team: TeamRowWithMembers, objective: string): { plan: MissionPlan; assignment: AssignmentResult; members: TeamMemberAssignmentView[] } {
  const planResult = planMission(objective)
  if (!planResult.ok) {
    const refusal = planResult
    const err = new BeanApiError('VALIDATION_ERROR', refusal.reason)
    throw err
  }
  const members = assignmentViews(team)
  // The SAVED assignment rule decides multi-member selection: a pure
  // ordering over the saved roster (team order, or leader first). Persona
  // text and member names are never consulted here.
  const preference = team.assignmentPreference === 'leader-first' ? 'leader-first' : 'team-order'
  const assignment = assignPlanTasks(planResult, members, preference)
  return { plan: planResult, assignment, members }
}

/** Read-only plan preview: validates the objective against the deterministic
 *  M41 planner and the team's REAL composition. Writes nothing, enqueues
 *  nothing (pinned by tests: job + mission + trust rows unchanged). */
export function planTeamMission(userId: string, teamId: string, objective: string): Promise<TeamPlanPreview> {
  return (async () => {
    const rl = checkRateLimit(PLAN_RATE_KEY(userId), 20, 60_000)
    if (!rl.allowed) {
      throw new BeanApiError('RATE_LIMITED', `Too many plan previews — try again in ${rl.retryAfterSec}s.`)
    }
    const text = objective.trim()
    if (text.length < 12 || text.length > MISSION_LIMITS.objectiveChars) {
      throw new BeanApiError('VALIDATION_ERROR', `Describe the objective in ${12}-${MISSION_LIMITS.objectiveChars} characters.`)
    }
    const team = await loadActiveTeamOr409(userId, teamId)
    const { plan, assignment } = planAndAssign(team, text)
    const byTask = new Map(plan.tasks.map((t) => [t.id, t]))
    return {
      ok: assignment.ok,
      reason: null,
      missionType: plan.missionType,
      detected: plan.detected,
      deliverableTaskId: plan.deliverableTaskId,
      tasks: plan.tasks.map((t) => {
        const a = assignment.assignments[t.id]
        const gate = assignment.platformTasks.find((p) => p.taskId === t.id)
        return {
          taskId: t.id,
          kind: t.kind,
          title: t.title,
          dependsOn: t.dependsOn,
          objective: t.objective,
          expectedOutput: t.expectedOutput,
          assignedMember: a
            ? { memberId: a.memberId, agentId: a.agentId, agentName: a.agentName, capabilityKey: a.capabilityKey, responsibility: a.responsibility, isLeader: a.isLeader }
            : null,
          platformGate: Boolean(gate),
        }
      }),
      gaps: assignment.gaps,
      workflowPreference: team.workflowPreference,
    }
  })()
}

export interface TeamRunResult {
  missionId: string
  jobId: string
  status: 'planned'
  plan: TeamPlanPreview
}

/** Submit a REAL team mission. Full validation happens here — the team, the
 *  members, the plan, the assignment and the resource gates — before the
 *  EXISTING store persists the mission and its durable 'mission-run' job. */
export async function runTeamMission(userId: string, teamId: string, objective: string): Promise<TeamRunResult> {
  const rl = checkRateLimit(RUN_RATE_KEY(userId), 10, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError('RATE_LIMITED', `Too many mission submissions — try again in ${rl.retryAfterSec}s.`)
  }
  const text = objective.trim()
  if (text.length < 12 || text.length > MISSION_LIMITS.objectiveChars) {
    throw new BeanApiError('VALIDATION_ERROR', `Describe the objective in ${12}-${MISSION_LIMITS.objectiveChars} characters.`)
  }
  const team = await loadActiveTeamOr409(userId, teamId)

  // One ACTIVE team mission at a time (duplicate-submission protection on
  // top of the store's identical-objective guard).
  const active = await db.agentMission.findFirst({
    where: { teamId: team.id, status: { in: ['planned', 'running'] } },
    select: { id: true },
  })
  if (active) {
    throw new BeanApiError('EDIT_CONFLICT', 'This team already has a mission in progress — watch it from the team workspace or cancel it before starting another.')
  }

  const { plan, assignment, members } = planAndAssign(team, text)
  if (!assignment.ok) {
    // Deterministic refusal: name the EXACT missing capability/member
    // requirement. No substitute is invented, no partial run starts.
    throw new BeanApiError('VALIDATION_ERROR', assignment.gaps.map((g) => g.message).join(' '))
  }

  const snapshot = serializeTeamSnapshot({
    teamId: team.id,
    teamName: team.name,
    description: team.description,
    workflowPreference: team.workflowPreference,
    leaderMemberId: team.leaderMemberId,
    members,
    assignments: assignment.assignments,
  })
  if (!snapshot.ok) {
    throw new BeanApiError('VALIDATION_ERROR', snapshot.reason)
  }

  // The store's duplicate guard (identical active objective for this owner)
  // and the Trust-task creation ride the EXISTING path — one queue, one
  // ledger, zero parallel infrastructure.
  const { createMissionFromPlan } = await import('@/lib/riishe/mission/store')
  const submitted = await createMissionFromPlan(userId, text, plan, {
    teamId: team.id,
    teamSnapshotJson: snapshot.snapshotJson,
    taskAssignments: Object.fromEntries(
      Object.entries(assignment.assignments).map(([taskId, a]) => [taskId, serializeAssignment(a)]),
    ),
  })

  await recordAudit({
    actorId: userId,
    action: 'autobots.team_mission_run',
    target: submitted.missionId,
    meta: { teamId: team.id, missionType: plan.missionType, tasks: plan.tasks.length, assigned: Object.keys(assignment.assignments).length },
  })

  const preview = teamPlanPreviewFrom(plan, assignment, team)
  return { missionId: submitted.missionId, jobId: submitted.jobId, status: submitted.status, plan: preview }
}

function teamPlanPreviewFrom(plan: MissionPlan, assignment: AssignmentResult, team: TeamRowWithMembers): TeamPlanPreview {
  return {
    ok: assignment.ok,
    reason: null,
    missionType: plan.missionType,
    detected: plan.detected,
    deliverableTaskId: plan.deliverableTaskId,
    tasks: plan.tasks.map((t) => {
      const a = assignment.assignments[t.id]
      const gate = assignment.platformTasks.find((p) => p.taskId === t.id)
      return {
        taskId: t.id,
        kind: t.kind,
        title: t.title,
        dependsOn: t.dependsOn,
        objective: t.objective,
        expectedOutput: t.expectedOutput,
        assignedMember: a
          ? { memberId: a.memberId, agentId: a.agentId, agentName: a.agentName, capabilityKey: a.capabilityKey, responsibility: a.responsibility, isLeader: a.isLeader }
          : null,
        platformGate: Boolean(gate),
      }
    }),
    gaps: assignment.gaps,
    workflowPreference: team.workflowPreference,
  }
}

// ---------------------------------------------------------------------------
// Team mission history (owner-scoped, customer-safe)
// ---------------------------------------------------------------------------

export interface TeamMissionView {
  missionId: string
  missionType: string
  status: string
  objective: string
  outcomeSummary: string | null
  failureNote: string | null
  createdAt: string
  finishedAt: string | null
  tasks: Array<{
    taskId: string
    kind: string
    title: string
    status: string
    dependsOn: string[]
    attempts: number
    failureNote: string | null
    verificationOutcome: string | null
    assignedMember: { agentName: string; agentRole: string; capabilityKey: string; isLeader: boolean } | null
    platformGate: boolean
    artifacts: Array<{ artifact: string; ref: string; label: string }>
  }>
}

export async function listTeamMissions(userId: string, teamId: string, take = 10): Promise<TeamMissionView[]> {
  // Owner-scoped on BOTH the team and the mission.
  await getTeamRow(userId, teamId)
  const missions = await db.agentMission.findMany({
    where: { userId, teamId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(take, 1), 20),
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  })
  const views: TeamMissionView[] = []
  for (const m of missions) {
    let snapshot: TeamExecutionSnapshot | null = null
    try {
      snapshot = m.teamSnapshotJson ? (JSON.parse(m.teamSnapshotJson) as TeamExecutionSnapshot) : null
    } catch {
      snapshot = null
    }
    const memberByTaskId = new Map<string, { agentName: string; agentRole: string; capabilityKey: string; isLeader: boolean }>()
    for (const t of m.tasks) {
      const a = parseAssignment(t.assignmentJson)
      if (a) memberByTaskId.set(t.taskId, { agentName: a.agentName, agentRole: a.agentRole, capabilityKey: a.capabilityKey, isLeader: a.isLeader })
    }
    views.push({
      missionId: m.id,
      missionType: m.missionType,
      status: m.status,
      objective: m.objective,
      outcomeSummary: m.outcomeSummary,
      failureNote: m.failureNote,
      createdAt: m.createdAt.toISOString(),
      finishedAt: m.finishedAt ? m.finishedAt.toISOString() : null,
      tasks: m.tasks.map((t) => {
        let verificationOutcome: string | null = null
        if (t.verificationResultJson) {
          try {
            verificationOutcome = (JSON.parse(t.verificationResultJson) as { status?: string }).status ?? null
          } catch {
            verificationOutcome = null
          }
        }
        let dependsOn: string[] = []
        try {
          dependsOn = JSON.parse(t.dependsOnJson) as string[]
        } catch {
          dependsOn = []
        }
        let artifacts: Array<{ artifact: string; ref: string; label: string }> = []
        if (t.artifactJson) {
          try {
            const parsed = JSON.parse(t.artifactJson) as Array<{ artifact?: string; ref?: string; label?: string }>
            artifacts = (Array.isArray(parsed) ? parsed : [])
              .filter((a) => typeof a.artifact === 'string' && typeof a.ref === 'string')
              .slice(0, 12)
              .map((a) => ({ artifact: a.artifact as string, ref: a.ref as string, label: typeof a.label === 'string' ? a.label.slice(0, 160) : '' }))
          } catch {
            artifacts = []
          }
        }
        const kind = t.kind as MissionTaskKind
        const member = memberByTaskId.get(t.taskId) ?? null
        return {
          taskId: t.taskId,
          kind: t.kind,
          title: t.title,
          status: t.status,
          dependsOn,
          attempts: t.attempts,
          failureNote: t.failureNote,
          verificationOutcome,
          assignedMember: member,
          platformGate: !member && kind === 'verify-deliverable',
          artifacts,
        }
      }),
    })
  }
  return views
}
