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

/**
 * Titles whose HOLDER CHANGES over time. Asking who holds such an office is
 * freshness-sensitive even when the user does not say "current": measured
 * failure (worklog) — "who is the cm of tamilnadu" skipped retrieval entirely
 * and the model answered from stale memory with zero sources.
 */
const OFFICE_TITLES = [
  'president', 'vice\\s+president', 'prime\\s*minister', 'chief\\s+minister',
  'home\\s+minister', 'finance\\s+minister', 'defence\\s+minister', 'external\\s+affairs\\s+minister',
  'education\\s+minister', 'chief\\s+justice', 'attorney\\s+general', 'governor',
  'cm', 'mla', 'mlc', 'mp', 'mayor', 'chancellor', 'pope',
  'ceo', 'cto', 'cfo', 'coo', 'chairman', 'chairperson', 'chair',
  'secretary[- ]general', 'secretary', 'treasurer', 'speaker', 'senator',
  'congressman', 'congresswoman', 'ambassador', 'monarch', 'king', 'queen', 'emperor',
]
const OFFICE_TITLES_RE = OFFICE_TITLES.join('|')
// Jurisdiction form without "cm": "18 cm of rope" is a length, not an
// officeholder (measured false-positive class). "cm of <jurisdiction>" gets a
// dedicated pattern guarded by a digit lookbehind.
const OFFICE_TITLES_JUR = OFFICE_TITLES.filter((t) => t !== 'cm').join('|')

/** Patterns that strongly signal a freshness-sensitive factual question. */
const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  // "who is the <office>" — officeholder questions are time-sensitive even
  // without the word "current" (titles change hands; model memory goes stale).
  [new RegExp(`\\b(?:who|whom)\\s+(?:is|are|was|were)\\s+(?:the\\s+|our\\s+|\\w+'s\\s+)?(?:current|present|incumbent)?\\s*(?:${OFFICE_TITLES_RE})\\b`, 'i'), 'asks who holds an office (officeholders change)'],
  // "current/present/incumbent <office>" and "<office> of <jurisdiction>".
  [new RegExp(`\\b(?:current|present|incumbent)\\s+(?:${OFFICE_TITLES_RE})\\b`, 'i'), 'asks about a current officeholder'],
  [new RegExp(`\\b(?:${OFFICE_TITLES_JUR})\\b\\s+(?:of|for|in)\\s+\\p{L}`, 'u'), 'references the holder of an office/jurisdiction'],
  [new RegExp(`(?<!\\d\\s)(?<!\\d\\.)\\bcm\\b\\s+(?:of|for|in)\\s+\\p{L}`, 'u'), 'references the Chief Minister of a jurisdiction'],
  [/\b(today|yesterday|tonight|this\s+(week|month|year)|right\s+now|as\s+of\s+(now|today)|latest|newest|breaking|current|currently|recent|recently|ongoing|newly)\b/i, 'asks about recent/current developments'],
  [/\b(current|latest|newest|most\s+recent)\s+(version|release|update|price|rate|standings|score|schedule)\b/i, 'asks for the latest version/price/status'],
  [/\b(202[5-9]|203[0-9])\b/, 'references the current or a future year'],
  [/\b(share\s*price|stock\s*price|exchange\s*rate|market\s*cap|inflation\s*rate|interest\s*rate|gas\s*price)\b/i, 'asks for market/price data'],
  // Weather/forecast conditions change by the hour — model memory is always
  // stale for them (measured gap: "What is the weather in Chennai?" did not
  // match any freshness signal and never searched).
  [/\b(weather|temperature|forecast|raining|rainfall|snowfall|heat\s*wave|air\s*quality)\b/i, 'asks about weather/conditions that change daily'],
  [/\b(who\s+won|what\s+(is|are)\s+the\s+standings|schedule|fixture|results?\s+(of|from|for))\b/i, 'asks about sports results/schedules'],
  [/\b(is|are|was|were|did|has|have)\b.*\b(still|currently|now|yet)\b/i, 'asks whether a state still holds (time-sensitive)'],
  // News-type events: breaking reports, missing-person cases, disasters,
  // elections and legal developments are inherently fresh (measured failure:
  // "Research a current topic: Gingee girl missing" never searched).
  [/\b(news|headline|announce[dm]?|declared|appointed|elected|resigned|lawsuit|verdict|missing|kidnapp\w*|abduct\w*|arrest(ed|s|ing)?|shooting|stabbed|earthquake|cyclone|hurricane|typhoon|flood\w*|wildfire|landslide|death\s+toll|evacuat\w*|election)\b/i, 'references recent events or announcements'],
  // Multilingual freshness signals (Phase 3): the same recency intent in the
  // languages the platform serves. Additive — English tables above still win
  // when they match first, and exclusions below still apply afterwards.
  [/\b(最新|当前|如今|今天|新闻|汇率|股价)\b|最新.{0,6}(版本|价格)/, 'multilingual recency signal (CJK)'],
  [/(?:最新|ニュース|現在)/, 'multilingual recency signal (CJK/JP)'],
  [/\b(última\w*|actual\w*|noticias|hoy|precio\s+actual)\b/i, 'multilingual recency signal (ES)'],
  [/\b(derni[eè]re\w*|actualit\w*|aujourd\'hui|version\s+actuelle)\b/i, 'multilingual recency signal (FR)'],
  [/\b(neuest\w*|aktuell\w*|heute|Nachrichten)\b/i, 'multilingual recency signal (DE)'],
  [/\b(mais\s+recente\w*|atual\w*|not[ií]cias|hoje)\b/i, 'multilingual recency signal (PT)'],
  [/\b(последн\w+|новости|сегодня|актуальн\w+)\b/i, 'multilingual recency signal (RU)'],
  [/(أحدث|اليوم|أخبار)/, 'multilingual recency signal (AR)'],
  [/(नवीनतम|ताज़ा|समाचार|आज\s+के)/, 'multilingual recency signal (HI)'],
]

/** Moderate risk: laws, regulations, docs, APIs — stable-ish but do change. */
const MODERATE_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(law|regulation|statute|policy|compliance|visa|requirement|eligibility)\b/i, 'legal/regulatory information may have changed'],
  [/\b(documentation|docs|api|sdk|library|framework|npm|pypi)\b/i, 'software documentation may be newer than model knowledge'],
  [/\b(deprecated|end[- ]of[- ]life|eol|lts)\b/i, 'software lifecycle status changes over time'],
]

