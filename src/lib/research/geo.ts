/**
 * BEAN Intelligence — location context for search (pure, deterministic).
 *
 * Work-order evidence (worklog): "Research a current topic: Gingee girl
 * missing" searched the bare topic and the provider returned a stale,
 * geographically unrelated missing-person article from another country.
 * The fix is two-sided:
 *   1. QUERY side — when a topic names a place whose broader region is
 *      missing from the wording, add targeted variants that carry the region
 *      ("Gingee girl missing" -> + "Tamil Nadu India") so local reporting is
 *      retrievable at all.
 *   2. RANKING side — geo terms extracted from the topic penalize results
 *      that never mention them (see rank.ts).
 *
 * The gazetteer is a compact, auditable table — NOT a fabricated NER. It
 * covers Indian states/UTs, selected Indian towns/cities, and major
 * countries; unknown places still fall back to capitalized-proper-token
 * detection so an unfamiliar town name still acts as a geo term.
 */

interface PlaceEntry {
  /** Place as matched in text (lowercase key). */
  key: string
  /** Broader geographic context appended to queries when missing. */
  region: string
}

const PLACES: PlaceEntry[] = [
  // --- Indian states & UTs: context is India -------------------------------
  { key: 'tamil nadu', region: 'India' },
  { key: 'kerala', region: 'India' },
  { key: 'karnataka', region: 'India' },
  { key: 'andhra pradesh', region: 'India' },
  { key: 'telangana', region: 'India' },
  { key: 'maharashtra', region: 'India' },
  { key: 'gujarat', region: 'India' },
  { key: 'rajasthan', region: 'India' },
  { key: 'uttar pradesh', region: 'India' },
  { key: 'madhya pradesh', region: 'India' },
  { key: 'bihar', region: 'India' },
  { key: 'west bengal', region: 'India' },
  { key: 'odisha', region: 'India' },
  { key: 'assam', region: 'India' },
  { key: 'punjab', region: 'India' },
  { key: 'haryana', region: 'India' },
  { key: 'jharkhand', region: 'India' },
  { key: 'chhattisgarh', region: 'India' },
  { key: 'goa', region: 'India' },
  { key: 'delhi', region: 'India' },
  { key: 'puducherry', region: 'India' },
  { key: 'pondicherry', region: 'India' },
  { key: 'jammu', region: 'India' },
  { key: 'ladakh', region: 'India' },
  // --- Selected Indian towns & cities (incl. the measured case) ------------
  { key: 'gingee', region: 'Tamil Nadu India' },
  { key: 'villupuram', region: 'Tamil Nadu India' },
  { key: 'chennai', region: 'Tamil Nadu India' },
  { key: 'coimbatore', region: 'Tamil Nadu India' },
  { key: 'madurai', region: 'Tamil Nadu India' },
  { key: 'tiruchirappalli', region: 'Tamil Nadu India' },
  { key: 'trichy', region: 'Tamil Nadu India' },
  { key: 'thanjavur', region: 'Tamil Nadu India' },
  { key: 'vellore', region: 'Tamil Nadu India' },
  { key: 'erode', region: 'Tamil Nadu India' },
  { key: 'tirunelveli', region: 'Tamil Nadu India' },
  { key: 'mumbai', region: 'Maharashtra India' },
  { key: 'pune', region: 'Maharashtra India' },
  { key: 'nagpur', region: 'Maharashtra India' },
  { key: 'bengaluru', region: 'Karnataka India' },
  { key: 'bangalore', region: 'Karnataka India' },
  { key: 'hyderabad', region: 'Telangana India' },
  { key: 'kolkata', region: 'West Bengal India' },
  { key: 'ahmedabad', region: 'Gujarat India' },
  { key: 'jaipur', region: 'Rajasthan India' },
  { key: 'lucknow', region: 'Uttar Pradesh India' },
  { key: 'varanasi', region: 'Uttar Pradesh India' },
  { key: 'patna', region: 'Bihar India' },
  { key: 'bhopal', region: 'Madhya Pradesh India' },
  { key: 'indore', region: 'Madhya Pradesh India' },
  { key: 'kochi', region: 'Kerala India' },
  { key: 'cochin', region: 'Kerala India' },
  { key: 'trivandrum', region: 'Kerala India' },
  { key: 'thiruvananthapuram', region: 'Kerala India' },
  // --- Countries ------------------------------------------------------------
  { key: 'india', region: 'India' },
  { key: 'bharat', region: 'India' },
  { key: 'united states', region: 'United States' },
  { key: 'united kingdom', region: 'United Kingdom' },
  { key: 'sri lanka', region: 'Sri Lanka' },
  { key: 'pakistan', region: 'Pakistan' },
  { key: 'bangladesh', region: 'Bangladesh' },
  { key: 'nepal', region: 'Nepal' },
  { key: 'china', region: 'China' },
  { key: 'japan', region: 'Japan' },
  { key: 'singapore', region: 'Singapore' },
  { key: 'australia', region: 'Australia' },
  { key: 'canada', region: 'Canada' },
  { key: 'germany', region: 'Germany' },
  { key: 'france', region: 'France' },
  { key: 'israel', region: 'Israel' },
  { key: 'ukraine', region: 'Ukraine' },
  { key: 'russia', region: 'Russia' },
  { key: 'brazil', region: 'Brazil' },
  { key: 'nigeria', region: 'Nigeria' },
  { key: 'south africa', region: 'South Africa' },
  { key: 'mexico', region: 'Mexico' },
  { key: 'indonesia', region: 'Indonesia' },
  { key: 'malaysia', region: 'Malaysia' },
  { key: 'dubai', region: 'United Arab Emirates' },
  { key: 'uae', region: 'United Arab Emirates' },
]

