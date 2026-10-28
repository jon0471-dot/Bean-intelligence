/**
 * BEAN Intelligence — automatic search policy (pure, deterministic,
 * unit-testable).
 *
 * Decides whether a user message requires live web research, based on the
 * query's content and freshness risk — never on whether a model "happens to
 * remember" something.
 *
 * Conservative bias: when a pattern is ambiguous, we prefer to search (an
 * unnecessary search costs a few seconds; a wrong answer costs trust). Pure
 * arithmetic, definitions, creative writing and ordinary explanations are
 * explicitly excluded to keep everyday turns fast.
 */

export type FreshnessRisk = 'none' | 'moderate' | 'high'

export interface SearchDecision {
  search: boolean
  risk: FreshnessRisk
  /** Restrict results to the last N days when freshness matters. */
  recencyDays?: number
  /** Human-readable reason (surfaced in verification summaries and logs). */
  reason: string
}

/** Patterns that strongly signal a freshness-sensitive factual question. */
const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(who|what)\s+is\s+the\s+(current|present|incumbent)\b/i, 'asks about a current officeholder/appointment'],
  [/\b(current|present|incumbent)\s+(president|prime\s*minister|ceo|cto|cfo|chancellor|governor|mayor|pope|secretary|chairman|chair|director)\b/i, 'asks about a current officeholder'],
  [/\b(today|yesterday|this\s+(week|month|year)|right\s+now|as\s+of\s+(now|today)|latest|newest|breaking)\b/i, 'asks about recent/current developments'],
  [/\b(current|latest|newest|most\s+recent)\s+(version|release|update|price|rate|standings|score|schedule)\b/i, 'asks for the latest version/price/status'],
  [/\b(202[5-9]|203[0-9])\b/, 'references the current or a future year'],
  [/\b(share\s*price|stock\s*price|exchange\s*rate|market\s*cap|inflation\s*rate|interest\s*rate|gas\s*price)\b/i, 'asks for market/price data'],
  [/\b(who\s+won|what\s+(is|are)\s+the\s+standings|schedule|fixture|results?\s+(of|from|for))\b/i, 'asks about sports results/schedules'],
  [/\b(is|are|was|were|did|has|have)\b.*\b(still|currently|now|yet)\b/i, 'asks whether a state still holds (time-sensitive)'],
  [/\b(news|announce[dm]?|declared|appointed|elected|resigned|lawsuit|verdict)\b/i, 'references recent events or announcements'],
]

/** Moderate risk: laws, regulations, docs, APIs — stable-ish but do change. */
const MODERATE_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(law|regulation|statute|policy|compliance|visa|requirement|eligibility)\b/i, 'legal/regulatory information may have changed'],
  [/\b(documentation|docs|api|sdk|library|framework|npm|pypi)\b/i, 'software documentation may be newer than model knowledge'],
  [/\b(deprecated|end[- ]of[- ]life|eol|lts)\b/i, 'software lifecycle status changes over time'],
]

/** Explicit user request to look things up. */
const EXPLICIT_SEARCH: Array<[RegExp, string]> = [
  [/\b(search|google|look\s*up|browse|find\s+online|check\s+online|latest\s+news\s+(about|on)|verify\s+online)\b/i, 'user explicitly requested a lookup'],
  // "Research a current topic: X" — "research" must count as an explicit
  // lookup request even though \bsearch\b cannot match inside the word.
  [/\b(research(?:ing)?|fact-?\s*check|find\s+out\s+about|look\s+this\s+up|investigate)\b/i, 'user explicitly requested research'],
]

/**
 * Ongoing incident / case patterns (evaluated BEFORE the generic explicit
 * rule): missing persons, crimes, deaths and disasters demand the newest
 * reporting — days-old coverage is the known failure mode for these topics.
 */
