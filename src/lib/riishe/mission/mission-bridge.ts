/**
 * BEAN Intelligence — M44 Phase 7: the mission bridge (SERVER ONLY).
 *
 * Wires the M44 verified-execution contracts onto the EXISTING M41 mission
 * executor additively: every mission task ( whichever specialist lane
 * executes it — CODE GIFTZ engineering, LAXII/JAZMII/GANGZII media, the
 * research/atlas lanes, the quality verifier ) gains an M44 action-contract
 * stamp and an honest execution record note in the Trust ledger.
 *
 * What this bridge deliberately does NOT do:
 *   - it does not re-route, re-order or re-verify anything — the M41
 *     executor and its verifiers stay the single execution truth;
 *   - it does not gate: mission tasks are already bounded to the reversible/
 *     read-only vocabulary (the consequential classes live in the M44
 *     authorization gate for standalone action plans);
 *   - it never throws — the ledger bounds are not execution failures.
 *
 * All five products converge on this ONE executor, so this bridge is the
 * integration surface: same contracts, same provenance, same verification
 * vocabulary everywhere.
 */

import { addTrustEvidence } from '@/lib/trust/tasks'
import { buildActionPlan, contractForTaskSpec } from './action-contract'
import type { MissionTaskSpec } from './types'
import { MISSION_LIMITS } from './types'

// ---------------------------------------------------------------------------
// The task's M44 contract stamp — deterministic, auditable per task.
// (The whole-mission plan digest is computed by buildActionPlan over the
// full graph; the executor's per-task ledger note carries THIS task's stamp
// so provenance stays truthful about what it hashes.)
// ---------------------------------------------------------------------------

/** Wrap the task spec into an M44 contract and compute its content stamp. */
export function taskContractStamp(objective: string, task: MissionTaskSpec): string {
  return buildActionPlan(objective, [contractForTaskSpec(task)]).planVersion
}

// ---------------------------------------------------------------------------
// Honest verdict mapping — the executor's statuses onto the M44 ladder.
// ---------------------------------------------------------------------------

export type M44TaskPhase = 'executing' | 'verified' | 'failed' | 'skipped'

export function m44VerificationVerdict(phase: M44TaskPhase): 'confirmed' | 'failed' | null {
  switch (phase) {
    case 'verified':
      return 'confirmed'
    case 'failed':
      return 'failed'
    default:
      // executing/skipped carry no verdict yet — never an invented one.
      return null
  }
}

// ---------------------------------------------------------------------------
// Bounded record rendering — the honest note that enters the Trust ledger.
// ---------------------------------------------------------------------------

export function renderM44TaskNote(input: {
  planVersion: string
  kind: string
  taskId: string
  phase: M44TaskPhase
  actionType: string
  riskClass: string
  idempotencyKey: string
  executorNote?: string | null
}): string {
  const verdict = m44VerificationVerdict(input.phase)
  const parts = [
    `m44:${input.planVersion.slice(0, 16)}`,
    `${input.kind}→${input.actionType}`,
    `phase=${input.phase}`,
    verdict ? `verdict=${verdict}` : 'verdict=pending',
    `risk=${input.riskClass}`,
    `key=${input.idempotencyKey.slice(0, 40)}`,
  ]
  if (input.executorNote) parts.push(`note=${input.executorNote.slice(0, 160)}`)
  return parts.join(' | ').slice(0, 390)
}

// ---------------------------------------------------------------------------
// The Trust-ledger write — additive, bounded, never throws.
// ---------------------------------------------------------------------------

export async function recordM44TaskEvidence(
  mission: { id: string; trustTaskId: string | null; objective: string },
  task: { taskId: string; kind: string; title: string; objective: string },
  spec: MissionTaskSpec | null,
  phase: M44TaskPhase,
  executorNote?: string | null,
): Promise<void> {
  if (!mission.trustTaskId) return
  try {
    const planVersion = spec ? taskContractStamp(mission.objective, spec) : 'unavailable'
    const contract = spec ? contractForTaskSpec(spec, planVersion) : null
    const note = renderM44TaskNote({
      planVersion,
      kind: task.kind,
      taskId: task.taskId,
      phase,
      actionType: contract?.actionType ?? task.kind,
      riskClass: contract?.riskClass ?? 'reversible',
      idempotencyKey: contract?.idempotencyKey ?? `mission:${task.taskId}`,
      executorNote,
    })
    await addTrustEvidence(mission.trustTaskId, {
      kind: 'measurement',
      origin: 'extracted',
      ref: `m44:${mission.id.slice(0, 24)}:${task.taskId}`.slice(0, 128),
      note,
    })
  } catch {
    // Ledger bounds / state guards are not execution failures — the
    // mission proceeds and the M41 provenance rows still stand.
  }
}

/** Bounded constant re-export for tests (the contract mirrors the mission). */
export const M44_BRIDGE_LIMITS = { noteChars: 390, missionObjectiveChars: MISSION_LIMITS.objectiveChars } as const