/** Explicit user request to look things up. */
const EXPLICIT_SEARCH: Array<[RegExp, string]> = [
  // "research" could never match \bsearch\b (word boundary sits inside the
  // word) — measured failure: "Research a current topic: ..." was skipped.
  [/\b(research|search|google|look\s*up|browse|find\s+online|check\s+online|latest\s+news\s+(about|on)|verify\s+online)\b/i, 'user explicitly requested a lookup'],
]

/** Exclusions: tasks where searching adds cost, not accuracy. */
const EXCLUSION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(calculate|compute|solve|evaluate|simplify|derivative|integral|equation|prove|proof|theorem)\b/i, 'mathematical task — deterministic verification applies, not search'],
  [/\b(write|compose|draft|brainstorm|summarize\s+this|translate|rewrite|paraphrase|roleplay|story|poem)\b/i, 'creative/transformational task on user-provided content'],
  [/^\s*(hi|hello|hey|thanks|thank you|good\s*(morning|evening|afternoon))\b/i, 'greeting/small talk'],
  [/\b(code|function|bug|error|stack\s*trace|compile|refactor|debug|python|javascript|typescript)\b/i, 'coding task — answered from expertise and conversation context'],
]

/**
 * A greeting only excludes retrieval when the message really IS small talk.
 * "hi, who is the cm of tamilnadu" carries a real question after the greeting
 * (measured failure class) — the remainder must be short filler ("there",
 * "everyone", "!") for the exclusion to apply.
 */
const GREETING_RE = /^\s*(hi|hello|hey|thanks|thank you|good\s*(morning|evening|afternoon))\b[\s!,.?]*(.*)$/i

function greetingExclusion(text: string): string | null {
  const m = text.match(GREETING_RE)
  if (!m) return null
  const remainder = (m[3] ?? '').trim()
  if (remainder.length <= 12) return 'greeting/small talk'
  return null
}

export function shouldSearch(message: string): SearchDecision {
  const text = message.trim()
  if (text.length === 0) return { search: false, risk: 'none', reason: 'empty message' }

  // Freshness signals are evaluated BEFORE the coding/technical exclusion:
  // "latest version of <library>" mentions code topics but requires live data
  // (model knowledge of versions goes stale fastest).
  const highRisk = HIGH_RISK_PATTERNS.find(([re]) => re.test(text))
  const explicit = EXPLICIT_SEARCH.find(([re]) => re.test(text))
  const moderate = MODERATE_RISK_PATTERNS.find(([re]) => re.test(text))

  for (const [re, reason] of EXCLUSION_PATTERNS) {
    if (!re.test(text)) continue
    // math/creative exclusions are absolute
    if (reason.startsWith('mathematical') || reason.startsWith('creative')) {
      return { search: false, risk: 'none', reason }
    }
    // greeting: only pure small talk is excluded
    if (reason.startsWith('greeting')) {
      const g = greetingExclusion(text)
      if (g) return { search: false, risk: 'none', reason: g }
      continue
    }
    // coding exclusion yields to freshness-sensitive signals
    if (!highRisk && !explicit) return { search: false, risk: 'none', reason }
  }
  // HIGH freshness signals dominate the explicit-moderate classification so
  // "Research a current topic: <news>" gets the short high-risk cache TTL and
  // the wide recency window (news beats lookup phrasing).
  if (highRisk) return { search: true, risk: 'high', recencyDays: 180, reason: highRisk[1] }
  if (explicit) return { search: true, risk: 'moderate', recencyDays: 90, reason: explicit[1] }
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

/**
 * The news-event signal from the high-risk table above, as a standalone
 * classifier: the orchestrator uses it to switch the solver into the
 * structured research-answer protocol (timeline + latest verified update)
 * for ongoing news, while officeholder/version lookups keep natural prose.
 */
export function isNewsEventQuery(message: string): boolean {
  return /\b(news|headline|announce[dm]?|declared|appointed|elected|resigned|lawsuit|verdict|missing|kidnapp\w*|abduct\w*|arrest(ed|s|ing)?|shooting|stabbed|earthquake|cyclone|hurricane|typhoon|flood\w*|wildfire|landslide|death\s+toll|evacuat\w*|election)\b/i.test(
    message,
  )
}

/**
 * Ongoing-case signal: investigations and emergencies whose status can
 * change day-to-day (measured: the Gingee missing-girl case). A research
 * answer for such a case must hunt for newer reporting before it summarizes
 * the status, even when the newest retrieved source is only days old.
 */
export function isOngoingCaseQuery(message: string): boolean {
  return /\b(missing|kidnap\w*|abduct\w*|untraced|traced|found dead|body (of|recovered)|murder\w*|manslaughter|hit[- ]and[- ]run|road accident|crash|stabb\w*|shooting|search (continues|operation)|rescue (operation|team)| rubble|collapse\w*)\b/i.test(
    message,
  )
}
