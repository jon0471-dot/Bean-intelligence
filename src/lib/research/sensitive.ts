/**
 * BEAN Intelligence — sensitive ongoing-case handling (pure, deterministic).
 *
 * Research about ongoing incidents (missing persons, crimes, deaths,
 * disasters, investigations) carries a distinct honesty risk: the model may
 * repeat unproven allegations, infer guilt from social-media speculation, or
 * present days-old reporting as the current state of the case.
 *
 * This module provides three deterministic primitives used by the pipeline,
 * the orchestrator and the prompt layer:
 *   - detectSensitiveCase: does this turn concern an ongoing incident/case?
 *   - coreTopic: strip conversational wrappers ("Research a current topic:")
 *     to build follow-up freshness queries.
 *   - scanForUnattributedAllegations: conservative detection of accusatory
 *     statements about identifiable people that carry no citation marker.
 *
 * All checks are heuristic-by-design and CONSERVATIVE: false negatives are
 * caught by the prompt protocol; false positives only ever add an honest
 * degraded note or trigger one bounded rewrite, never a refusal.
 */

export interface SensitiveCase {
  sensitive: boolean
  /** Machine-readable kind, for logging/telemetry. */
  kind: string | null
  /** Human-readable reason (surfaced in degraded notes/logs). */
  reason: string
}

/** Missing-person patterns: a person noun adjacent to "missing"/abduction. */
const MISSING_PATTERNS: Array<[RegExp, string]> = [
  [/\bmissing\s+(girl|boy|child|children|woman|women|man|men|person|people|student|teen|teenager|toddler|infant|baby|family|couple|hiker|trekker|fisherman|fishermen|worker|tourist|pilgrim|swimmer|fisherwoman)\b/i, 'missing person'],
  [/\b(girl|boy|child|children|woman|man|person|student|teen|teenager|toddler|infant|baby|family|couple|hiker|trekker|fisherman|worker|tourist|swimmer)\s+(went\s+missing|missing|abducted|kidnapped|kidnap|untraceable)\b/i, 'missing person'],
  [/\b(missing|abduction|kidnapping)\s+(case|incident|report)\b/i, 'missing-person case'],
  [/\bsearch\s+(operation|underway)\b.*\b(missing|rescue)\b/i, 'search-and-rescue incident'],
  [/\b(missing|abducted|kidnapped)\s+(for|since)\b/i, 'missing person'],
]

/** Crime / death / disaster case patterns. */
const CRIME_PATTERNS: Array<[RegExp, string]> = [
  [/\b(murder|homicide|rape|assault|kidnapping|abduction|trafficking|harassment|molestation|dowry|atrocit\w+)\s+(case|probe|investigation|accused|arrest)\b/i, 'crime case'],
  [/\b(fir|first\s+information\s+report|chargesheet|charge\s+sheet|custodial|postmortem|post-mortem|autopsy)\b/i, 'criminal-justice matter'],
  [/\b(accused|arrested|detained|booked|charged)\b.*\b(police|case|fir)\b|\bpolice\b.*\b(accused|arrested|detained|booked|charged)\b/i, 'police action'],
  [/\b(found\s+dead|dead\s+body|burnt|burned\s+alive|electrocuted|drowned|stabbed|strangl\w+|poisoned)\b/i, 'death incident'],
  [/\b(suicide|self-?immolation)\b/i, 'death incident'],
  [/\b(gang rape|mass shooting|stabbing|bomb\s+blast|explosion)\b/i, 'violent incident'],
  [/\b(robbery|theft|burglary|fraud|scam)\s+case\b/i, 'crime case'],
  [/\b(victim|survivor)s?\s+(of|was|were|identified)\b/i, 'crime/death victim'],
]

/** Disaster / accident patterns (public-safety investigations). */
const DISASTER_PATTERNS: Array<[RegExp, string]> = [
  [/\b(building\s+collapse|bridge\s+collapse|stampede|boat\s+capsiz\w+|mine\s+collapse|gas\s+leak|derail\w+|plane\s+crash|air\s+crash|bus\s+accident|road\s+accident|pile-?up)\b/i, 'accident/disaster'],
  [/\b(flood|landslide|avalanche|wildfire|forest\s+fire|earthquake|cyclone|hurricane|typhoon|tornado)\b.*\b(death|toll|missing|damage|relief|rescue)\b/i, 'natural disaster'],
  [/\b(death\s+toll|casualt\w+)\b/i, 'casualty incident'],
]

function firstMatch(text: string, patterns: Array<[RegExp, string]>): [RegExp, string] | null {
  for (const p of patterns) if (p[0].test(text)) return p
  return null
}

