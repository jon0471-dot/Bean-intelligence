/**
 * BEAN Intelligence — RIISHE multi-step workflow detection + protocol (M37 §4).
 *
 * RIISHE coordinates its EXISTING specialist capabilities (research pipeline,
 * document intelligence, CODE GIFTZ delegation, media specialists, sandbox)
 * through ONE conversation. This module deterministically decides WHEN a
 * message spans several capability domains — the "one workflow" case — and
 * provides the composer protocol that turns the reply into a genuine
 * plan → execute → verify → deliver sequence.
 *
 * NOT a competing agent framework: no second queue, no second model call for
 * planning, no persistent plan object. The plan is part of the model's answer
 * and every step of it can only act through the SAME bounded tool loop and
 * its REAL tools (registry-enforced). The protocol cannot grant any
 * capability the orchestrator did not already decide to expose.
 *
 * PURE module — regex + string shaping only. No DB, no I/O, no model calls.
 */

import type { CapabilityPlan } from './capability-plan'

export type WorkflowPart = 'research' | 'documents' | 'coding' | 'media' | 'computation'

export interface WorkflowPlan {
  /** True when the message spans TWO OR MORE distinct capability domains. */
  active: boolean
  /** The domains involved (stable order for logs/tests). */
  parts: WorkflowPart[]
}

export interface WorkflowDetectInput {
  /** Whether live retrieval will run for this turn (search decision made). */
  searchNeeded: boolean
  /** Classified task (before any document-driven override). */
  task: string
  /** Attached documents present. */
  hasDocuments: boolean
  /** The per-turn capability plan (already computed from the same message). */
  plan: Pick<
    CapabilityPlan,
    'codeExecution' | 'imageGeneration' | 'videoCreation' | 'speechSynthesis' | 'codingDelegation'
  >
}

/**
 * Detect the multi-domain workflow case. Deliberately narrow: each part
 * requires its own concrete signal (retrieval decision, attachments, an
 * explicit build/delegation plan, a media-creation plan or sandbox
 * computation). A single-domain request never activates the workflow —
 * ordinary turns behave EXACTLY as before.
 */
export function detectWorkflow(input: WorkflowDetectInput): WorkflowPlan {
  const parts: WorkflowPart[] = []
  if (input.searchNeeded || input.task === 'research') parts.push('research')
  if (input.hasDocuments) parts.push('documents')
  if (input.plan.codingDelegation) parts.push('coding')
  if (input.plan.imageGeneration || input.plan.videoCreation || input.plan.speechSynthesis) parts.push('media')
  if (input.plan.codeExecution && input.task === 'math') parts.push('computation')
  return { active: parts.length >= 2, parts }
}

/**
 * Composer protocol for workflow turns. Injected by the orchestrator on top
 * of the task protocols when detectWorkflow() activated. It shapes the
 * answer; it can NEVER expand the tool universe (the registry owns that).
 */
export const WORKFLOW_PROTOCOL = `

Multi-step workflow protocol (this request spans several capability domains):
- START your reply with a short numbered task plan (3-6 steps) mapping the user's objective onto the capabilities you will ACTUALLY use this turn. Plan only steps that are executable with your available tools and the attached material.
- EXECUTE the plan with REAL tool calls, one domain at a time. Between steps, state what completed and what it produced (search results found, document passages read, jobs submitted). Never narrate a step you did not take.
- For implementation work: submit it through the coding delegation tool, then CHECK the job status before claiming anything. A queued or running job is NOT finished work — report it as in progress and name exactly where the result will appear.
- Do not fabricate intermediate outputs: a research claim needs its [n] citation, a document claim needs the document it came from, a coding result needs the REAL job status. Anything you could not complete is listed under unfinished work — plainly and without excuses.
- FINISH with three sections: (1) Findings so far, with citations/references per claim; (2) Unfinished work — every step not actually completed, why, and what is needed to finish it; (3) Verification — what was actually checked (real executions, real job states), not what was assumed.
`