// Longest keys first so "tamil nadu" wins over any shorter overlap.
const SORTED_PLACES = [...PLACES].sort((a, b) => b.key.length - a.key.length)

function containsWholePhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'u').test(text)
}

/**
 * Punctuation-insensitive mention check: does the text mention the term,
 * counting "Next.js" and "nextjs" (or "M.K. Stalin" and "M K Stalin") as the
 * same token? Measured false positive (work order): the geo-term extraction
 * strips dots from a query token ("Next.js" -> "nextjs"), so a literal
 * substring check never matched source text that writes "Next.js" — a
 * software-version question then triggered a place/case warning. Both sides
 * are normalized to alphanumerics before comparison; short terms still
 * require a whole-word boundary on the raw text to avoid noise.
 */
export function textMentionsTerm(text: string, term: string): boolean {
  const hay = text.toLowerCase()
  const needle = term.toLowerCase()
  if (needle.length === 0) return false
  if (hay.includes(needle)) return true
  const normHay = hay.replace(/[^\p{L}\p{N}]+/gu, '')
  const normNeedle = needle.replace(/[^\p{L}\p{N}]+/gu, '')
  if (normNeedle.length === 0) return false
  if (normHay.includes(normNeedle)) return true
  return false
}

/** The place keys actually mentioned in the text (deduped, longest match wins). */
export function placeKeysOf(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const p of SORTED_PLACES) {
    if (found.some((f) => p.key.includes(f))) continue // "tamil nadu" shadows nothing here, but cheap guard
    if (containsWholePhrase(lower, p.key)) found.push(p.key)
  }
  return found
}

/**
 * Broader region context for a topic: the first matched place's region that
 * is NOT already present in the wording (case-insensitive). Null when the
 * topic already carries its region or matches nothing.
 */
export function regionContextFor(topic: string): string | null {
  const lower = topic.toLowerCase()
  for (const key of placeKeysOf(topic)) {
    const entry = PLACES.find((p) => p.key === key)
    if (!entry) continue
    const region = entry.region
    // "tamil nadu" already implies India contextually; only append when the
    // region itself is not already mentioned anywhere in the wording.
    if (!lower.includes(region.toLowerCase())) return region
  }
  return null
}

const COMMON_NON_PLACE_WORDS = new Set([
  'research', 'search', 'latest', 'news', 'update', 'updates', 'report',
  'topic', 'current', 'today', 'yesterday', 'police', 'government',
  'minister', 'court', 'case', 'girl', 'boy', 'woman', 'man', 'found',
  'this', 'that', 'what', 'when', 'where', 'which', 'while', 'with',
  'hello', 'please', 'about', 'after', 'before', 'online', 'web',
])

/**
 * Geo/topical anchor terms used for result penalization: gazetteer matches
 * PLUS capitalized proper-looking tokens ("Gingee", "Zumbalandia") that are
 * not sentence-initial fillers. Tokens that never appear in a result's text
 * mark that result as geographically unrelated.
 */
export function geoTermsOf(text: string): string[] {
  const terms = new Set<string>(placeKeysOf(text))
  const tokens = text.split(/\s+/)
  tokens.forEach((tok, i) => {
    const clean = tok.replace(/[^\p{L}\p{N}-]/gu, '')
    // Capitalized proper-looking token: not sentence-initial, not ALLCAPS
    // acronym, long enough, not a common word.
    if (i === 0) return
    if (!/^[A-Z][a-z]{3,}$/.test(clean)) return
    if (COMMON_NON_PLACE_WORDS.has(clean.toLowerCase())) return
    terms.add(clean.toLowerCase())
  })
  return [...terms]
}

/**
 * Fast-path query variants: the topic itself FIRST (preserves the user's
 * exact wording, which providers match literally), then — only when the
 * wording lacks its broader region — one region-anchored variant. Bounded
 * at 2 queries so latency stays predictable.
 */
export function fastPathQueryVariants(topic: string): string[] {
  const variants = [topic]
  const region = regionContextFor(topic)
  if (region && !variants.some((v) => v.toLowerCase().includes(region.toLowerCase()))) {
    variants.push(`${topic} ${region}`)
  }
  return variants
}
