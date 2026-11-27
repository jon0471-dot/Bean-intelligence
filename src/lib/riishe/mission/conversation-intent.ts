/**
 * BEAN Intelligence — M45 Phase 1: conversational intent classification
 * (pure, deterministic).
 *
 * RIISHE must distinguish what the user is actually asking for before any
 * governed-execution tool may act. The classifier feeds BOTH capability
 * planning (does the execution-governance tool universe open this turn?) and
 * the server-side operation guard (an advice-shaped turn must never be able
 * to trigger execution, no matter what the model puts in the tool input —
 * the guard reads THIS classification, which is derived from the real user
 * message server-side, never from model-supplied tool fields).
 *
 * Honest defaults: an unclassifiable turn is 'unknown' — operations that
 * consume state (request approval, execute) refuse on 'unknown' rather than
 * guessing. Advice/plan/authorize/execute/result are mutually exclusive by
 * construction (first matching family wins, in the priority order below,
 * which puts the most consequential intents LAST so a question about
 * execution is never misread as an execution order).
 *
 * PURE module — no I/O. SERVER-ONLY consumers.
 */

export type TurnIntent =
  | 'advice' // "what should I do?" — never executes anything
  | 'plan' // "give me an execution plan" — produces a proposal, no execution
  | 'authorize' // "I approve X" — only valid THROUGH the authorization contract
  | 'execute' // "execute the approved plan" — the only execution trigger
  | 'result' // "what was the result / what happened?"
  | 'unknown'

// -- Advice: the user asks WHAT should be done. Highest priority: a question
//    opener keeps the turn advisory even when it mentions execution nouns.
const ADVICE_RE =
  /^\s*(what\s+(should|would|could|can|is|are|do)|how\s+(should|do|can|does|would)|should\s+(we|i|the)|which\s+(option|approach|one|way|strategy)|do\s+you\s+(recommend|suggest|think)|any\s+(recommendations?|suggestions?|advice|thoughts)|recommendations?|suggest|advice|opinion|thoughts)\b/i
const ADVICE_BODY_RE =
  /\b(what\s+do\s+you\s+(recommend|suggest)|which\s+(should|would)|should\s+we|can\s+you\s+(recommend|advise|suggest)|worth\s+doing|is\s+it\s+(a\s+)?good\s+idea|risk(s|y)?\s+of|is\s+(appropriate|best|better|suitable|recommended|right|preferred)|what\s+(deployment|release|rollout|migration|backup|security|branching|versioning)\s+(strategy|plan|approach|policy|options?))\b/i

// -- Result: the user asks about an EARLIER action's outcome.
const RESULT_RE =
  /\b(what\s+(was|were|happened|did)|did\s+(it|the)(\s+\w+){0,3}?\s+(run|execute|work|succeed|complete|finish|deploy)\b|(check|show|tell)\s+(me\s+)?(the\s+)?(result|status|outcome)|result\s+of|status\s+of|did\s+my\s+(action|plan|operation)|is\s+it\s+done|finished\s+yet|why\s+(was\s+it|did\s+it)\s+(blocked|rejected|failed))\b/i

