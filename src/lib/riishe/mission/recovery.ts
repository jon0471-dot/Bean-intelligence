/**
 * BEAN Intelligence — M44 Phase 6: failure recovery & learning (pure).
 *
 * Safe recovery for executed actions: classify failures, retry only when
 * safe (never duplicating side effects), resume from valid checkpoints,
 * compensate where possible, preserve partial successes, escalate ambiguous
 * or irreversible recovery decisions to humans, and record lessons with
 * provenance THROUGH the M43 knowledge guard — an unverified execution
 * observation can never become trusted knowledge.
 *
 * Additional boundary enforced here: an agent can never modify its own
 * safety policies or grant itself new permissions — contracts whose
 * parameters carry permission-granting/policy-rewriting patterns are
 * refused BEFORE the gate (belt and suspenders: the action vocabulary has
 * no such type, and this check refuses the shapes too).
 *
 * PURE module — no database, no I/O. SERVER-ONLY consumers.
 */

import type { ActionContract } from './action-contract'

// ---------------------------------------------------------------------------
// Failure classification.
// ---------------------------------------------------------------------------

export type FailureClass = 'transient' | 'permanent' | 'authorization' | 'verification'

export interface FailureSignal {
  /** Where the failure surfaced (execution path / verification layer). */
  source: 'execution' | 'verification' | 'authorization'
  message: string
  statusCode?: number
  timeout?: boolean
  /** The Phase-5 verdict, when the failure came from verification. */
  verdict?: 'confirmed' | 'failed' | 'inconclusive'
}

const AUTHORIZATION_PATTERNS = [
  /permission denied/i,
  /not approved/i,
  /approval/i,
  /scope/i,
  /unauthorized/i,
  /forbidden/i,
  /escalat/i,
]

const TRANSIENT_PATTERNS = [
  /timeout|timed?\s?out/i,
  /rate\s?limit/i,
  /temporarily|unavailable|try again/i,
  /network|connection|socket|econn/i,
  /queue|overloaded|capacity/i,
  /503|502|504|429/,
]

/** Deterministic classification: authorization first (retry never fixes it),
 *  then verification (recovery, not a blind retry), then transient, then
 *  permanent. */
export function classifyFailure(signal: FailureSignal): FailureClass {
  if (signal.source === 'verification') return 'verification'
  if (signal.source === 'authorization') return 'authorization'
  if (signal.statusCode === 401 || signal.statusCode === 403) return 'authorization'
  if (AUTHORIZATION_PATTERNS.some((re) => re.test(signal.message))) return 'authorization'
  if (signal.timeout) return 'transient'
  if (signal.statusCode !== undefined && TRANSIENT_PATTERNS.some((re) => re.test(String(signal.statusCode)))) return 'transient'
  if (TRANSIENT_PATTERNS.some((re) => re.test(signal.message))) return 'transient'
  return 'permanent'
}

// ---------------------------------------------------------------------------
// Safe retry decisions.
// ---------------------------------------------------------------------------

export interface RetryDecision {
  retry: boolean
  attempt: number
  delayMs: number
  reason: string
}

export interface RetryContext {
  contract: ActionContract
  failureClass: FailureClass
  attemptsSoFar: number
  cancelRequested: boolean
  /** How many runs the idempotency ledger shows for this action. */
  observedRuns: number | null
}

/**
 * Retry ONLY when safe: transient failures inside the contract's bounded
 * attempt budget, with the idempotency ledger showing the action has not
 * already run its allowance (duplicate side effects are never risked).
 * Authorization and verification failures never blind-retry — they recover
 * or escalate. Cancellation voids everything.
 */
