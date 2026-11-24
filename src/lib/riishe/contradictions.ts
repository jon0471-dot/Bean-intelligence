/**
 * BEAN Intelligence — cross-source claim contradiction detection (M37 §1).
 *
 * DETERMINISTIC, CONSERVATIVE, HONEST. When the research pipeline retrieves
 * several sources, the same entity is sometimes described with CONFLICTING
 * figures or dates in different reports. The composer previously had no
 * systematic way to see that disagreement: it could silently pick one number,
 * and the answer shipped as "verified" while the evidence actually contained
 * an unresolved conflict (only same-answer internal date conflicts and
 * identity/name conflicts were caught before).
 *
 * What this module does — and deliberately does NOT do:
 *  - It scans the ACTUAL retrieved text (title + snippet + full-page excerpt)
 *    of each source for numeric/date claims anchored to a shared entity.
 *  - A contradiction is flagged ONLY when two DIFFERENT sources attach
 *    DIFFERENT values of the SAME measure unit to the SAME entity anchor
 *    (shared capitalized name token(s), same measure, numerically distinct
 *    canonical values). Anything less specific is never flagged — a missing
 *    match is the honest default.
 *  - It never decides WHICH source is right. The output is a list of
 *    disagreements for the composer to state explicitly ("the retrieved
 *    reports disagree: X vs Y"), never a silent resolution.
 *
 * PURE module — regex + string shaping only. No DB, no I/O, no model calls.
 */

export interface ContradictionSource {
  id: number
  title: string
  snippet: string
  /** Full-page excerpt when the page was read (null for snippet-only). */
  excerpt: string | null
}

export interface SourceContradiction {
  /** Shared entity anchor the conflicting claims attach to. */
  subject: string
  /** The measure in conflict (e.g. "dead", "percent", "money", "date"). */
  measure: string
  valueA: string
  valueB: string
  sourceIdA: number
  sourceIdB: number
}

/** Upper bounds keep the scan bounded on large evidence packs. */
const MAX_SOURCES_SCANNED = 24
const MAX_TEXT_CHARS = 40_000
const MAX_SENTENCES = 400
export const MAX_CONTRADICTIONS = 5

/**
 * Numeric claim shapes worth comparing across sources. Each entry pairs a
 * measure label (normalized unit) with its capture regex; group 1 is the
 * numeric value, group 2 (optional) a scale word. Deliberately a NARROW
 * list: casualty figures, percentages, money, magnitudes, ages and
 * displacement/arrest figures — the classes where cross-source disagreement
 * is materially dangerous.
 */
interface MeasurePattern {
  measure: string
  re: RegExp
  /** Scale-word multiplier for canonicalization (when group 2 exists). */
  scale?: (s: string | undefined) => number
}

const scaleOf = (s: string | undefined): number => {
  const t = (s ?? '').toLowerCase()
  if (t.startsWith('t')) return 1e12
  if (t.startsWith('b')) return 1e9
  if (t.startsWith('m')) return 1e6
  return 1
}

const MEASURE_PATTERNS: ReadonlyArray<MeasurePattern> = [
  // "24 people were killed" order (number before the measure word).
  { measure: 'dead', re: /\b(\d[\d,]*(?:\.\d+)?)\s*(?:people\s+)?(?:dead|killed|fatalities|died)\b/gi },
  // "killed 24 people" order (the measure word leads the figure).
  { measure: 'dead', re: /\b(?:dead|killed|fatalities|died)\b[^.?!]{0,40}?\b(\d[\d,]*(?:\.\d+)?)\s*(?:people)?\b/gi },
  { measure: 'injured', re: /\b(\d[\d,]*(?:\.\d+)?)\s*(?:people\s+)?(?:injured|wounded|hospitali[sz]ed)\b/gi },
  { measure: 'injured', re: /\b(?:injured|wounded|hospitali[sz]ed)\b[^.?!]{0,40}?\b(\d[\d,]*(?:\.\d+)?)\s*(?:people)?\b/gi },
  { measure: 'percent', re: /\b(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent)\b/gi },
  { measure: 'money', re: /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|trillion|bn|mn|m)?\b/gi, scale: scaleOf },
  // Magnitude must not double-report a money figure ($5 million): negative
  // lookbehind on the currency sign (with or without its space).
  { measure: 'magnitude', re: /(?<!\$)(?<!\$ )\b(\d[\d,]*(?:\.\d+)?)\s*(million|billion|trillion)\b(?!\s*(?:%|percent))/gi, scale: scaleOf },
  { measure: 'years-old', re: /\bage[ds]?\s+(?:of\s+)?(\d{1,3})\b/gi },
  { measure: 'years-old', re: /\b(\d{1,3})\s*years?\s*(?:old|of age)\b/gi },
  { measure: 'displaced', re: /\b(\d[\d,]*(?:\.\d+)?)\s*(?:people\s+)?(?:displaced|evacuated|homeless)\b/gi },
  { measure: 'displaced', re: /\b(?:displaced|evacuated|homeless)\b[^.?!]{0,40}?\b(\d[\d,]*(?:\.\d+)?)\s*(?:people)?\b/gi },
  { measure: 'arrested', re: /\b(\d[\d,]*(?:\.\d+)?)\s*(?:people\s+)?(?:arrested|detained)\b/gi },
  { measure: 'arrested', re: /\b(?:arrested|detained)\b[^.?!]{0,40}?\b(\d[\d,]*(?:\.\d+)?)\s*(?:people)?\b/gi },
]

