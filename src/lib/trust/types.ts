/**
 * BEAN Intelligence — Trust Engine types and lifecycle contract (pure).
 *
 * The truthful task lifecycle requested by the February 2027 product brief:
 *
 *   planned → running ⇄ waiting_for_approval → terminal
 *
 * Terminal states: completed | completed_with_limitations | partially_completed
 * | failed | cancelled.
 *
 * Honesty rules encoded here (not left to callers):
 *   1. A task may only reach a terminal status through an explicit settle
 *      operation that CARRIES a verification summary or a truthful
 *      failure/cancel note — never "the model replied, so it is done".
 *   2. Transitions are validated against the table below; illegal jumps are
 *      rejected before any database write.
 *   3. Response/verification states assigned from ACTUAL execution (see
 *      src/lib/riishe/states.ts) map onto honest outcome kinds — an answer
 *      that could not be verified can never finalize as plain "completed".
 *
 * PURE module — no database, no I/O. SERVER-ONLY.
 */

export const TRUST_TASK_STATUSES = [
  'planned',
  'waiting_for_approval',
  'running',
  'completed',
  'completed_with_limitations',
  'partially_completed',
  'failed',
  'cancelled',
] as const
export type TrustTaskStatus = (typeof TRUST_TASK_STATUSES)[number]

export const TRUST_TERMINAL_STATUSES: readonly TrustTaskStatus[] = [
  'completed',
  'completed_with_limitations',
  'partially_completed',
  'failed',
  'cancelled',
]

export function isTerminalTaskStatus(status: string): boolean {
  return (TRUST_TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Legal status transitions. Terminal states have no outgoing edges. */
const TASK_TRANSITIONS: Record<TrustTaskStatus, readonly TrustTaskStatus[]> = {
  planned: ['running', 'waiting_for_approval', 'cancelled', 'failed'],
  waiting_for_approval: ['running', 'cancelled', 'failed'],
  running: [
    'waiting_for_approval',
    'completed',
    'completed_with_limitations',
    'partially_completed',
    'failed',
    'cancelled',
  ],
  completed: [],
  completed_with_limitations: [],
  partially_completed: [],
  failed: [],
  cancelled: [],
}

export function canTransitionTask(from: TrustTaskStatus, to: TrustTaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false
}

/** Legal next statuses from the given status (used by routes/UI). */
export function nextTaskStatuses(from: TrustTaskStatus): readonly TrustTaskStatus[] {
  return TASK_TRANSITIONS[from] ?? []
}

export class TrustStateError extends Error {}
export class TrustLimitError extends Error {}
export class TrustNotFoundError extends Error {}

/** Step lifecycle. A step row is append-only ledger: it advances, never rewinds. */
export const TRUST_STEP_STATUSES = ['planned', 'running', 'done', 'failed', 'skipped'] as const
export type TrustStepStatus = (typeof TRUST_STEP_STATUSES)[number]
export const TRUST_STEP_KINDS = [
  'plan',
  'retrieval',
  'tool',
  'generation',
  'verification',
  'delivery',
  'approval',
  'recovery',
] as const
export type TrustStepKind = (typeof TRUST_STEP_KINDS)[number]

const STEP_TRANSITIONS: Record<TrustStepStatus, readonly TrustStepStatus[]> = {
  planned: ['running', 'done', 'failed', 'skipped'],
  running: ['done', 'failed', 'skipped'],
  done: [],
  failed: [],
  skipped: [],
}

export function canTransitionStep(from: TrustStepStatus, to: TrustStepStatus): boolean {
  return STEP_TRANSITIONS[from]?.includes(to) ?? false
}

/** Evidence taxonomy. `origin` separates extracted fact from model interpretation. */
export const TRUST_EVIDENCE_KINDS = [
  'source',
  'document',
  'tool-output',
  'artifact',
  'measurement',
  'limitation',
] as const
export type TrustEvidenceKind = (typeof TRUST_EVIDENCE_KINDS)[number]
export const TRUST_EVIDENCE_ORIGINS = ['extracted', 'model_interpretation'] as const
export type TrustEvidenceOrigin = (typeof TRUST_EVIDENCE_ORIGINS)[number]

/** RIISHE response states assigned from actual execution (src/lib/riishe/states.ts). */
export const RIISHE_RESPONSE_STATES = [
  'VERIFIED_FROM_SOURCES',
  'COMPUTATION_VERIFIED',
  'EXECUTION_VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNVERIFIED',
  'TOOL_UNAVAILABLE',
] as const

export interface TrustOutcome {
  outcome: 'completed' | 'completed_with_limitations' | 'partially_completed' | 'failed'
  reason: string
}

/**
 * Honest mapping from RIISHE response states (assigned from actual execution,
 * never by the model) to a Trust Engine outcome. The mapping NEVER upgrades:
 * an unverified or partially verified answer finalizes with limitations —
 * never as plain "completed".
 */
export function mapRiisheStatesToOutcome(
  states: readonly string[],
  producedAnswer: boolean,
): TrustOutcome {
  if (!producedAnswer) {
    return {
      outcome: 'failed',
      reason: 'No answer was produced; nothing was persisted as a complete response.',
    }
  }
  const set = new Set(states)
  if (set.has('UNVERIFIED')) {
    return {
      outcome: 'completed_with_limitations',
      reason: 'An answer was produced but the verification pass could not confirm it.',
    }
  }
  if (set.has('TOOL_UNAVAILABLE')) {
    return {
      outcome: 'completed_with_limitations',
      reason: 'An answer was produced, but required tools were unavailable so parts could not be verified.',
    }
  }
  if (set.has('PARTIALLY_VERIFIED')) {
    return {
      outcome: 'completed_with_limitations',
      reason: 'An answer was produced; verification confirmed only part of it.',
    }
  }
  if (set.size === 0) {
    return {
      outcome: 'completed_with_limitations',
      reason: 'An answer was produced, but no verification states were recorded.',
    }
  }
  return {
    outcome: 'completed',
    reason: 'An answer was produced and its assigned verification states passed.',
  }
}

/** Bounded-size contracts for every free-text field persisted in the ledger. */
export const TRUST_LIMITS = {
  title: 120,
  requestPreview: 2000,
  summaryField: 600,
  noteField: 400,
  detailJson: 4000,
  payloadJson: 4000,
  actionJson: 8000,
  stepsPerTask: 100,
  evidencePerTask: 200,
  checkpointsPerTask: 50,
  limitationsPerTask: 20,
  limitationChars: 300,
  refChars: 2048,
} as const
