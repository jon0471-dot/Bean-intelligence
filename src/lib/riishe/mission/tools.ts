/**
 * BEAN Intelligence — M41 mission delegation tools (SERVER ONLY).
 *
 * RIISHE offers multi-part objectives to the mission runner through the
 * SAME delegation discipline as every specialist tool (M36/M37): an
 * 'explicit' permission key AND the per-turn capability plan must BOTH
 * agree before the model may submit anything. The planner is deterministic;
 * the mission executes on the durable engine; results are REAL — the tool
 * reports a queued mission and where its progress lives, never a claimed
 * outcome.
 *
 *  - delegate_mission: plan + persist + submit the durable mission-run job.
 *  - check_mission: read-only, owner-scoped progress probe (per-task states,
 *    honest failures, delivered artifacts) for the model to relay verbatim.
 *  - cancel_mission: owner-scoped cancellation request (the executor
 *    propagates it to active specialist work and dependent tasks).
 */
import { recordAudit } from '@/lib/observability/metering'
import { createMissionFromPlan, getMissionForOwner, requestMissionCancel, toProgressView } from './store'
import { planMission } from './planner'
import type { ToolContext, ToolDescriptor, ToolResult } from '../tools/types'

const OBJECTIVE_MAX = 4000

export interface DelegateMissionInput {
  objective: string
}

export function validateDelegateMissionInput(input: unknown): DelegateMissionInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const objective = typeof rec.objective === 'string' ? rec.objective.trim() : ''
  if (objective.length < 12) {
    throw new Error('State the multi-part objective in full (at least 12 characters).')
  }
  if (objective.length > OBJECTIVE_MAX) {
    throw new Error(`The objective must be at most ${OBJECTIVE_MAX} characters.`)
  }
  return { objective }
}

export const delegateMissionTool: ToolDescriptor<DelegateMissionInput> = {
  name: 'delegate_mission',
  description:
    'Hand a MULTI-PART objective to the autonomous mission runner: RIISHE plans a task graph across the ' +
    'specialists (engineering workspace, visual, video, audio, research/atlas), executes it on the durable ' +
    'job engine with dependency ordering and verification, and delivers one coherent result. Use when the ' +
    'user asks for several coordinated deliverables (build a website, research and write a sourced report, ' +
    'produce a video with narration and visuals, debug an application end-to-end). Returns the mission id ' +
    'and the detected plan — poll progress with check_mission and never claim results before they exist.',
  permission: 'explicit',
  permissionKey: 'allowMissionDelegation',
  validate: validateDelegateMissionInput,
  timeoutMs: 20_000,
  async execute(input: DelegateMissionInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowMissionDelegation')) {
      return { ok: false, output: 'Permission denied: mission delegation was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Mission delegation requires an authenticated session.' }
    const plan = planMission(input.objective)
    if (!plan.ok) {
      // Honest refusal — single-domain requests are served by the ordinary
      // chat flow; the model relays the reason instead of forcing a mission.
      return { ok: false, output: `No mission was created: ${plan.reason}` }
    }
    const submission = await createMissionFromPlan(userId, input.objective, plan)
    await recordAudit({
      actorId: userId,
      action: 'riishe.mission_delegate',
      target: submission.missionId,
      meta: { missionType: plan.missionType, tasks: plan.tasks.length, via: 'riishe-delegation' },
    }).catch(() => undefined)
    const taskLines = plan.tasks
      .map((t) => `- ${t.title} (${t.agent}${t.dependsOn.length ? `, after ${t.dependsOn.join(' + ')}` : ''})`)
      .join('\n')
    return {
      ok: true,
      output:
        `Mission ${submission.missionId} created and queued (type: ${plan.missionType}).\n` +
        `Detected: ${plan.detected.join('; ')}.\nPlanned tasks:\n${taskLines}\n` +
        'The mission runner now executes the tasks on the durable job engine: independent tasks run in ' +
        'parallel, dependent tasks wait for their inputs, and every output is verified before it counts. ' +
        'Report the plan and that work is underway; poll check_mission before telling the user anything ' +
        'about results, and relay exactly what it reports — including honest failures.',
    }
  },
}