export function planRetry(ctx: RetryContext): RetryDecision {
  const { contract } = ctx
  const attempt = ctx.attemptsSoFar + 1
  if (ctx.cancelRequested) {
    return { retry: false, attempt, delayMs: 0, reason: 'Cancellation was requested — no retry.' }
  }
  if (ctx.failureClass === 'authorization') {
    return { retry: false, attempt, delayMs: 0, reason: 'Authorization failures are not retryable — obtain the missing approval or scope first.' }
  }
  if (ctx.failureClass === 'verification') {
    return { retry: false, attempt, delayMs: 0, reason: 'Verification failures do not blind-retry — re-verify or recover instead (RECOVERY_REQUIRED).' }
  }
  if (ctx.failureClass === 'permanent') {
    return { retry: false, attempt, delayMs: 0, reason: 'Permanent failures are not retryable — the plan or input must change.' }
  }
  if (attempt > contract.retry.maxAttempts) {
    return { retry: false, attempt, delayMs: 0, reason: `Attempt budget exhausted (${ctx.attemptsSoFar}/${contract.retry.maxAttempts}).` }
  }
  if (contract.riskClass !== 'read-only') {
    if (!contract.idempotencyKey) {
      return { retry: false, attempt, delayMs: 0, reason: 'No idempotency key — a retry could duplicate side effects.' }
    }
    if (ctx.observedRuns !== null && ctx.observedRuns >= contract.retry.maxAttempts) {
      return { retry: false, attempt, delayMs: 0, reason: `Idempotency ledger already shows ${ctx.observedRuns} run(s) — retrying could duplicate the side effect.` }
    }
  }
  return {
    retry: true,
    attempt,
    delayMs: contract.retry.backoffMs * (attempt - 1),
    reason: `Transient failure, safe to retry (attempt ${attempt}/${contract.retry.maxAttempts}, idempotency key present${ctx.observedRuns !== null ? `, ledger at ${ctx.observedRuns}` : ''}).`,
  }
}

// ---------------------------------------------------------------------------
// Compensating actions.
// ---------------------------------------------------------------------------

export type CompensationKind = 'auto' | 'approval-gated' | 'none'

export interface CompensationPlan {
  kind: CompensationKind
  description: string
}

const COMPENSATIONS: Record<string, CompensationPlan> = {
  'file-write': { kind: 'auto', description: 'Restore the previous file content from the workspace version history.' },
  'code-build': { kind: 'auto', description: 'Revert the project files to the checkpoint state (workspace version history).' },
  'media-produce': { kind: 'auto', description: 'Remove the created asset within the asset-create scope (nothing else is touched).' },
  research: { kind: 'auto', description: 'Nothing to compensate — read-only retrieval.' },
  'repo-commit': { kind: 'auto', description: 'Create a compensating revert commit on the same branch.' },
  'repo-push': { kind: 'none', description: 'A push is publication — no reliable compensation exists; recovery decisions belong to the owner.' },
  'website-publish-verify': { kind: 'approval-gated', description: 'Take the served page offline (itself a state change requiring the normal gate).' },
  'deployment-release': { kind: 'approval-gated', description: 'Roll the deployment back to the previous revision (approval-gated like the release).' },
  'external-communicate': { kind: 'none', description: 'Sent communication cannot be unsent; any follow-up is an owner decision.' },
}

export function compensatingActionFor(contract: ActionContract): CompensationPlan {
  return COMPENSATIONS[contract.actionType] ?? { kind: 'none', description: 'No compensation is defined for this action type; recovery decisions belong to the owner.' }
}

// ---------------------------------------------------------------------------
// Human escalation for recovery decisions.
// ---------------------------------------------------------------------------

export interface RecoveryEscalation {
  escalate: boolean
  reason: string | null
}

export interface RecoveryContext {
  failureClass: FailureClass
  contract: ActionContract
  attemptsExhausted: boolean
  /** The checkpoint state is missing or invalid for a resume. */
  checkpointInvalid: boolean
}

/**
 * Escalate when the recovery itself is ambiguous or irreversible: no
 * compensation exists, the checkpoint is unusable, attempts are exhausted,
 * or the failure is verification-shaped on an irreversible action.
 * Partial successes are preserved either way — escalation never destroys.
 */
