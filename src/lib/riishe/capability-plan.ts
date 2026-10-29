/**
 * BEAN Intelligence — per-turn capability planning (pure, deterministic).
 *
 * The composer no longer exposes mode toggles: RIISHE decides which
 * capabilities a turn needs, from the message and the attached files.
 * This module is the auditable decision surface:
 *
 *  - live retrieval is decided by the research policy + semantic router
 *    (unchanged — see resolveSearchDecisionLive);
 *  - code execution is granted when the task genuinely needs it (math with
 *    nontrivial arithmetic, explicit "run/execute/simulate" requests) and
 *    the restricted sandbox exists — the sandbox itself stays bounded and
 *    isolated exactly as before;
 *  - document/image capabilities activate from the attachments themselves.
 *
 * Removing the user-facing buttons does NOT remove any backend capability:
 * this planner keeps every decision explicit and testable.
 */

export interface CapabilityPlan {
  /** Grant run_code for this turn (sandbox availability checked separately). */
  codeExecution: boolean
  /** Human-readable reasons (logged; safe for support). */
  reasons: string[]
}

const EXECUTION_REQUEST_RE =
  /\b(run|execute|evaluate)\s+(this|the)?\s*(code|script|snippet|program|function|calculation|computation)/i
/** Simulation inherently requires execution. */
const SIMULATION_RE = /\b(simulate|simulation|monte\s+carlo)\b/i
const CODE_ARTIFACT_RE =
  /\b(javascript|typescript|node|python-style logic|algorithm|pseudocode)\b.{0,60}\b(verify|test|trace|simulate|compute|run)\b/i

/** Genuinely-computational shapes: the sandbox adds real value here. */
const HEAVY_COMPUTE_RE =
  /\b(factorial|permutation|combination|matrix|modular|exponent|fibonacci|prime|hash|monte\s+carlo|big\s+number|\d{3,}\s*[*/^]\s*\d{3,})|\b\d+\s*!\s*(mod|%|\+|-|<|>|=|$)/i

export function planCapabilities(message: string, task: string, hasDocuments: boolean): CapabilityPlan {
  const reasons: string[] = []
  const text = message.trim()

  let codeExecution = false
  if (EXECUTION_REQUEST_RE.test(text)) {
    codeExecution = true
    reasons.push('execution requested explicitly')
  } else if (SIMULATION_RE.test(text)) {
    codeExecution = true
    reasons.push('simulation requires execution')
  } else if (task === 'math' && HEAVY_COMPUTE_RE.test(text)) {
    codeExecution = true
    reasons.push('computational task benefits from sandbox verification')
  } else if (CODE_ARTIFACT_RE.test(text)) {
    codeExecution = true
    reasons.push('code behavior verification requested')
  }

  if (hasDocuments) reasons.push('attachments present: document/image tools activated from file kinds')

  return { codeExecution, reasons }
}
