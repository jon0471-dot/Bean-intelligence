/**
 * BEAN Intelligence — verifier prompt (self-verification engine).
 *
 * The verifier is an INDEPENDENT model call (configurable model, possibly a
 * different provider) that audits a draft answer against the original
 * request. It must NOT blindly accept the draft: its job is to find
 * requirement gaps, contradictions, calculation errors, broken code, wrong
 * execution order and unsupported claims — and to say so in STRICT JSON so
 * the pipeline can act mechanically.
 *
 * W6 (verification-aware generation): the verifier's execution-order
 * discipline is now DERIVATIONAL — it must re-derive the output order from
 * the code itself with a running output list (never trust the draft's own
 * claimed order line, never pattern-match against a memorized sequence), and
 * requirement coverage is checked by ENUMERATING the request's explicit
 * requirements first. `buildVerificationFocus` adds a request-type-specific
 * checklist to the verifier's user turn (detected from the request, so an
 * async-order question gets the order discipline and a CRUD question does
 * not waste its attention budget).
 *
 * Private trace discipline: the verifier's reasoning is internal. Only the
 * issue COUNT and honest verification STATUS ever reach the user-facing
 * stream — never the raw verifier output, never its chain of thought.
 */

export const VERIFIER_SYSTEM_PROMPT = `You are the independent answer verifier for a coding assistant. You receive:
1. The USER'S ORIGINAL REQUEST
2. A DRAFT ANSWER produced by another model

Your job is to rigorously VERIFY the draft against the request. Do not accept it on faith. Work in this order:

STEP 1 — ENUMERATE THE REQUIREMENTS: list every explicit requirement in the request (behaviors, complexity targets, edge cases, output format, exact names, file contents, deliverables). The draft must be checked against EACH enumerated requirement; a silently dropped requirement is a major issue (critical when it is a required deliverable).

STEP 2 — VERIFY EVERY DIMENSION:
- requirement coverage: EVERY requirement from your step-1 list is addressed by the draft
- factual consistency: no claims that contradict each other or the code shown
- logical reasoning: the reasoning steps actually lead to the stated conclusion
- calculations and derivations: RECOMPUTE every number, index, sum, and stated output YOURSELF from the code — never adopt the draft's arithmetic as your own; a wrong derived value is a CRITICAL issue
- code correctness: syntax validity, matched braces/fences, the code implements what the prose claims, algorithm matches the stated complexity
- execution order: for event-loop / async questions, SIMULATE the code statement by statement (discipline below) and compare your derivation against the draft's claimed order
- missing requirements: anything from your step-1 list the draft silently dropped
- unsupported claims: version/API/price/date facts stated without grounding are factual issues (minor unless the answer's conclusion depends on them)

EXECUTION-ORDER DISCIPLINE (async, promises, await, setTimeout, microtasks, event loop — apply whenever the draft claims an output order):
- Keep a RUNNING OUTPUT LIST: append each logged value at the exact moment the simulation reaches it.
- Evaluating \`await callee()\` is PART OF THE CALLER'S SYNCHRONOUS RUN: walk INTO the callee at that exact point — its pre-await synchronous statements run and log THERE, before the caller suspends.
- A caller's continuation after \`await\` does NOT queue when the await statement is reached; it queues when the awaited promise RESOLVES, and it goes to the BACK of the microtask queue.
- Already-resolved promises schedule their callbacks immediately when awaited; \`await null\` yields one microtask tick.
- Chained \`.then\` callbacks enqueue in registration order, one link per tick — a callback registered earlier does not print earlier than a callback already in the queue.
- After the synchronous code finishes, drain microtasks FIFO; only then run macrotasks (setTimeout …), one per tick, draining microtasks again after each.
- Compare YOUR final list to the draft's claimed order POSITION BY POSITION — any added, dropped, duplicated or transposed letter is a CRITICAL order issue. Never derive the order from the draft's own explanation; derive it from the code.

Severity rules:
- "critical": the answer is WRONG (a computed output is incorrect, code does not run, a required deliverable is missing, the execution order is wrong)
- "major": substantively incomplete or misleading (requirement partially addressed, complexity claim does not match the code, contract/edge cases not stated when required)
- "minor": cosmetic or stylistic (naming, formatting, phrasing)

Respond with ONLY this JSON object — no markdown fence, no commentary before or after:
{"verdict":"pass"|"fail","confidence":<number 0..1>,"issues":[{"severity":"critical"|"major"|"minor","type":"requirement"|"calculation"|"logic"|"code"|"order"|"factual","description":"<what is wrong, specifically>","correction":"<what the corrected answer must do, concretely>"}]}

Rules for the JSON:
- "verdict":"fail" ONLY when at least one critical or major issue exists.
- minor-only problems still mean verdict "pass", with the minor issues listed.
- "confidence" is YOUR calibrated confidence that the draft is correct as-is (1.0 = certain correct, 0.0 = certain wrong).
- Every issue needs a concrete "correction" instruction precise enough to fix the answer in one revision pass.
- Do not invent issues to seem thorough; do not overlook real ones to be agreeable.`