// -- Authorize: the user grants approval. A conversational approval is NEVER
//    itself the authorization — it only marks the intent; the grant must
//    still pass the existing authorization contract (owner decision on the
//    digest-bound Trust approval row). Deliberately FIRST-PERSON shapes only:
//    a bare mention of "approved" inside an execution order must never
//    reclassify an execution request as authorization.
const AUTHORIZE_RE =
  /\b(i\s+(approve|confirm|authorize|allow|accept|give\s+(you\s+)?(my\s+)?(permission|approval))|you\s+have\s+(my\s+)?(permission|approval)|that('s|\s+is)\s+approved|it\s+is\s+approved|grant(s|ed)?\s+(the\s+)?(approval|permission)|yes,?\s*(do|execute|run|proceed)\s*it|go\s+ahead|pleased?\s+proceed)\b/i

// -- Execute: the user orders execution of an ALREADY approved action.
const EXECUTE_RE =
  /\b(execute|run|perform|carry\s+out|do\s+it|start\s+(the|that|this)\s+(plan|action|operation))\b[^.?!;]{0,60}\b(now|already[- ]approved|approved\s+plan|the\s+plan|that\s+action|this\s+action|approved)\b/i
const EXECUTE_EXPLICIT_RE = /^\s*(execute|run)\s+(the\s+)?(approved\s+)?(plan|action|operation)\b/i

// -- Plan: the user asks FOR an execution plan / proposal (not advice about
//    options in general — a concrete plan for a stated objective).
const PLAN_RE =
  /\b(give\s+me\s+an?\s+(execution\s+)?plan|(execution|action)\s+plan|plan\s+(the|this|an?)\s+(execution|implementation|rollout|migration|release)|draft\s+(a|an|the)\s+(plan|proposal)|propose\s+(a|an|the)\s+(plan|approach|action)|steps\s+to\s+(implement|execute|roll\s*out)|create\s+a\s+(structured\s+)?(plan|proposal))\b/i

/**
 * Classify one user message. Priority: advice → result → authorize →
 * execute → plan. Authorize outranks execute because "approved, go ahead"
 * is an authorization statement; a bare "execute the plan" stays execute.
 */
export function classifyTurnIntent(message: string): TurnIntent {
  const text = (message ?? '').trim()
  if (!text) return 'unknown'
  if (ADVICE_RE.test(text) && !EXECUTE_EXPLICIT_RE.test(text)) return 'advice'
  if (ADVICE_BODY_RE.test(text)) return 'advice'
  if (RESULT_RE.test(text)) return 'result'
  if (AUTHORIZE_RE.test(text)) return 'authorize'
  if (EXECUTE_EXPLICIT_RE.test(text) || EXECUTE_RE.test(text)) return 'execute'
  if (PLAN_RE.test(text)) return 'plan'
  return 'unknown'
}

/**
 * Whether the execution-governance tool universe may open for this turn
 * (capability-plan key 2). Deliberately narrower than "mentions the topic":
 * decision/plan/approval/execution/result vocabulary with an action shape.
 * A mention inside a pure explanation request ("how does the approval flow
 * work") still opens the universe — the tools are honest-refusing by design;
 * what it NEVER does is grant anything (grants live in the authorization
 * contract, not in tool availability).
 */
const GOVERNANCE_RE =
  /\b(decide|decision|which\s+option|trade[-\s]?offs?|execution\s+plan|action\s+plan|propose|authorize|approval|approve|execute|action\s+status|action\s+result|verified\s+result|blocked|rejected|roll\s?out|migration|deploy|deployed|deployment|inspect|inspection|investigate|revision|current\s+revision|repository|repo\s+status|branch)\b/i
const GOVERNANCE_QUESTION_BLOCK_RE =
  /^\s*(how\s+(does|do|did)\s+(the\s+)?(approval|authorization|two[-\s]key|permission)|explain\s+(the\s+)?(approval|authorization|two[-\s]key)|what\s+is\s+(the\s+)?(two[-\s]key|approval\s+flow))\b/i

export function executionGovernanceRequested(message: string, hasDocuments: boolean): boolean {
  const text = (message ?? '').trim()
  if (!text || text.length < 8) return false
  if (hasDocuments) return false // document-Q&A turns never open execution tools
  return GOVERNANCE_RE.test(text) && !GOVERNANCE_QUESTION_BLOCK_RE.test(text)
}

/**
 * The operations a given intent may drive. The tool guard reads this table:
 * advice/unknown turns cannot request approval or execution; result turns
 * can only inspect; authorize turns can request approval creation (the
 * grant itself still flows through the owner-only authorization contract).
 */
export const INTENT_ALLOWED_OPERATIONS: Record<TurnIntent, readonly string[]> = {
  advice: ['create_decision', 'inspect_decision'],
  plan: ['create_decision', 'inspect_decision', 'propose_plan'],
  authorize: ['inspect_decision', 'request_approval', 'action_status'],
  execute: ['inspect_decision', 'action_status', 'execute_plan'],
  result: ['inspect_decision', 'action_status', 'action_result', 'explain_outcome'],
  unknown: ['inspect_decision', 'action_status'],
}

/** Test/ops seam: the intent vocabulary in classification priority order. */
export const TURN_INTENT_ORDER: readonly TurnIntent[] = ['advice', 'result', 'authorize', 'execute', 'plan', 'unknown']
