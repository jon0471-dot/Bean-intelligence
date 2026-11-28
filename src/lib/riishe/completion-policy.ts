import type { TaskStage } from './states'

/**
 * BEAN Intelligence — P0 customer-facing completion policy (2026-11-28).
 *
 * ROOT-CAUSE FIX for the owner-rejected experience where ordinary chat
 * answers were badged "Completed with limitations". The defect: the internal
 * Trust mapping (`mapRiisheStatesToOutcome`) correctly records UNVERIFIED as
 * an evidence state — plain conversation never ran external verification, so
 * "unverified" is TRUE — but the customer-facing terminal stage collapsed
 * three different concepts into one badge:
 *
 *   1. CONVERSATION DELIVERY — did RIISHE successfully produce the answer?
 *   2. EVIDENCE VERIFICATION  — were material claims independently checked?
 *   3. OPERATIONAL EXECUTION  — did an actual action / mission complete?
 *
 * A plain answer whose delivery succeeded and which never REQUIRED external
 * verification is a fully successful conversation — it must not wear a
 * failure or limitation badge. This policy decides the CUSTOMER-FACING
 * terminal stage ONLY. The internal Trust Engine semantics are unchanged:
 * `statesFrom()` keeps assigning the honest evidence states and
 * `mapRiisheStatesToOutcome()` keeps recording the internal ledger outcome
 * (including completed_with_limitations for unverified turns). Nothing is
 * upgraded, erased, or falsified — this module only decides whether a
 * terminal badge is shown at all, and which one, from ACTUAL execution
 * facts recorded by the orchestrator (never by the model).
 *
 * Rules (evaluated in order; first match wins):
 *   R1. No answer produced                         → 'failed'
 *       (a turn that produced nothing is a real delivery failure).
 *   R2. TOOL_UNAVAILABLE                           → 'completed-with-limitations'
 *       (a required tool / retrieval failed while it was warranted — the
 *       answer is delivered but materially unconfirmed).
 *   R3. PARTIALLY_VERIFIED                         → 'completed-with-limitations'
 *       (verification ran and confirmed only part of the answer — material
 *       by construction: this state exists only when checks actually ran).
 *   R4. UNVERIFIED AND verification was warranted  → 'completed-with-limitations'
 *       (`searchNeeded || researchRan`): the turn needed current evidence
 *       but none could be confirmed. Material qualification stays honest.
 *   R5. A real operational execution ran           → 'completed'
 *       (workflow coordination, governed tool executions, sandbox runs,
 *       delegations — operational progress indicators help here, and a
 *       completed execution may say so).
 *   R6. Otherwise                                  → null (NO terminal stage)
 *       Ordinary conversational delivery: the answer exists, nothing was
 *       required beyond conversation, no badge at all. Material issues, when
 *       they exist, still surface through the verification note and sources
 *       (AnswerMeta) — this policy only removes the FALSE badge.
 *
 * Approval-waiting turns never reach the terminal rules: the orchestrator
 * emits 'approval-waiting' and intentionally records NO terminal stage while
 * a governed operation awaits the user's decision (the in-flight stage is
 * the honest last word).
 */

export interface CompletionPolicyInput {
  /** The turn produced a non-empty answer (delivery fact). */
  producedAnswer: boolean
  /** Response states assigned by `statesFrom()` from ACTUAL execution. */
  states: readonly string[]
  /** The search policy determined retrieval was warranted for this turn. */
  searchNeeded: boolean
  /** Retrieval actually executed this turn (even if it found nothing). */
  researchRan: boolean
  /** A real operational execution happened (workflow active OR any governed
   *  tool actually executed — sandbox, delegation, calculation, mission). */
  operationalRun: boolean
}

export function customerTerminalStage(input: CompletionPolicyInput): TaskStage | null {
  if (!input.producedAnswer) return 'failed'
  const set = new Set(input.states)
  if (set.has('TOOL_UNAVAILABLE')) return 'completed-with-limitations'
  if (set.has('PARTIALLY_VERIFIED')) return 'completed-with-limitations'
  if (set.has('UNVERIFIED') && (input.searchNeeded || input.researchRan)) {
    return 'completed-with-limitations'
  }
  if (input.operationalRun) return 'completed'
  return null
}
