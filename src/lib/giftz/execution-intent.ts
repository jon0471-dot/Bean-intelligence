/**
 * BEAN Intelligence — CODE GIFTZ explicit execution-intent detection (M33).
 *
 * Deterministic recognition of CLEAR execution requests. When the user's
 * message explicitly asks to run/execute/test code in the sandbox, that
 * instruction IS the execution approval (the chat turn then actually runs
 * the generated project files through the existing restricted sandbox and
 * reports the real result). Ordinary write/explain/review requests never
 * execute anything — generation and persistence only, exactly as before.
 *
 * Deliberately conservative:
 *  - a bare "write a JavaScript function" does NOT execute;
 *  - questions ABOUT running ("how do I run this locally?") do NOT execute —
 *    they are answers, not commands;
 *  - only unambiguous imperative run/execute/test-in-sandbox phrasings match.
 *
 * PURE module — regex + string shaping only. No DB, no I/O.
 */

export interface ExecutionIntent {
  /** True only for an unambiguous explicit execution request. */
  execute: boolean
  /** Which rule matched (for logs/tests; stable identifiers, not raw text). */
  rule: string | null
}

/**
 * Questions and looks-like-a-question phrasings that must never count as
 * execution commands even when they mention running. Checked on the
 * normalized (trimmed, lower-cased) message.
 */
const NON_COMMAND_PREFIXES: ReadonlyArray<RegExp> = [
  /^how\s+(do|can|to)\b/,
  /^what\s+(does|is|will)\b/,
  /^why\s+(does|is|do)\b/,
  /^can\s+you\s+(explain|show|tell|describe)\b/,
  /^(please\s+)?explain\b/,
  /^(please\s+)?(review|describe|walk me through)\b/,
  /^is\s+there\b/,
  /^where\s+(can|do)\b/,
]

/**
 * Imperative execution phrasings. Every pattern is anchored to explicit
 * run/execute/test verbs plus direct objects — broad enough for the
 * documented product examples, tight enough that ordinary writing requests
 * never match.
 */
const EXECUTION_PATTERNS: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: 'run-this-code', re: /\brun\s+(this|the|that|my)\s+(code|program|script|file|snippet|function)\b/ },
  { rule: 'run-it', re: /\brun\s+it\b/ },
  { rule: 'run-in-sandbox', re: /\brun\b[^.?!]{0,40}\bin\s+(the\s+)?sandbox\b/ },
  { rule: 'in-sandbox', re: /\bin\s+(the\s+)?sandbox\b[^.?!]{0,30}\b(run|execute|test)\b/ },
  { rule: 'execute-this', re: /\bexecute\s+(this|the|that|it|my)\b/ },
  { rule: 'write-and-run', re: /\bwrite\b[^.?!]{0,120}\band\b[^.?!]{0,40}\b(run|execute)\s+(it|this|them|the)\b/ },
  { rule: 'generate-and-run', re: /\b(generate|create|build|make)\b[^.?!]{0,120}\band\b[^.?!]{0,40}\b(run|execute)\s+(it|this|them|the)\b/ },
  { rule: 'test-in-sandbox', re: /\btest\s+(this|it|the)\b[^.?!]{0,60}\bin\s+(the\s+)?sandbox\b/ },
  { rule: 'debug-and-run', re: /\bdebug\b[^.?!]{0,60}\band\b[^.?!]{0,30}\brun\b/ },
  { rule: 'run-again', re: /\b(run|execute)\s+(it|this|them|again)\b[^.?!]{0,20}\b(again|once more)\b/ },
  { rule: 'sandbox-mention-imperative', re: /^(?:please\s+)?(?:now\s+)?(?:then\s+)?(run|execute|test)\b[^.?!]{0,60}\b(sandbox|workspace)\b/ },
]

/**
 * Detect an explicit execution request. Conservative by contract: when in
 * doubt the answer is NO (the user always keeps the manual Run button).
 */
export function detectExecutionIntent(raw: string): ExecutionIntent {
  const text = raw.trim().toLowerCase()
  if (text.length === 0 || text.length > 600) return { execute: false, rule: null }
  for (const guard of NON_COMMAND_PREFIXES) {
    if (guard.test(text)) return { execute: false, rule: null }
  }
  for (const { rule, re } of EXECUTION_PATTERNS) {
    if (re.test(text)) return { execute: true, rule }
  }
  return { execute: false, rule: null }
}
