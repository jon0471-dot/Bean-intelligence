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

/** A single named routing signal that fired for this classification. */
export interface RoutingSignal {
  /** Which pattern family fired (freshness, code, math, document, wh). */
  family: string
  /** The matched fragment, clipped for safe logging/display. */
  match: string
}

const MATH_PATTERNS: RegExp[] = [
  /\b(calculate|compute|evaluate|solve|simplify|factor|derivative|integral|limit|sum|product|probability|permutation|combination)\b/i,
  /\b(equation|inequality|matrix|vector|logarithm|exponent|modulo|prime|divisor|gcd|lcm|factorial)\b/i,
  /\b(prove|proof|theorem|lemma|induction|contradiction)\b/i,
  /\bhow\s+(many|much)\b.*\d|\d\s*[+\-*/^×÷]\s*\d/,
  // Measured eval gap (extended.json reason-101): percentage word problems
  // carry no operator token ("a 15% discount on $80 and $120"), so the
  // router sent them to 'general' and the arithmetic went unverified.
  /\b\d+(\.\d+)?\s*%\s*(discount|off|of|tax|increase|decrease)\b|\b(discount|discounted)\s+(of\s+)?\d+(\.\d+)?\s*%\b/i,
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

/**
 * RESPONSE MODES (OPERATIONAL-TRANSFORMATION, Phase 3): the composer stays
 * toggle-free (backend-controlled routing), but the server now RECOGNIZES
 * which of the five advertised response modes a turn belongs to and shapes
 * the answer protocol accordingly:
 *   normal-chat | web-search | deep-research | document-analysis | writing
 * These detectors are pure and deterministic — mode selection is recorded
 * in message metadata (router.mode) so routing is observable, never assumed.
 */

/** Deep-research request signals (multi-source investigation, not a lookup). */
const DEEP_RESEARCH_PATTERNS: RegExp[] = [
  /\b(in\s+depth|in[-\s]depth|deep\s+research|deep\s+dive|comprehensive|exhaustive|thorough)\b/i,
  /\b(research\s+report|detailed\s+report|full\s+report|write\s+(me\s+)?a\s+report|background\s+report)\b/i,
  /\b(compare|comparison|contrast)\b[^\n]{0,80}\b(across|between|among|versus|vs\.?)\b/i,
  /\b(pros\s+and\s+cons|trade[-\s]?offs?|strengths\s+and\s+weaknesses)\b/i,
  /\b(market\s+analysis|industry\s+analysis|competitive\s+landscape|state\s+of\s+the)\b/i,
  /\b(with\s+citations?|with\s+sources?|sourced|cited\s+sources)\b/i,
]

/**
 * Writing-mode signals: the user asks for a PIECE OF WRITING to be produced
 * (not a factual answer). Detection is deliberately conservative — real
 * ambiguity falls through to chat/search rather than hijacking the turn.
 */
const WRITING_PATTERNS: RegExp[] = [
  /\b(write|draft|compose|redraft)\b[^\n]{0,60}\b(an?|the)\b[^\n]{0,40}\b(email|letter|essay|article|blog\s*post|post|caption|bio|speech|story|poem|script|summary|review|outline|proposal|memo|announcement|invitation|itinerary|plan)\b/i,
  /\b(essay|cover\s+letter|blog\s*post|guest\s+post|product\s+description|social\s+media\s+caption|wedding\s+speech|toast)\b[^\n]{0,40}\b(about|on|for)\b/i,
  /\b(rewrite|rephrase|reword|polish|proofread|shorten|expand)\b[^\n]{0,80}\b(this|the following|it)\b/i,
  /\b(help\s+me\s+write|can\s+you\s+write|write\s+this|write\s+one)\b/i,
]

export function isDeepResearchQuery(message: string): boolean {
  return DEEP_RESEARCH_PATTERNS.some((re) => re.test(message))
}

export function isWritingTask(message: string): boolean {
  return WRITING_PATTERNS.some((re) => re.test(message))
}

const FRESHNESS_PATTERNS: RegExp[] = [
  /\b(latest|newest|current|most\s+recent)\s+(version|release|update|build|lts|stable)\b/i,
  /\b(version|release)\s+of\b.*\b(latest|current|now|today)\b/i,
  /\b(what|which)\s+version\b/i,
]

export function classifyTask(message: string): TaskProfile {
  const { task, thinkingEnabled, verifyMath, requireCitations } = classifyTaskDetailed(message)
  return { task, thinkingEnabled, verifyMath, requireCitations }
}

/**
 * Confidence-bearing routing (Phase 2): same decision order and outcomes as
 * classifyTask, but ALSO reports HOW STRONG the evidence for the decision
 * was and which signals fired. Callers use confidence to observe routing
 * quality (metadata/logs) — never to invent capabilities: a low-confidence
 * turn still routes to its decided task, with the default 'general' acting
 * as the safe fallback. Confidence bands:
 *   >= 0.85  explicit, unambiguous signal (freshness pattern, multi-signal)
 *   >= 0.70  one strong signal (code/math/doc match)
 *   >= 0.55  weak signal (bare wh-question)
 *    0.70    deliberate default (general conversation is the safe route)
 */
export function classifyTaskDetailed(
  message: string,
): TaskProfile & { confidence: number; signals: RoutingSignal[] } {
  const text = message.trim()
  const signals: RoutingSignal[] = []
  const collect = (family: string, patterns: RegExp[]) => {
    for (const re of patterns) {
      const m = text.match(re)
      if (m) signals.push({ family, match: m[0].slice(0, 40) })
    }
    return signals.filter((s) => s.family === family).length
  }

  // Freshness-sensitive questions about software are research, not coding:
  // model knowledge of versions/docs goes stale fastest.
  if (collect('freshness', FRESHNESS_PATTERNS) > 0) {
    return {
      task: 'research',
      thinkingEnabled: false,
      verifyMath: false,
      requireCitations: true,
      confidence: 0.9,
      signals,
    }
  }
  const codeHits = collect('code', CODE_PATTERNS)
  if (codeHits > 0) {
    return {
      task: 'coding',
      thinkingEnabled: true,
      verifyMath: false,
      requireCitations: false,
      confidence: codeHits >= 2 ? 0.9 : 0.75,
      signals,
    }
  }
  const mathHits = collect('math', MATH_PATTERNS)
  if (mathHits > 0) {
    return {
      task: 'math',
      thinkingEnabled: true,
      verifyMath: true,
      requireCitations: false,
      confidence: mathHits >= 2 ? 0.9 : 0.75,
      signals,
    }
  }
  if (collect('document', DOC_HINTS) > 0 && text.length > 1500) {
    return {
      task: 'document',
      thinkingEnabled: true,
      verifyMath: false,
      requireCitations: false,
      confidence: 0.85,
      signals,
    }
  }
  // research-leaning wh-questions: search policy decides; thinking stays off
  // for latency unless the question is long/complex.
  if (collect('wh', RESEARCH_HINTS) > 0 && text.length > 24) {
    return {
      task: 'research',
      thinkingEnabled: false,
      verifyMath: false,
      requireCitations: true,
      confidence: 0.55,
      signals,
    }
  }
  return {
    task: 'general',
    thinkingEnabled: false,
    verifyMath: false,
    requireCitations: false,
    confidence: 0.7,
    signals,
  }
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
