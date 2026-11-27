/**
 * BEAN Intelligence — M44 Phase 4: the verified execution lifecycle (pure).
 *
 * Every executed action carries the full honest record and moves through an
 * explicit state machine whose transitions make dishonest success
 * STRUCTURALLY IMPOSSIBLE:
 *
 *   PLANNED → AWAITING_APPROVAL → APPROVED → EXECUTING → VERIFYING → SUCCEEDED
 *
 * with the honest side states BLOCKED, REJECTED, FAILED, CANCELLED,
 * PARTIALLY_SUCCEEDED and RECOVERY_REQUIRED.
 *
 * The load-bearing rule: EXECUTING may NEVER transition directly to
 * SUCCEEDED. A tool that reports a success-shaped response only moves the
 * action into VERIFYING — the Phase-5 independent postcondition verdict is
 * the ONLY edge into SUCCEEDED (and its failure edges are FAILED /
 * RECOVERY_REQUIRED / PARTIALLY_SUCCEEDED). "The tool said ok" is not a
 * verified outcome.
 *
 * The execution record carries everything the mission brief demands:
 * requested action, authorized scope, input parameters, execution identity,
 * start/completion timestamps, result + evidence, verification method and
 * the final status — bounded like every BEAN ledger contract.
 *
 * PURE module — no database, no I/O. SERVER-ONLY consumers.
 */

import type { ActionContract } from './action-contract'

// ---------------------------------------------------------------------------
// States + transitions.
// ---------------------------------------------------------------------------

export const ACTION_EXECUTION_STATES = [
  'PLANNED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'VERIFYING',
  'SUCCEEDED',
  'BLOCKED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_SUCCEEDED',
  'RECOVERY_REQUIRED',
] as const

export type ActionExecutionState = (typeof ACTION_EXECUTION_STATES)[number]