/** Full calendar dates (ISO or "Month D, YYYY" / "D Month YYYY"). */
const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
]
const MONTHS = new Set(MONTH_NAMES)

const NAME_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'there', 'when', 'where', 'while', 'after', 'before',
  'according', 'officials', 'police', 'reports', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december', 'reuters', 'afp',
  'associated', 'press', 'bbc', 'cnn', 'updated', 'published', 'image', 'source', 'getty',
  'said', 'says', 'reported', 'president', 'minister', 'government', 'ministry',
  // Document-frame words (titles/headers) — they anchor nothing:
  'report', 'reports', 'bulletin', 'coverage', 'snippet', 'page', 'wire',
  'agency', 'ledger', 'update', 'latest', 'news', 'article', 'statement',
  'release', 'court', 'filing', 'dispatch', 'brief',
])

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .slice(0, MAX_SENTENCES)
}

/**
 * Entity anchor for a sentence: capitalized tokens that are NOT month/weekday/
 * outlet words (a person/place/org name). Two claims describe the SAME entity
 * when their token sets share at least one name token.
 */
function entityTokens(sentence: string): string[] {
  const tokens = sentence.match(/[A-Z][a-zA-Z]{3,}/g) ?? []
  const out = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const lower = t.toLowerCase()
    if (lower.length < 4) continue
    if (MONTHS.has(lower)) continue
    if (NAME_STOPWORDS.has(lower)) continue
    // Skip a token only when it LITERALLY starts the sentence and a lowercase
    // word follows (a grammatical subject start like "Search teams ..." —
    // not a proper noun). A name after "The ..." ("The Kapueras floods")
    // is NOT sentence-initial and must be kept as the entity anchor.
    if (sentence.startsWith(t)) {
      const after = sentence.slice(t.length).match(/^\s+[a-z]/)
      if (after) continue
    }
    out.add(lower)
  }
  return [...out]
}

/** Canonical numeric value: commas stripped, scale word applied. */
function canonicalValue(raw: string, scale: ((s: string | undefined) => number) | undefined, scaleWord: string | undefined): number {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return Number.NaN
  return scale ? n * scale(scaleWord) : n
}

interface Claim {
  sourceId: number
  subjectTokens: string[]
  measure: string
  /** Display form (as the source wrote it). */
  display: string
  /** Canonical numeric value (money/magnitude: scale applied). */
  canonical: number
  /** Canonical date value (ISO) when measure === 'date', else null. */
  dateIso: string | null
}