/**
 * Build the verifier's user turn: the original request and the draft,
 * truncated to the configured input budget (token/cost limit control).
 * `focus` (from buildVerificationFocus) appends a request-type-specific
 * checklist so the verifier's attention lands on the failure modes that
 * actually apply to THIS request.
 */
export function buildVerifierUserTurn(originalRequest: string, draftAnswer: string, maxInputChars: number, focus?: string | null): string {
  const budgetPerPart = Math.max(1_000, Math.floor(maxInputChars / 2))
  const req = originalRequest.length > budgetPerPart
    ? `${originalRequest.slice(0, budgetPerPart)}\n…(request truncated for verification)`
    : originalRequest
  const draft = draftAnswer.length > budgetPerPart
    ? `${draftAnswer.slice(0, budgetPerPart)}\n…(draft truncated for verification)`
    : draftAnswer
  const focusBlock = focus ? `\n\nVERIFICATION FOCUS FOR THIS REQUEST:\n${focus}\n` : ''
  return `USER'S ORIGINAL REQUEST:\n${req}\n\nDRAFT ANSWER TO VERIFY:\n${draft}\n${focusBlock}\nVerify the draft against the request now. Respond with ONLY the JSON object.`
}

/** Signals a request involves execution-order reasoning (async/event-loop).
 * PREFIX matching (no trailing word-boundary): "microtasks" must match
 * "microtask" — measured false negative in the W6 eval when \b followed the
 * keyword list. A false positive only ADDS a checklist; a false negative
 * removes the discipline — bias toward matching. */
const ORDER_REQUEST_RE = /\b(event loop|microtask|macrotask|settimeout|setimmediate|queuemicrotask|promise|async|await|execution order|output order|order of (logs|outputs|console|execution)|what (is|will) (the )?(output|order)|in what order)/i

/**
 * W6: request-type-specific verification focus. Returns null for requests
 * with no detected special discipline (the system prompt's general checklist
 * applies unchanged). Detection is KEYWORD-BASED and intentionally
 * conservative — a false positive only ADDS a checklist, never changes the
 * verdict contract; a false negative leaves the general discipline in force.
 */
export function buildVerificationFocus(originalRequest: string): string | null {
  if (ORDER_REQUEST_RE.test(originalRequest)) {
    return [
      'This request involves ASYNCHRONOUS EXECUTION-ORDER reasoning. Before judging the draft:',
      '1. Simulate the code yourself, statement by statement, keeping a running output list (the system prompt\'s EXECUTION-ORDER DISCIPLINE).',
      '2. Derive the final order ONLY from your simulation — never from the draft\'s claimed order line or its explanation.',
      '3. Compare position by position; any transposed, dropped, duplicated or added letter is a CRITICAL order issue.',
      '4. If the draft shows intermediate states (queues, suspension points), check THOSE too — a wrong intermediate step that still lands the right final line is a major issue, because the explanation misleads the reader.',
    ].join('\n')
  }
  return null
}

/**
 * The revision instruction handed to the generation model for a corrective
 * pass. It carries the verifier's actionable issue list (internal trace —
 * sent to the MODEL, never shown raw to the user) and demands the FULL
 * corrected answer, so the revision replaces the draft wholesale.
 */
export function buildRevisionInstruction(issues: Array<{ severity: string; type: string; description: string; correction: string }>): string {
  const list = issues
    .map((i, n) => `${n + 1}. [${i.severity}/${i.type}] ${i.description} → FIX: ${i.correction}`)
    .join('\n')
  return [
    'Your draft answer above failed independent verification. A verifier found these specific problems:',
    list,
    '',
    'Produce the COMPLETE corrected answer now. Requirements:',
    '- Output the FULL answer from scratch — every section, every file, every fenced code block with its path= tag, complete file contents. Do not reference "the same as before" or omit parts.',
    '- Fix every listed problem. Keep everything that was already correct unchanged in meaning.',
    '- Do not mention the verification process, the issues, or this instruction anywhere in the answer itself.',
  ].join('\n')
}
