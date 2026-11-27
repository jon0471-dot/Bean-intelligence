/**
 * BEAN Intelligence — M44 Phase 3: the authorization boundary (pure).
 *
 * The strict gate BETWEEN planning and execution. It reads the Phase-2
 * action contract and decides whether the action may proceed, must wait for
 * a human approval, or is blocked — and it validates approval bindings so
 * that a stale, modified, re-used or wrongly-scoped approval can never
 * unlock an action.
 *
 * Hard rules encoded HERE:
 *   1. Least privilege: an identity acts only inside its granted scopes; a
 *      delegated identity's scopes must be a SUBSET of its grantor's scopes
 *      (no escalation through delegation).
 *   2. Approvals bind to the EXACT action: the sha-256 digest covers the
 *      action type, parameters, scope, idempotency key AND the plan digest —
 *      any modification (a changed parameter, a re-planned DAG, a wider
 *      scope) changes the digest and the binding is rejected. The digest
 *      discipline is the Trust Engine's canonical hashing — one pattern.
 *   3. An approval is consumed on use (consume-once lives in the Trust
 *      Engine), expires with the task's TTL, and is validated SERVER-SIDE
 *      immediately before the action — the executor's own claim is never
 *      the authorization.
 *   4. An AI-generated plan is NEVER user authorization: only an owner-user
 *      decision unlocks a human-class action; a delegated agent (or the
 *      planner itself) can neither grant nor carry an approval.
 *   5. Immediate cancellation: a cancellation flag voids every gate state
 *      at the next check — approval already granted does not survive it.
 *
 * PURE module — no database, no I/O. The server-side consume path reuses the
 * Trust Engine's approvals (requestTaskApproval / consumeTaskApproval).
 */

import { actionDigestFor } from '@/lib/trust/digest'
import type { ActionContract, ActionPlan } from './action-contract'
import { checkCapabilities, planChanged, type ExecutorIdentity } from './action-contract'

// ---------------------------------------------------------------------------
// Approval payloads — what the owner actually sees and what gets bound.
// ---------------------------------------------------------------------------

/** The canonical approval payload: everything that defines the action. */
export interface ApprovalPayload {
  m44: 'action-approval'
  actionType: ActionContract['actionType']
  title: string
  description: string
  params: Record<string, string>
  authScope: string
  riskClass: ActionContract['riskClass']
  reversibility: ActionContract['reversibility']
  idempotencyKey: string
  planVersion: string
  planDigest: string
  actionId: string
}

export function buildApprovalPayload(contract: ActionContract, plan: ActionPlan): ApprovalPayload {
  if (contract.planVersion !== plan.planVersion) {
    throw new Error(`Action "${contract.id}" is not stamped with the plan version — rebuild the plan first.`)
  }
  return {
    m44: 'action-approval',
    actionType: contract.actionType,
    title: contract.title,
    description: contract.description,
    params: contract.params,
    authScope: contract.authScope,
    riskClass: contract.riskClass,
    reversibility: contract.reversibility,
    idempotencyKey: contract.idempotencyKey,
    planVersion: contract.planVersion,
    planDigest: plan.digest,
    actionId: contract.id,
  }
}

export function approvalDigest(payload: ApprovalPayload): string {
  return actionDigestFor(payload)
}

// ---------------------------------------------------------------------------
// Approval binding validation — stale/modified/misused approvals die here.
// ---------------------------------------------------------------------------

/** The persisted approval state the executor sees (Trust Engine row). */
export interface ApprovalRecordView {
  actionDigest: string
  actionJson: string
  status: string
}

export type BindingRejection =
  | 'digest-mismatch' // the action was modified after the approval was granted
  | 'plan-stale' // the plan was re-planned after the approval was granted
  | 'wrong-action' // the approval belongs to a different action
  | 'not-granted' // still requested, denied, consumed or expired
  | 'invalid-payload' // the stored payload is not an M44 action approval

export interface BindingValidation {
  ok: boolean
  reason: BindingRejection | null
}

/**
 * Validate an approval against the EXACT contract+plan it is about to
 * unlock. Order matters: payload shape → action identity → plan freshness →
 * status. A passed validation is still consumed server-side (consume-once)
 * before the action runs.
 */
export function validateApprovalBinding(
  approval: ApprovalRecordView,
  contract: ActionContract,
  plan: ActionPlan,
): BindingValidation {
  let payload: ApprovalPayload
  try {
    const parsed = JSON.parse(approval.actionJson) as ApprovalPayload
    if (parsed?.m44 !== 'action-approval' || typeof parsed.actionType !== 'string') {
      return { ok: false, reason: 'invalid-payload' }
    }
    payload = parsed
  } catch {
    return { ok: false, reason: 'invalid-payload' }
  }
  if (payload.actionId !== contract.id) return { ok: false, reason: 'wrong-action' }
  // Stale plan first: an approval granted for an older plan never carries
  // over (the payload embeds the plan digest, so this also catches re-plans
  // with the precise reason instead of a generic content mismatch).
  if (payload.planDigest !== plan.digest || payload.planVersion !== plan.planVersion || planChanged(plan, payload.planDigest)) {
    return { ok: false, reason: 'plan-stale' }
  }
  // ANY modification of the action content (params/scope/type/key) breaks this.
  if (approval.actionDigest !== approvalDigest(payload)) return { ok: false, reason: 'digest-mismatch' }
  // The approval must describe EXACTLY the current contract content.
  if (approvalDigest(payload) !== approvalDigest(buildApprovalPayload(contract, plan))) {
    return { ok: false, reason: 'digest-mismatch' }
  }
  if (approval.status !== 'granted') return { ok: false, reason: 'not-granted' }
  return { ok: true, reason: null }
}