function numericClaims(source: ContradictionSource): Claim[] {
  const text = `${source.title} ${source.snippet} ${source.excerpt ?? ''}`.trim()
  if (text.length === 0) return []
  const claims: Claim[] = []
  for (const sentence of splitSentences(text.slice(0, MAX_TEXT_CHARS))) {
    const subjects = entityTokens(sentence)
    if (subjects.length === 0) continue
    for (const { measure, re, scale } of MEASURE_PATTERNS) {
      const matches = [...sentence.matchAll(re)].slice(0, 2)
      for (const m of matches) {
        const canonical = canonicalValue(m[1], scale, m[2])
        if (Number.isNaN(canonical) || canonical <= 0) continue
        claims.push({
          sourceId: source.id,
          subjectTokens: subjects,
          measure,
          display: m[0].trim(),
          canonical,
          dateIso: null,
        })
      }
    }
    for (const d of [...sentence.matchAll(DATE_RE)].slice(0, 2)) {
      const iso = toIso(d[0])
      if (!iso) continue
      claims.push({
        sourceId: source.id,
        subjectTokens: subjects,
        measure: 'date',
        display: d[0].trim(),
        canonical: Number.NaN,
        dateIso: iso,
      })
    }
  }
  return claims
}

function monthIndex(word: string): number {
  return MONTH_NAMES.indexOf(word.toLowerCase())
}

/** Normalize any DATE_RE match to ISO yyyy-mm-dd (null when unparseable). */
function toIso(raw: string): string | null {
  const text = raw.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const textual = new RegExp(
    `(${MONTH_NAMES.map((m) => m).join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`,
    'i',
  ).exec(text.toLowerCase()) ?? new RegExp(
    `(\\d{1,2})\\s+(${MONTH_NAMES.map((m) => m).join('|')})\\s+(\\d{4})`,
    'i',
  ).exec(text.toLowerCase())
  if (!textual) return null
  const monthPart = textual[2]?.match(/^[a-z]+$/i) ? textual[2] : textual[1]
  const dayPart = textual[2]?.match(/^\d/) ? textual[2] : textual[1]
  const year = textual[3]
  const mi = monthIndex(monthPart)
  if (mi < 0) return null
  return `${year}-${String(mi + 1).padStart(2, '0')}-${String(Number(dayPart)).padStart(2, '0')}`
}

function sharesSubject(a: Claim, b: Claim): boolean {
  for (const t of a.subjectTokens) {
    if (b.subjectTokens.includes(t)) return true
  }
  return false
}

function sameValue(a: Claim, b: Claim): boolean {
  if (a.measure === 'date') return a.dateIso === b.dateIso
  return a.canonical === b.canonical
}

/**
 * Detect cross-source contradictions among the retrieved sources. Only
 * SAME-measure, SAME-entity, DIFFERENT-value pairs from DIFFERENT sources
 * are reported, capped at MAX_CONTRADICTIONS (evidence order — deterministic).
 */
export function detectSourceContradictions(
  sources: readonly ContradictionSource[],
): SourceContradiction[] {
  const scanned = sources.slice(0, MAX_SOURCES_SCANNED)
  const claims: Claim[] = []
  for (const s of scanned) claims.push(...numericClaims(s))

  const contradictions: SourceContradiction[] = []
  const seen = new Set<string>()
  for (let i = 0; i < claims.length && contradictions.length < MAX_CONTRADICTIONS; i++) {
    const a = claims[i]
    for (let j = i + 1; j < claims.length && contradictions.length < MAX_CONTRADICTIONS; j++) {
      const b = claims[j]
      if (a.sourceId === b.sourceId) continue // within ONE source is not a CROSS-source conflict
      if (a.measure !== b.measure) continue
      if (!sharesSubject(a, b)) continue
      if (sameValue(a, b)) continue
      const subjectKeys = [a.subjectTokens, b.subjectTokens].map((t) => t.join('|')).sort()
      const values = [a.display, b.display].sort()
      const key = `${a.measure}|${subjectKeys.join('~')}|${values.join('~')}`
      if (seen.has(key)) continue
      seen.add(key)
      contradictions.push({
        subject: (a.subjectTokens[0] ?? 'the subject').replace(/^\w/, (ch) => ch.toUpperCase()),
        measure: a.measure,
        valueA: a.display,
        valueB: b.display,
        sourceIdA: a.sourceId,
        sourceIdB: b.sourceId,
      })
    }
  }
  return contradictions
}

/** Compose the human-honest note line for one contradiction (for the model + UI). */
export function describeContradiction(c: SourceContradiction): string {
  const noun = c.measure === 'date' ? 'dates' : `${c.measure} figures`
  return `sources [${c.sourceIdA}] and [${c.sourceIdB}] state different ${noun} for ${c.subject}: ${c.valueA} vs ${c.valueB}`
}
