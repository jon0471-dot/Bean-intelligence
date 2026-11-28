/**
 * BEAN Intelligence — M41 mission store (SERVER-ONLY).
 *
 * Database-backed mission ledger: the persisted task/subtask state for
 * long-running multi-agent work (M41 §4). ONE ledger, no second queue —
 * execution rides the EXISTING durable GenerationJob engine ('mission-run'
 * on the riishe pool with claim + lease + heartbeat + recovery), specialist
 * work rides the EXISTING delegation paths, provenance rides the EXISTING
 * Trust Engine.
 *
 * Honesty rules enforced HERE (mirroring the Trust Engine's discipline):
 *  - status transitions are validated against the M41 lifecycle and settled
 *    CAS-style (updateMany + status guard) — two executors can never both
 *    settle the same task;
 *  - a failed/cancelled mission REQUIRES a truthful note;
 *  - every free-text field is size-bounded (MISSION_LIMITS);
 *  - no secrets in any field (params are validated keys/values from the
 *    planner; execution payloads are stored as bounded customer-safe JSON).
 */
import { db } from '@/lib/db'
import { createTrustTask, startTrustTask } from '@/lib/trust/tasks'
import {
  canTransitionMission,
  canTransitionTask,
  MISSION_LIMITS,
  MissionContractError,
  type MissionPlan,
  type MissionStatus,
  type MissionTaskStatus,
} from './types'
import { sanitizeEvidenceText } from './safety'

/** Mission-layer state errors (distinct name so callers can branch). */
export class TrustStateMissionError extends Error {}

/** An identical ACTIVE mission already exists for this owner. */
export class MissionDuplicateError extends Error {
  constructor(public readonly existingMissionId: string) {
    super('An identical mission is already planned or running — wait for it to finish before resubmitting.')
  }
}

// ⚠️ IMPORT-CYCLE GUARD (same pattern as specialists.ts/code-delegation.ts):
// `@/lib/jobs/queue` must stay a DYNAMIC import here. A static chain would be
// store → jobs/queue → ai-engine/handlers → mission executor → store.
async function enqueueMissionJob(jobId: string): Promise<void> {
  const { enqueueJob } = await import('@/lib/jobs/queue')
  enqueueJob(jobId)
}