/**
 * Detect whether the turn concerns an ongoing incident/case. Deliberately
 * requires incident-specific phrasing so ordinary messages ("my code is
 * missing a semicolon", "I feel missing my hometown") never match.
 */
export function detectSensitiveCase(message: string): SensitiveCase {
  const text = message.trim()
  if (text.length < 8) return { sensitive: false, kind: null, reason: 'too short' }

  const missing = firstMatch(text, MISSING_PATTERNS)
  if (missing) return { sensitive: true, kind: 'missing_person', reason: missing[1] }
  const crime = firstMatch(text, CRIME_PATTERNS)
  if (crime) return { sensitive: true, kind: 'crime_case', reason: crime[1] }
  const disaster = firstMatch(text, DISASTER_PATTERNS)
  if (disaster) return { sensitive: true, kind: 'disaster', reason: disaster[1] }

  return { sensitive: false, kind: null, reason: 'no incident signals' }
}

/**
 * Strip conversational wrappers to get the core topic for follow-up queries:
 * "Research a current topic: Gingee girl missing" -> "Gingee girl missing".
 * Returns null when nothing meaningful remains.
 */
export function coreTopic(message: string): string | null {
  let t = message.replace(/\s+/g, ' ').trim()
  t = t.replace(
    /^(please\s+)?(can|could|would|will)?\s*(you\s+)?(please\s+)?(research|search(?:\s+for)?|look\s+up|find(?:\s+out)?\s+about|fact-?\s*check|check|investigate)\b/i,
    '',
  )
  t = t.replace(/^\s*(a|an|the)?\s*(current|recent|latest|ongoing|breaking)?\s*(topic|news|story|case|incident|matter|subject|event)s?\b\s*[:\-–—]?\s*/i, '')
  t = t.replace(/^(about|on|regarding|for)\s+/i, '')
  t = t.replace(/[\s.:!\-–—]+$/, '').trim()
  if (t.length < 3 || t.length > 200) return null
  return t
}

/**
 * Predicates that allege guilt or harmful action against identifiable
 * people. Only sentence-level patterns; conservative on purpose.
 */
const ACCUSATION_PREDICATES = new RegExp(
  [
    '\\babduct(?:ed|ion)?\\b',
    '\\bkidnap(?:ped|ping)?\\b',
    '\\bframed\\b',
    '\\bmurder(?:ed)?\\b',
    '\\bkilled\\b',
    '\\braped?\\b',
    '\\bassaulted\\b',
    '\\bmolest(?:ed)?\\b',
    '\\bharass(?:ed)?\\b',
    '\\btraffick(?:ed|ing)?\\b',
    '\\btortur(?:ed)?\\b',
    '\\bstrangl(?:ed|e[dn])\\b',
    '\\bburn(?:ed|t)\\s+(?:her|him|them|alive)\\b',
    '\\bthrew\\s+(?:her|him|them)\\s+(?:off|down|into|from)\\b',
    '\\bguilty\\b',
    '\\bc(?:u)?lprit\\b',
    '\\bcommitted\\s+(?:the\\s+)?(?:murder|crime|rape|theft|fraud)\\b',
    '\\bresponsible\\s+for\\s+(?:the\\s+)?(?:death|murder|abduction|disappearance|crime)\\b',
    '\\bconfessed\\b',
    '\\badmitted\\s+(?:to\\s+)?(?:killing|murdering|abducting)\\b',
  ].join('|'),
  'i',
)

/** Split into sentences (period/!/??/newline boundaries; abbreviation-safe enough for flagging). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export interface AllegationFlag {
  /** The sentence containing a potential unattributed allegation. */
  sentence: string
}

/**
 * Scan an answer for accusatory statements that carry NO citation marker in
 * the same sentence. Only meaningful for sensitive-case turns (the caller
 * gates on detectSensitiveCase) — ordinary answers are never scanned.
 *
 * A sentence passes when it either (a) contains no accusation predicate or
 * (b) has a citation marker [n] right there, or uses explicit attribution
 * language ("according to", "allegedly", "police said", "reported").
 */
export function scanForUnattributedAllegations(answer: string): AllegationFlag[] {
  const flags: AllegationFlag[] = []
  for (const sentence of splitSentences(answer)) {
    if (!ACCUSATION_PREDICATES.test(sentence)) continue
    if (/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/.test(sentence)) continue // cited
    if (/\b(according\s+to|alleged(?:ly)?|reported(?:ly)?|police\s+said|officials\s+said|court\s+(?:was\s+)?told|charged\s+with|accused\s+of|suspect(?:ed)?)\b/i.test(sentence)) continue // attributed
    flags.push({ sentence: sentence.slice(0, 300) })
  }
  return flags.slice(0, 5)
}
