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
 * Private trace discipline: the verifier's reasoning is internal. Only the
 * issue COUNT and honest verification STATUS ever reach the user-facing
 * stream — never the raw verifier output, never its chain of thought.
 */

export const VERIFIER_SYSTEM_PROMPT = `You are the independent answer verifier for a coding assistant. You receive:
1. The USER'S ORIGINAL REQUEST
2. A DRAFT ANSWER produced by another model

Your job is to rigorously VERIFY the draft against the request. Do not accept it on faith. Check every one of these dimensions:
- requirement coverage: EVERY explicit requirement in the request is addressed (behaviors, complexity targets, edge cases, output format, exact names, file contents)
- factual consistency: no claims that contradict each other or the code shown
- logical reasoning: the reasoning steps actually lead to the stated conclusion
- calculations and derivations: recompute every number, index, and stated output; wrong derived values are CRITICAL issues
- code correctness: syntax validity, matched braces/fences, the code implements what the prose claims, algorithm matches the stated complexity
- execution order: for event-loop / async questions, the claimed output order must follow from simulating the code statement by statement
- missing requirements: anything the request asked for that the draft silently dropped

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
 */
export function buildVerifierUserTurn(originalRequest: string, draftAnswer: string, maxInputChars: number): string {
  const budgetPerPart = Math.max(1_000, Math.floor(maxInputChars / 2))
  const req = originalRequest.length > budgetPerPart
    ? `${originalRequest.slice(0, budgetPerPart)}\n…(request truncated for verification)`
    : originalRequest
  const draft = draftAnswer.length > budgetPerPart
    ? `${draftAnswer.slice(0, budgetPerPart)}\n…(draft truncated for verification)`
    : draftAnswer
  return `USER'S ORIGINAL REQUEST:\n${req}\n\nDRAFT ANSWER TO VERIFY:\n${draft}\n\nVerify the draft against the request now. Respond with ONLY the JSON object.`
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