function bounded(value: string, max: number, field: string): string {
  if (value.length > max) throw new MissionContractError(`mission.${field} exceeds its ${max}-character bound`)
  return value
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmittedMission {
  missionId: string
  jobId: string
  status: 'planned'
}

/**
 * M49.2 (additive, optional): the Autobot-team context for a team mission.
 * The mission row gains the team reference + the IMMUTABLE execution
 * snapshot; each task row gains its server-built member-assignment JSON.
 * Everything here is written ONCE at creation and never mutated afterwards.
 * The mission's execution authorization still derives exclusively from the
 * M41 task kinds — team context is attribution + bounded persona framing.
 */
export interface TeamMissionContext {
  teamId: string
  teamSnapshotJson: string
  /** taskId → serialized assignment JSON (from the assignment engine). */
  taskAssignments: Record<string, string>
}

/**
 * Persist a planned mission and submit its durable mission-run job.
 * The job enters the SAME engine every product job uses (claim, lease,
 * heartbeat, crash recovery) — a server restart can lose nothing that the
 * database does not remember.
 */
export async function createMissionFromPlan(
  userId: string,
  objective: string,
  plan: MissionPlan,
  /** M49.2: optional Autobot-team context (server-built). */
  team?: TeamMissionContext,
): Promise<SubmittedMission> {
  const boundedObjective = bounded(objective.trim(), MISSION_LIMITS.objectiveChars, 'objective')
  // Duplicate-work prevention at the MISSION level: an identical ACTIVE
  // mission (same owner, same objective) is refused — double submissions
  // would double every specialist job underneath. Finished missions never
  // block a genuine re-run.
  const activeDuplicate = await db.agentMission.findFirst({
    where: { userId, objective: boundedObjective, status: { in: ['planned', 'running'] } },
    select: { id: true },
  })
  if (activeDuplicate) {
    throw new MissionDuplicateError(activeDuplicate.id)
  }
  const trust = await createTrustTask({
    userId,
    product: 'riishe',
    kind: 'mission',
    title: bounded(plan.missionType, MISSION_LIMITS.titleChars, 'title'),
    requestPreview: boundedObjective.slice(0, 2000),
    requestChars: boundedObjective.length,
  })
  const mission = await db.agentMission.create({
    data: {
      userId,
      missionType: plan.missionType,
      objective: boundedObjective,
      deliverableTaskId: plan.deliverableTaskId,
      status: 'planned',
      planJson: JSON.stringify(plan),
      detectedJson: JSON.stringify(plan.detected.slice(0, 6)),
      trustTaskId: trust.id,
      // M49.2 (additive, nullable): team reference + immutable snapshot.
      ...(team ? { teamId: team.teamId, teamSnapshotJson: team.teamSnapshotJson } : {}),
    },
  })
  for (const spec of plan.tasks) {
    await db.agentMissionTask.create({
      data: {
        missionId: mission.id,
        taskId: spec.id,
        kind: spec.kind,
        agent: spec.agent,
        title: bounded(spec.title, MISSION_LIMITS.titleChars, 'task.title'),
        objective: bounded(spec.objective, 6000, 'task.objective'),
        paramsJson: JSON.stringify(spec.params),
        expectedOutput: spec.expectedOutput,
        dependsOnJson: JSON.stringify(spec.dependsOn),
        authScope: spec.authScope,
        verificationJson: JSON.stringify(spec.verification),
        limitsJson: JSON.stringify(spec.limits),
        status: 'pending',
        // M49.2 (additive, nullable): the server-built member assignment.
        ...(team && team.taskAssignments[spec.id]
          ? { assignmentJson: bounded(team.taskAssignments[spec.id], 2400, 'task.assignmentJson') }
          : {}),
      },
    })
  }
  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'riishe',
      task: 'mission-run',
      capability: 'mission-run',
      status: 'queued',
      paramsJson: JSON.stringify({ missionId: mission.id }),
    },
  })
  await db.agentMission.update({ where: { id: mission.id }, data: { jobId: job.id } })
  await enqueueMissionJob(job.id)
  return { missionId: mission.id, jobId: job.id, status: 'planned' }
}

// ---------------------------------------------------------------------------
// Reads (owner-scoped)
// ---------------------------------------------------------------------------

export async function getMissionForOwner(missionId: string, userId: string) {
  const mission = await db.agentMission.findUnique({
    where: { id: missionId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  })
  if (!mission || mission.userId !== userId) return null
  return mission
}

export async function getMissionById(missionId: string) {
  return db.agentMission.findUnique({
    where: { id: missionId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  })
}

export async function listMissionsForOwner(userId: string, take = 20) {
  return db.agentMission.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(take, 1), 50),
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  })
}

/** Customer-safe progress view (no backend identities, no local paths). */
export interface MissionProgressView {
  missionId: string
  missionType: string
  status: MissionStatus
  objective: string
  tasks: Array<{
    taskId: string
    kind: string
    title: string
    status: MissionTaskStatus
    dependsOn: string[]
    attempts: number
    failureNote: string | null
    outcome: string | null
  }>
  outcomeSummary: string | null
  failureNote: string | null
}