// ---------------------------------------------------------------------------
// Delegation guard — no privilege escalation through delegated agents.
// ---------------------------------------------------------------------------

export interface GrantorIdentity {
  identity: string
  scopes: readonly string[]
}

export type DelegationVerdict =
  | { ok: true }
  | { ok: false; reason: 'scope-escalation'; added: string[] }
  | { ok: false; reason: 'self-delegation' }

/**
 * A delegated identity may hold only scopes its grantor holds. A new scope
 * appearing on the delegate is escalation and is refused BEFORE any gate is
 * evaluated. A delegator delegating to itself is refused outright.
 */
export function checkDelegation(delegate: ExecutorIdentity, grantor: GrantorIdentity | null): DelegationVerdict {
  if (!delegate.delegatedFrom) return { ok: true }
  if (!grantor || grantor.identity !== delegate.delegatedFrom) {
    // The claimed grantor is unknown — treat every scope as unverified.
    return { ok: false, reason: 'scope-escalation', added: [...delegate.scopes] }
  }
  if (delegate.identity === delegate.delegatedFrom) return { ok: false, reason: 'self-delegation' }
  const grantorScopes = new Set(grantor.scopes)
  const added = [...delegate.scopes].filter((s) => !grantorScopes.has(s))
  return added.length > 0 ? { ok: false, reason: 'scope-escalation', added } : { ok: true }
}

// ---------------------------------------------------------------------------
// Approver identity — an AI-generated plan is never user authorization.
// ---------------------------------------------------------------------------

export type ApproverKind = 'owner-user' | 'delegated-agent' | 'system'

export interface ApprovalDecisionContext {
  approverKind: ApproverKind
  approverId: string
}

export type DecisionAcceptance = { ok: true } | { ok: false; reason: 'non-owner-decision' | 'self-approval-by-executor' }

/**
 * Only an OWNER-USER decision may unlock a human-class action. A delegated
 * agent deciding its own plan is the classic self-authorization hole; the
 * system granting approvals to itself is equally refused. The executor
 * identity granting its own action is refused even when it IS an owner —
 * a decision is about the action, made outside the execution path.
 */
export function validateApprovalDecision(decision: ApprovalDecisionContext, executorIdentity: string | null): DecisionAcceptance {
  if (decision.approverKind !== 'owner-user') return { ok: false, reason: 'non-owner-decision' }
  if (executorIdentity && decision.approverId === executorIdentity) {
    return { ok: false, reason: 'self-approval-by-executor' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// The gate — one function the executor calls before EVERY action.
// ---------------------------------------------------------------------------

export type GateDecision =
  | { action: 'proceed'; selfAuthorized: boolean; approvalConsumed?: false }
  | { action: 'awaiting-approval' }
  | { action: 'blocked'; reason: string }

export interface GateInput {
  contract: ActionContract
  plan: ActionPlan
  identity: ExecutorIdentity
  grantor: GrantorIdentity | null
  /** The Trust Engine approval row state for this action, when one exists. */
  approval: ApprovalRecordView | null
  /** Set the moment an owner/staff cancellation arrives. */
  cancelRequested: boolean
}

/**
 * The Phase-3 gate. Read-only actions proceed without any approval;
 * reversible actions proceed only inside the identity's granted scope;
 * human-class actions proceed only with a VALID, bound, still-granted
 * approval (consumed server-side on use by the runtime seam). Cancellation
 * voids everything. Delegation is checked first — an escalated identity
 * gets nothing.
 */
export function authorizeAction(input: GateInput): GateDecision {
  if (input.cancelRequested) {
    return { action: 'blocked', reason: 'Cancellation was requested — every gate state is void.' }
  }
  const delegation = checkDelegation(input.identity, input.grantor)
  if (!delegation.ok) {
    return {
      action: 'blocked',
      reason:
        delegation.reason === 'self-delegation'
          ? 'An identity cannot delegate to itself.'
          : `Delegated scope escalation refused: the delegate holds scopes the grantor never held (${delegation.added.join(', ')}).`,
    }
  }
  if (input.contract.planVersion === 'pending-plan-digest') {
    return { action: 'blocked', reason: 'The action is not bound to an approved plan version (pending-plan-digest).' }
  }
  const capability = checkCapabilities(input.contract, input.identity)
  if (!capability.ok) {
    return { action: 'blocked', reason: `The identity lacks the required scope: ${capability.missingScopes.join(', ')}.` }
  }
  switch (input.contract.requiresApproval) {
    case 'none':
      return { action: 'proceed', selfAuthorized: false }
    case 'self':
      // Scope possession IS the standing authorization for reversible work.
      return { action: 'proceed', selfAuthorized: true }
    case 'human': {
      if (!input.approval) return { action: 'awaiting-approval' }
      const binding = validateApprovalBinding(input.approval, input.contract, input.plan)
      if (!binding.ok) {
        const reasons: Record<BindingRejection, string> = {
          'digest-mismatch': 'The approval no longer matches the action (modified after grant) — it is rejected.',
          'plan-stale': 'The approval was granted for an older plan version — it is stale and rejected.',
          'wrong-action': 'The approval belongs to a different action.',
          'not-granted': 'The approval is not in the granted state (requested/denied/consumed/expired).',
          'invalid-payload': 'The stored approval payload is not a valid M44 action approval.',
        }
        return { action: 'blocked', reason: reasons[binding.reason as BindingRejection] ?? 'The approval is not valid.' }
      }
      return { action: 'proceed', selfAuthorized: false }
    }
  }
}

/** Test/ops seam: the gate's decision vocabulary in registration order. */
export const AUTHORIZATION_GATE_ACTIONS = ['proceed', 'awaiting-approval', 'blocked'] as const
