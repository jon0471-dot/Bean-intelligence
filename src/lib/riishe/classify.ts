/**
 * BEAN Intelligence — RIISHE task classification (pure, deterministic).
 *
 * Classifies a user turn into a task profile that selects prompt strategy,
 * thinking mode and verification depth. This is capability-aware routing on
 * the BEAN side: the classification is validated against the selected
 * backend's declared capabilities before use — a backend that does not
 * declare a capability is not silently used for it.
 */

export type RiisheTask =
  | 'general' // ordinary conversation/explanations
  | 'math' // calculations, derivations, proofs
  | 'coding' // code explanation/writing/debugging
  | 'research' // freshness-sensitive factual questions
  | 'document' // long user-provided text to analyze

export interface TaskProfile {
  task: RiisheTask
  /** Enable the gateway's thinking mode for higher reasoning effort. */
  thinkingEnabled: boolean
  /** Run deterministic arithmetic verification on SELF_CHECK output. */
  verifyMath: boolean
  /** Require citation markers when evidence is attached. */
  requireCitations: boolean
}

const MATH_PATTERNS: RegExp[] = [
  /\b(calculate|compute|evaluate|solve|simplify|factor|derivative|integral|limit|sum|product|probability|permutation|combination)\b/i,
  /\b(equation|inequality|matrix|vector|logarithm|exponent|modulo|prime|divisor|gcd|lcm|factorial)\b/i,
  /\b(prove|proof|theorem|lemma|induction|contradiction)\b/i,
  /\bhow\s+(many|much)\b.*\d|\d\s*[+\-*/^×÷]\s*\d/,
]

const CODE_PATTERNS: RegExp[] = [
  /\b(code|function|class|method|api|bug|error|exception|stack\s*trace|compile|lint|refactor|debug|test|unit\s*test)\b/i,
  /\b(python|javascript|typescript|java\b|c\+\+|c#|go\b|rust|sql|html|css|react|node|next\.?js)\b/i,
  /```/,
]

const RESEARCH_HINTS: RegExp[] = [
  /\b(who|what|when|where|which)\b/i,
  /\b(is|are|was|were|did|has|have|will)\b/i,
]

const DOC_HINTS: RegExp[] = [
  /\b(document|article|paper|transcript|report|contract|chapter|page\s*\d|paragraph|the\s+following\s+text|attached)\b/i,
]

const FRESHNESS_PATTERNS: RegExp[] = [
  /\b(latest|newest|current|most\s+recent)\s+(version|release|update|build|lts|stable)\b/i,
  /\b(version|release)\s+of\b.*\b(latest|current|now|today)\b/i,
  /\b(what|which)\s+version\b/i,
]

export function classifyTask(message: string): TaskProfile {
  const text = message.trim()

  // Freshness-sensitive questions about software are research, not coding:
  // model knowledge of versions/docs goes stale fastest.
  if (FRESHNESS_PATTERNS.some((re) => re.test(text))) {
    return { task: 'research', thinkingEnabled: false, verifyMath: false, requireCitations: true }
  }
  if (CODE_PATTERNS.some((re) => re.test(text))) {
    return { task: 'coding', thinkingEnabled: true, verifyMath: false, requireCitations: false }
  }
  if (MATH_PATTERNS.some((re) => re.test(text))) {
    return { task: 'math', thinkingEnabled: true, verifyMath: true, requireCitations: false }
  }
  if (DOC_HINTS.some((re) => re.test(text)) && text.length > 1500) {
    return { task: 'document', thinkingEnabled: true, verifyMath: false, requireCitations: false }
  }
  // research-leaning wh-questions: search policy decides; thinking stays off
  // for latency unless the question is long/complex.
  if (RESEARCH_HINTS.some((re) => re.test(text)) && text.length > 24) {
    return { task: 'research', thinkingEnabled: false, verifyMath: false, requireCitations: true }
  }
  return { task: 'general', thinkingEnabled: false, verifyMath: false, requireCitations: false }
}

/**
 * Capability validation against the backend descriptor (honest routing):
 * the hosted chat backend declares the capabilities it actually provides.
 * A task it cannot serve raises CAPABILITY_UNSUPPORTED instead of a silent
 * substitution.
 */
export const CHAT_BACKEND_CAPABILITIES = [
  'general',
  'math',
  'coding',
  'research',
  'document',
] as const

export type ChatCapability = (typeof CHAT_BACKEND_CAPABILITIES)[number]

export function assertCapability(backendCapabilities: readonly string[], task: RiisheTask): void {
  if (!backendCapabilities.includes(task)) {
    throw new Error(`CAPABILITY_UNSUPPORTED:${task}`)
  }
}