export function toProgressView(mission: Awaited<ReturnType<typeof getMissionById>>): MissionProgressView | null {
  if (!mission) return null
  return {
    missionId: mission.id,
    missionType: mission.missionType,
    status: mission.status as MissionStatus,
    objective: mission.objective,
    outcomeSummary: mission.outcomeSummary,
    failureNote: mission.failureNote,
    tasks: mission.tasks.map((t) => {
      let outcome: string | null = null
      if (t.verificationResultJson) {
        try {
          outcome = (JSON.parse(t.verificationResultJson) as { status?: string }).status ?? null
        } catch {
          outcome = null
        }
      }
      let dependsOn: string[] = []
      try {
        dependsOn = JSON.parse(t.dependsOnJson) as string[]
      } catch {
        dependsOn = []
      }
      return {
        taskId: t.taskId,
        kind: t.kind,
        title: t.title,
        status: t.status as MissionTaskStatus,
        dependsOn,
        attempts: t.attempts,
        failureNote: t.failureNote,
        outcome,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// CAS transitions
// ---------------------------------------------------------------------------

export async function transitionMission(
  missionId: string,
  from: MissionStatus,
  to: MissionStatus,
  patch?: { failureNote?: string; outcomeSummary?: string },
) {
  if (!canTransitionMission(from, to)) {
    throw new TrustStateMissionError(`Cannot move a mission from "${from}" to "${to}".`)
  }
  const data: Record<string, unknown> = { status: to }
  if (to === 'running') data.startedAt = new Date()
  if (['completed', 'completed_partial', 'failed', 'cancelled'].includes(to)) data.finishedAt = new Date()
  if (patch?.failureNote !== undefined) data.failureNote = bounded(patch.failureNote, 600, 'failureNote')
  if (patch?.outcomeSummary !== undefined) data.outcomeSummary = bounded(patch.outcomeSummary, 600, 'outcomeSummary')
  const res = await db.agentMission.updateMany({ where: { id: missionId, status: from }, data })
  if (res.count !== 1) throw new TrustStateMissionError('Mission was settled concurrently; transition rejected.')
}

export interface TaskStatePatch {
  attempts?: number
  corrections?: number
  specialistJobId?: string | null
  executionJson?: string
  verificationResultJson?: string
  failureNote?: string | null
  artifactJson?: string
  objective?: string
}

export async function transitionTask(
  missionId: string,
  taskId: string,
  from: MissionTaskStatus,
  to: MissionTaskStatus,
  patch?: TaskStatePatch,
) {
  if (!canTransitionTask(from, to)) {
    throw new TrustStateMissionError(`Cannot move a mission task from "${from}" to "${to}".`)
  }
  const data: Record<string, unknown> = { status: to }
  if (patch?.attempts !== undefined) data.attempts = patch.attempts
  if (patch?.corrections !== undefined) data.corrections = patch.corrections
  if (patch?.specialistJobId !== undefined) data.specialistJobId = patch.specialistJobId
  if (patch?.executionJson !== undefined) data.executionJson = bounded(sanitizeEvidenceText(patch.executionJson), 6000, 'task.executionJson')
  if (patch?.verificationResultJson !== undefined) data.verificationResultJson = bounded(sanitizeEvidenceText(patch.verificationResultJson), 4000, 'task.verificationResultJson')
  if (patch?.failureNote !== undefined) data.failureNote = patch.failureNote === null ? null : bounded(patch.failureNote, 400, 'task.failureNote')
  if (patch?.artifactJson !== undefined) data.artifactJson = bounded(sanitizeEvidenceText(patch.artifactJson), 4000, 'task.artifactJson')
  if (patch?.objective !== undefined) data.objective = bounded(patch.objective, 6000, 'task.objective')
  const res = await db.agentMissionTask.updateMany({
    where: { missionId, taskId, status: from },
    data,
  })
  if (res.count !== 1) throw new TrustStateMissionError(`Task "${taskId}" was settled concurrently; transition rejected.`)
}

/** Attach the delegated specialist job id to a RUNNING task (idempotent
 *  state-preserving write — running→running is not a lifecycle transition,
 *  it is the submission completing its bookkeeping). */
export async function attachSpecialistJob(missionId: string, taskId: string, jobId: string): Promise<void> {
  const res = await db.agentMissionTask.updateMany({
    where: { missionId, taskId, status: 'running' },
    data: { specialistJobId: jobId },
  })
  if (res.count !== 1) throw new TrustStateMissionError(`Task "${taskId}" is not running; specialist job attach rejected.`)
}

/** Field updates on a RUNNING task (resubmission bookkeeping: new job id,
 *  correction/attempt counters, corrected objective). Never changes status. */
export async function updateRunningTask(missionId: string, taskId: string, patch: TaskStatePatch): Promise<void> {
  const { attempts, corrections, specialistJobId, objective, failureNote, executionJson, verificationResultJson } = patch
  const res = await db.agentMissionTask.updateMany({
    where: { missionId, taskId, status: 'running' },
    data: {
      ...(attempts !== undefined ? { attempts } : {}),
      ...(corrections !== undefined ? { corrections } : {}),
      ...(specialistJobId !== undefined ? { specialistJobId } : {}),
      ...(objective !== undefined ? { objective: bounded(objective, 6000, 'task.objective') } : {}),
      ...(failureNote !== undefined ? { failureNote: failureNote === null ? null : bounded(failureNote, 400, 'task.failureNote') } : {}),
      ...(executionJson !== undefined ? { executionJson: bounded(sanitizeEvidenceText(executionJson), 6000, 'task.executionJson') } : {}),
      ...(verificationResultJson !== undefined ? { verificationResultJson: bounded(sanitizeEvidenceText(verificationResultJson), 4000, 'task.verificationResultJson') } : {}),
    },
  })
  if (res.count !== 1) throw new TrustStateMissionError(`Task "${taskId}" is not running; update rejected.`)
}

/** Direct write for the failed→running retry seam (attempts already checked
 *  by the executor against the task's limits). */
export async function retryTask(missionId: string, taskId: string, patch: TaskStatePatch) {
  const { attempts, corrections, specialistJobId, executionJson, verificationResultJson, failureNote, artifactJson, objective } = patch
  const res = await db.agentMissionTask.updateMany({
    where: { missionId, taskId, status: 'failed' },
    data: {
      status: 'running',
      ...(attempts !== undefined ? { attempts } : {}),
      ...(corrections !== undefined ? { corrections } : {}),
      ...(specialistJobId !== undefined ? { specialistJobId } : {}),
      ...(executionJson !== undefined ? { executionJson: bounded(sanitizeEvidenceText(executionJson), 6000, 'task.executionJson') } : {}),
      ...(verificationResultJson !== undefined ? { verificationResultJson: bounded(sanitizeEvidenceText(verificationResultJson), 4000, 'task.verificationResultJson') } : {}),
      ...(failureNote !== undefined ? { failureNote: failureNote === null ? null : bounded(failureNote, 400, 'task.failureNote') } : {}),
      ...(artifactJson !== undefined ? { artifactJson: bounded(sanitizeEvidenceText(artifactJson), 4000, 'task.artifactJson') } : {}),
      ...(objective !== undefined ? { objective: bounded(objective, 6000, 'task.objective') } : {}),
    },
  })
  if (res.count !== 1) throw new TrustStateMissionError(`Task "${taskId}" could not re-enter execution.`)
}

// ---------------------------------------------------------------------------
// Cancellation (owner path — the executor polls the flag and propagates)
// ---------------------------------------------------------------------------

export async function requestMissionCancel(missionId: string, userId: string): Promise<boolean> {
  const mission = await db.agentMission.findUnique({ where: { id: missionId } })
  if (!mission || mission.userId !== userId) return false
  if (['completed', 'completed_partial', 'failed', 'cancelled'].includes(mission.status)) return false
  await db.agentMission.update({ where: { id: missionId }, data: { cancelRequested: true } })
  return true
}

// ---------------------------------------------------------------------------
// Trust Engine provenance helpers
// ---------------------------------------------------------------------------

/** Start the mission's Trust task (idempotent-safe via startTrustTask). */
export async function beginMissionTrust(trustTaskId: string | null) {
  if (!trustTaskId) return
  try {
    await startTrustTask(trustTaskId)
  } catch {
    // already running / settled — the Trust ledger is append-only and never
    // rewinds; the executor proceeds and settles honestly later.
  }
}

export { canTransitionMission, canTransitionTask, MISSION_LIMITS }