const INCIDENT_PATTERNS: Array<[RegExp, string]> = [
  [/\bmissing\s+(girl|boy|child|children|woman|women|man|men|person|people|student|teen|teenager|toddler|infant|baby|family|couple|hiker|trekker|fisherman|fishermen|worker|tourist|pilgrim|swimmer)\b/i, 'ongoing missing-person case; newest reporting required'],
  [/\b(girl|boy|child|woman|man|person|student|teen|toddler|family|hiker|trekker|fisherman|tourist)\s+(went\s+missing|missing|abducted|kidnapped)\b/i, 'ongoing missing-person case; newest reporting required'],
  [/\b(missing|abduction|kidnapping)\s+(case|incident|report)\b/i, 'ongoing missing-person case; newest reporting required'],
  [/\b(murder|homicide|rape|assault|kidnapping|abduction|trafficking|harassment|molestation)\s+(case|probe|investigation|accused|arrest)\b/i, 'ongoing crime case; newest reporting required'],
  [/\b(fir|chargesheet|charge\s+sheet|arrested|post-?mortem|custodial|autopsy|found\s+dead|death\s+toll)\b/i, 'ongoing incident/case; newest reporting required'],
  [/\b(building\s+collapse|bridge\s+collapse|stampede|boat\s+capsiz\w+|gas\s+leak|derail\w+|plane\s+crash|bus\s+accident)\b/i, 'ongoing accident/disaster; newest reporting required'],
  [/\b(suicide|gang\s+rape|mass\s+shooting|bomb\s+blast)\b/i, 'ongoing violent incident; newest reporting required'],
]

/** Exclusions: tasks where searching adds cost, not accuracy. */
const EXCLUSION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(calculate|compute|solve|evaluate|simplify|derivative|integral|equation|prove|proof|theorem)\b/i, 'mathematical task — deterministic verification applies, not search'],
  [/\b(write|compose|draft|brainstorm|summarize\s+this|translate|rewrite|paraphrase|roleplay|story|poem)\b/i, 'creative/transformational task on user-provided content'],
  [/^\s*(hi|hello|hey|thanks|thank you|good\s*(morning|evening|afternoon))\b/i, 'greeting/small talk'],
  [/\b(code|function|bug|error|stack\s*trace|compile|refactor|debug|python|javascript|typescript)\b/i, 'coding task — answered from expertise and conversation context'],
]

export function shouldSearch(message: string): SearchDecision {
  const text = message.trim()
  if (text.length === 0) return { search: false, risk: 'none', reason: 'empty message' }

  // Freshness signals are evaluated BEFORE the coding/technical exclusion:
  // "latest version of <library>" mentions code topics but requires live data
  // (model knowledge of versions goes stale fastest).
  const highRisk = HIGH_RISK_PATTERNS.find(([re]) => re.test(text))
  const explicit = EXPLICIT_SEARCH.find(([re]) => re.test(text))
  const moderate = MODERATE_RISK_PATTERNS.find(([re]) => re.test(text))
  const incident = INCIDENT_PATTERNS.find(([re]) => re.test(text))

  for (const [re, reason] of EXCLUSION_PATTERNS) {
    if (!re.test(text)) continue
    // math/creative/greeting exclusions are absolute
    if (reason.startsWith('mathematical') || reason.startsWith('creative') || reason.startsWith('greeting')) {
      return { search: false, risk: 'none', reason }
    }
    // coding exclusion yields to freshness-sensitive and incident signals
    if (!highRisk && !explicit && !incident) return { search: false, risk: 'none', reason }
  }
  // Ongoing incidents outrank the generic explicit rule: they need the
  // newest reporting, not just any coverage within the window.
  if (incident) return { search: true, risk: 'high', recencyDays: 180, reason: incident[1] }
  if (explicit) return { search: true, risk: 'moderate', recencyDays: 90, reason: explicit[1] }
  if (highRisk) return { search: true, risk: 'high', recencyDays: 180, reason: highRisk[1] }
  if (moderate) return { search: true, risk: 'moderate', recencyDays: 365, reason: moderate[1] }
  return {
    search: false,
    risk: 'none',
    reason: 'no freshness signals; answerable from stable knowledge',
  }
}

/**
 * Long/simple-input guard: messages that are mostly quoted document text or
 * very long context should not trigger expensive searches on heuristic
 * keywords alone.
 */
export function isDocumentLike(message: string): boolean {
  return message.length > 4000
}