export function needsHumanEscalation(ctx: RecoveryContext): RecoveryEscalation {
  if (ctx.contract.reversibility === 'irreversible') {
    return { escalate: true, reason: `The failed action (${ctx.contract.actionType}) is irreversible — a human decides recovery.` }
  }
  const compensation = compensatingActionFor(ctx.contract)
  if (compensation.kind === 'none' && ctx.failureClass !== 'authorization') {
    return { escalate: true, reason: 'No compensating action exists for this failure — a human decides recovery.' }
  }
  if (ctx.checkpointInvalid) {
    return { escalate: true, reason: 'No valid checkpoint exists to resume from — a human decides recovery.' }
  }
  if (ctx.attemptsExhausted && ctx.failureClass === 'transient') {
    return { escalate: true, reason: 'All attempts exhausted on a transient failure — a human decides whether to continue.' }
  }
  if (ctx.failureClass === 'authorization') {
    return { escalate: true, reason: 'Authorization is missing — a human must grant it or reshape the plan.' }
  }
  return { escalate: false, reason: null }
}

// ---------------------------------------------------------------------------
// Safety-policy self-modification guard.
// ---------------------------------------------------------------------------

const POLICY_GRANT_PATTERNS = [
  /allow[a-zA-Z0-9_]{2,32}\s*[:=]\s*(true|"true"|'true')/i,
  /"?(permission|policy|scope|role)"?\s*[:=]\s*"?(admin|owner|root|superuser|bypass)"/i,
  /grant\s+(myself|this\s+agent|the\s+agent)/i,
  /disable\s+(trust|safety|approval|guard)/i,
  /(trust|safety|authorization|approval)[a-z0-9_-]*\.(json|ya?ml|ts|js)$/i,
]

export type PolicyGuardVerdict = { ok: true } | { ok: false; matched: string }

/**
 * Refuse contracts whose parameters try to rewrite safety policies or grant
 * new permissions. The vocabulary already has no such action type; this
 * catches the shapes hiding inside parameters (paths, prompts, payloads).
 */
export function assertNoPolicySelfModification(contract: ActionContract): PolicyGuardVerdict {
  const blobs = [contract.description, ...Object.values(contract.params)]
  for (const blob of blobs) {
    for (const re of POLICY_GRANT_PATTERNS) {
      const m = blob.match(re)
      if (m) return { ok: false, matched: m[0].slice(0, 80) }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Lessons with provenance — through the M43 knowledge guard.
// ---------------------------------------------------------------------------

export interface ExecutionLesson {
  claim: string
  domain: string
  /** The lesson is TRUSTED only when the postconditions were independently confirmed. */
  verificationConfirmed: boolean
  verificationMethod: string | null
  provenance: Array<{ kind: string; ref: string }>
  missionId: string
  actionId: string
}

export interface LessonKnowledgeShape {
  claim: string
  domain: string
  knowledgeClass: 'unverified-research-note' | 'project-specific'
  verificationOutcome: 'verified' | null
  confidence: 'high' | 'low'
  /** Honest guard note appended when the lesson is NOT independently confirmed. */
  guardNote: string | null
}

/**
 * Shape a lesson for the M43 knowledge layer. An execution observation is
 * only "verified" when the Phase-5 postcondition verdict was CONFIRMED by
 * the independent method — everything else is stored as an unverified
 * research note (the M43 guard would refuse a trusted class for it anyway;
 * this function never even asks).
 */
export function lessonForKnowledge(lesson: ExecutionLesson): LessonKnowledgeShape {
  const provenanceNote = lesson.provenance
    .slice(0, 3)
    .map((p) => `${p.kind}:${p.ref.slice(0, 80)}`)
    .join(' | ')
  if (!lesson.verificationConfirmed || !lesson.verificationMethod) {
    return {
      claim: `[unverified execution observation] ${lesson.claim}`.slice(0, 300),
      domain: lesson.domain,
      knowledgeClass: 'unverified-research-note',
      verificationOutcome: null,
      confidence: 'low',
      guardNote: `Unverified execution observation from mission ${lesson.missionId.slice(0, 24)} action ${lesson.actionId}: it must never back trusted knowledge. Provenance: ${provenanceNote}`.slice(0, 400),
    }
  }
  return {
    claim: `[verified by ${lesson.verificationMethod.slice(0, 60)}] ${lesson.claim}`.slice(0, 300),
    domain: lesson.domain,
    knowledgeClass: 'project-specific',
    verificationOutcome: 'verified',
    confidence: 'high',
    guardNote: null,
  }
}

/** Test/ops seam: the failure classes in registration order. */
export const FAILURE_CLASSES: readonly FailureClass[] = ['transient', 'permanent', 'authorization', 'verification']