// ---------------------------------------------------------------------------
// check_mission — owner-scoped REAL progress probe (read-only)
// ---------------------------------------------------------------------------

export interface CheckMissionInput {
  missionId: string
}

export function validateCheckMissionInput(input: unknown): CheckMissionInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const missionId = typeof rec.missionId === 'string' ? rec.missionId.trim() : ''
  if (missionId.length === 0 || missionId.length > 64) {
    throw new Error('Provide the mission id returned by delegate_mission.')
  }
  return { missionId }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'waiting for its dependencies',
  ready: 'ready to start',
  running: 'in progress',
  done: 'done and verified',
  failed: 'failed',
  skipped: 'skipped (an upstream dependency did not complete)',
  cancelled: 'cancelled',
}

export const checkMissionTool: ToolDescriptor<CheckMissionInput> = {
  name: 'check_mission',
  description:
    'Check the REAL progress of a mission you delegated (read-only, your own missions only). ' +
    'Input: {"missionId": string}. Returns the actual per-task states (pending/running/verified/failed/' +
    'skipped), the delivered artifacts, and honest failure reasons. Use after delegate_mission before ' +
    'claiming ANY result, and relay exactly what it reports.',
  permission: 'standard',
  validate: validateCheckMissionInput,
  timeoutMs: 10_000,
  async execute(input: CheckMissionInput, ctx: ToolContext): Promise<ToolResult> {
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Mission status requires an authenticated session.' }
    const mission = await getMissionForOwner(input.missionId, userId)
    if (!mission) {
      return { ok: false, output: 'No mission with that id exists for this account — check the mission id returned by delegate_mission.' }
    }
    const view = toProgressView(mission)
    if (!view) return { ok: false, output: 'The mission could not be read.' }
    const lines = view.tasks.map((t) => `- ${t.title}: ${STATUS_LABEL[t.status] ?? t.status}${t.failureNote ? ` — ${t.failureNote.slice(0, 200)}` : ''}`)
    const finished = ['completed', 'completed_partial', 'failed', 'cancelled'].includes(view.status)
    const header = finished
      ? `Mission ${view.missionId} (${view.missionType}) has FINISHED: ${view.status.replace('_', ' ')}.`
      : `Mission ${view.missionId} (${view.missionType}) is ${view.status === 'planned' ? 'queued' : 'in progress'}.`
    const outcome = view.outcomeSummary
      ? ` Delivery: ${view.outcomeSummary}`
      : view.failureNote
        ? ` Outcome note: ${view.failureNote}`
        : ''
    return {
      ok: true,
      output:
        `${header}${outcome}\nTasks:\n${lines.join('\n')}\n` +
        'Relay exactly this state. Do not upgrade failed or skipped tasks into successes, and do not ' +
        'claim artifacts that are not reported above.',
    }
  },
}

// ---------------------------------------------------------------------------
// cancel_mission — owner-scoped cancellation request
// ---------------------------------------------------------------------------

export const cancelMissionTool: ToolDescriptor<CheckMissionInput> = {
  name: 'cancel_mission',
  description:
    'Cancel a mission you delegated (owner-scoped). Input: {"missionId": string}. The runner stops ' +
    'starting new tasks, signals active specialist jobs to stop, cancels dependent tasks and settles the ' +
    'mission honestly. Already-finished tasks keep their recorded results.',
  permission: 'explicit',
  permissionKey: 'allowMissionDelegation',
  validate: validateCheckMissionInput,
  timeoutMs: 10_000,
  async execute(input: CheckMissionInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowMissionDelegation')) {
      return { ok: false, output: 'Permission denied: mission management was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Mission cancellation requires an authenticated session.' }
    const ok = await requestMissionCancel(input.missionId, userId)
    if (!ok) {
      return { ok: false, output: 'No active mission with that id exists for this account (unknown id or already finished).' }
    }
    return {
      ok: true,
      output: `Cancellation requested for mission ${input.missionId}. The runner will stop new work, signal active specialist jobs and settle the mission as cancelled. Confirm with check_mission.`,
    }
  },
}

/** Test/ops seam: the M41 mission tool names in registration order. */
export const MISSION_TOOL_NAMES = ['delegate_mission', 'check_mission', 'cancel_mission'] as const