const ACTION_TRANSITIONS: Record<ActionExecutionState, readonly ActionExecutionState[]> = {
  PLANNED: ['AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'BLOCKED', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['EXECUTING', 'BLOCKED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED'],
  SUCCEEDED: [],
  BLOCKED: ['PLANNED', 'CANCELLED', 'RECOVERY_REQUIRED'],
  REJECTED: [],
  FAILED: ['RECOVERY_REQUIRED'],
  CANCELLED: [],
  PARTIALLY_SUCCEEDED: ['RECOVERY_REQUIRED'],
  RECOVERY_REQUIRED: ['PLANNED', 'FAILED'],
}

export class ActionStateError extends Error {}

export function canTransitionAction(from: ActionExecutionState, to: ActionExecutionState): boolean {
  return ACTION_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminalActionState(state: ActionExecutionState): boolean {
  return ACTION_TRANSITIONS[state].length === 0
}

/** The structural honesty check: no tool response can bypass verification. */
export function isHonestSuccessPath(states: readonly ActionExecutionState[]): boolean {
  for (let i = 0; i < states.length - 1; i++) {
    if (states[i] === 'EXECUTING' && states[i + 1] === 'SUCCEEDED') return false
    if (!canTransitionAction(states[i], states[i + 1])) return false
  }
  return states[states.length - 1] === 'SUCCEEDED'
}

// ---------------------------------------------------------------------------
// Verification verdicts (Phase 5 fills these; the lifecycle consumes them).
// ---------------------------------------------------------------------------

export type VerificationVerdict = 'confirmed' | 'failed' | 'inconclusive'

/** Deterministic mapping: the verdict decides the post-VERIFYING state. */
export function stateAfterVerification(verdict: VerificationVerdict): ActionExecutionState {
  switch (verdict) {
    case 'confirmed':
      return 'SUCCEEDED'
    case 'inconclusive':
      return 'RECOVERY_REQUIRED'
    case 'failed':
      return 'FAILED'
  }
}

// ---------------------------------------------------------------------------
// The execution record — the full audit trail of ONE action execution.
// ---------------------------------------------------------------------------

export interface ActionExecutionRecord {
  actionId: string
  planVersion: string
  /** The requested action (type + canonical params at request time). */
  requestedAction: { actionType: string; params: Record<string, string> }
  /** The scope the action was authorized under. */
  authorizedScope: string
  inputParams: Record<string, string>
  /** The opaque execution identity that ran the action. */
  executionIdentity: string
  /** Idempotency key (duplicate side effects detectable). */
  idempotencyKey: string
  startedAt: string | null
  completedAt: string | null
  /** The real execution result summary (bounded, honest). */
  resultSummary: string | null
  /** Evidence references captured from the real execution payload. */
  evidence: Array<{ kind: string; ref: string; note: string }>
  /** How the outcome was (or will be) verified — the independent method. */
  verificationMethod: string | null
  verificationVerdict: VerificationVerdict | null
  state: ActionExecutionState
  attempts: number
  /** Bounded honest note for blocked/failed/cancelled states. */
  note: string | null
}

export const ACTION_RECORD_LIMITS = {
  resultSummaryChars: 600,
  noteChars: 400,
  evidenceKindChars: 32,
  evidenceRefChars: 512,
  evidenceNoteChars: 200,
  maxEvidenceItems: 8,
} as const

export function createExecutionRecord(contract: ActionContract, executionIdentity: string): ActionExecutionRecord {
  return {
    actionId: contract.id,
    planVersion: contract.planVersion,
    requestedAction: { actionType: contract.actionType, params: contract.params },
    authorizedScope: contract.authScope,
    inputParams: contract.params,
    executionIdentity,
    idempotencyKey: contract.idempotencyKey,
    startedAt: null,
    completedAt: null,
    resultSummary: null,
    evidence: [],
    verificationMethod: null,
    verificationVerdict: null,
    state: contract.requiresApproval === 'human' ? 'AWAITING_APPROVAL' : contract.requiresApproval === 'self' ? 'PLANNED' : 'PLANNED',
    attempts: 0,
    note: null,
  }
}

export interface RecordPatch {
  state: ActionExecutionState
  resultSummary?: string | null
  evidence?: ActionExecutionRecord['evidence']
  verificationMethod?: string | null
  verificationVerdict?: VerificationVerdict | null
  startedAt?: string | null
  completedAt?: string | null
  note?: string | null
  attempts?: number
}

/**
 * Apply a state transition to a record. Throws on illegal transitions (the
 * structural rule lives in the transition table, not in caller discipline).
 */
export function applyActionTransition(record: ActionExecutionRecord, patch: RecordPatch): ActionExecutionRecord {
  if (!canTransitionAction(record.state, patch.state)) {
    throw new ActionStateError(`Illegal action transition ${record.state} → ${patch.state}.`)
  }
  const boundedEvidence = (patch.evidence ?? record.evidence).slice(0, ACTION_RECORD_LIMITS.maxEvidenceItems).map((e) => ({
    kind: e.kind.slice(0, ACTION_RECORD_LIMITS.evidenceKindChars),
    ref: e.ref.slice(0, ACTION_RECORD_LIMITS.evidenceRefChars),
    note: e.note.slice(0, ACTION_RECORD_LIMITS.evidenceNoteChars),
  }))
  const clip = (v: string | null | undefined, max: number): string | null => (v == null ? null : v.slice(0, max))
  return {
    ...record,
    state: patch.state,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : record.startedAt,
    completedAt: patch.completedAt !== undefined ? patch.completedAt : record.completedAt,
    resultSummary: patch.resultSummary !== undefined ? clip(patch.resultSummary, ACTION_RECORD_LIMITS.resultSummaryChars) : record.resultSummary,
    evidence: boundedEvidence,
    verificationMethod: patch.verificationMethod !== undefined ? clip(patch.verificationMethod, 200) : record.verificationMethod,
    verificationVerdict: patch.verificationVerdict !== undefined ? patch.verificationVerdict : record.verificationVerdict,
    note: patch.note !== undefined ? clip(patch.note, ACTION_RECORD_LIMITS.noteChars) : record.note,
    attempts: patch.attempts ?? record.attempts,
  }
}

/**
 * The verification edge: build the honest post-VERIFYING patch from the
 * Phase-5 verdict. This is the ONLY sanctioned way out of VERIFYING —
 * callers cannot write SUCCEEDED by hand through this helper's contract.
 */
export function verificationOutcomePatch(verdict: VerificationVerdict, method: string): RecordPatch {
  return {
    state: stateAfterVerification(verdict),
    verificationMethod: method,
    verificationVerdict: verdict,
    completedAt: new Date().toISOString(),
  }
}

/** A record may only claim success when the verdict chain says so. */
export function recordClaimsVerifiedSuccess(record: ActionExecutionRecord): boolean {
  return record.state === 'SUCCEEDED' && record.verificationVerdict === 'confirmed' && !!record.verificationMethod
}

/** Test/ops seam: the terminal states in registration order. */
export const ACTION_TERMINAL_STATES: readonly ActionExecutionState[] = ACTION_EXECUTION_STATES.filter((s) =>
  isTerminalActionState(s),
)
