/**
 * BEAN Intelligence — universal multilingual prompt understanding (language
 * layer).
 *
 * The SHARED language foundation used by all four products (RIISHE research,
 * LAXII image grounding, JAZMII video grounding, CODE GIFTZ docs retrieval).
 * Pure, deterministic, allocation-light: every call is script arithmetic and
 * short substring scans — microseconds, never a model call.
 *
 * What it provides:
 *  - automatic language identification across scripts (Unicode ranges) with
 *    confidence, including MIXED-language inputs (e.g. Tamil + English);
 *  - multilingual normalization that is Unicode-safe (NFC, control-char
 *    stripping) and preserves the user's original text, names, measurements
 *    and technical terms — nothing is blindly translated;
 *  - transliteration awareness (Latin-script Tamil/Hindi/Malayalam markers
 *    like "vanakkam", "namaskaram" are recognized as TRANSLITERATED
 *    Indian-language content, not misspelled English);
 *  - search-language selection: which language(s) retrieval should run in
 *    (the user's language ALWAYS, plus English when the primary language is
 *    not English — English indexing still has the broadest coverage);
 *  - proper-noun / technical-term / measurement extraction so downstream
 *    conditioning can PRESERVE them verbatim.
 *
 * Honesty contract: detection reports a CONFIDENCE, not a certainty. For
 * short or ambiguous inputs the profile says so, and callers must degrade
 * gracefully (search in the original language regardless — the original text
 * is always the first query).
 */

// ---------------------------------------------------------------------------
// Unicode script ranges (https://unicode.org/charts — stable block bounds)
// ---------------------------------------------------------------------------

export type SupportedLanguage =
  | 'en' // English
  | 'ta' // Tamil
  | 'hi' // Hindi (Devanagari)
  | 'ml' // Malayalam
  | 'ar' // Arabic
  | 'es' // Spanish
  | 'zh' // Chinese
  | 'ja' // Japanese
  | 'und' // undetermined / mixed-minority

export interface ScriptRun {
  script: 'latin' | 'tamil' | 'devanagari' | 'malayalam' | 'arabic' | 'han' | 'kana' | 'hangul' | 'other'
  text: string
}

export interface LanguageProfile {
  /** Primary language of the message (best-effort). */
  primary: SupportedLanguage
  /** Rough 0..1 confidence in `primary` (script mass + function-word evidence). */
  confidence: number
  /** Every language meaningfully present, strongest first. */
  present: Array<{ language: SupportedLanguage; script: ScriptRun['script']; chars: number }>
  /** True when more than one language carries a substantial share of the text. */
  mixed: boolean
  /** True when the text is Latin-script but uses transliterated Indian-language words. */
  transliterated: boolean
  /** Human-readable note for audit logs (never shown as a false claim). */
  note: string
}

const SCRIPT_RANGES: Array<{ script: ScriptRun['script']; re: RegExp }> = [
  { script: 'tamil', re: /[\u0B80-\u0BFF]/ },
  { script: 'devanagari', re: /[\u0900-\u097F]/ },
  { script: 'malayalam', re: /[\u0D00-\u0D7F]/ },
  { script: 'arabic', re: /[\u0600-\u06FF\u0750-\u077F]/ },
  { script: 'kana', re: /[\u3040-\u30FF]/ }, // hiragana + katakana
  { script: 'han', re: /[\u4E00-\u9FFF\u3400-\u4DBF]/ },
  { script: 'hangul', re: /[\uAC00-\uD7AF\u1100-\u11FF]/ },
]

const SCRIPT_TO_LANGUAGE: Record<ScriptRun['script'], SupportedLanguage | null> = {
  tamil: 'ta',
  devanagari: 'hi',
  malayalam: 'ml',
  arabic: 'ar',
  kana: 'ja',
  han: 'zh', // kanji counts as zh presence; kana presence flips primary to ja
  hangul: 'und', // Korean is served best-effort; never claimed as a supported language
  latin: null,
  other: null,
}

/**
 * Latin-script function-word evidence. Script detection cannot separate
 * English from Spanish (both Latin), so short high-frequency words decide.
 * Kept deliberately SMALL — false positives are worse than 'en' defaults.
 */
const LATIN_STOPWORDS: Record<'en' | 'es', RegExp> = {
  en: /\b(the|and|is|are|was|were|what|who|how|why|when|where|which|of|for|with|about|please|make|create|write|explain|give|show|tell|can|you|your|from|that|this|into|video|image|photo|picture|code|function)\b/i,
  es: /\b(el|la|los|las|un|una|que|c[oó]mo|por\s*qu[eé]|cu[aá]l|d[oó]nde|cu[aá]ndo|qui[eé]n|con|para|por|hacer|crear|escribe|explica|muestra|dame|imagen|v[ií]deo|c[oó]digo)\b/i,
}

/**
 * Transliterated Indian-language markers (Latin script). These are REAL
 * words users type phonetically; treating them as English noise degrades
 * retrieval. Recognition is conservative — only unambiguous frequent words.
 */
const TRANSLITERATED_MARKERS: RegExp =
  /\b(vanakkam|vanakam|namaste|namaskaram|namaskar|nandri|eppadi|epdi|enna|ungal|seri|illa|thambi|akka|anna|dhanyavad|dhanyavaad|shukriya|kripya|ente|ninte|ninakku|valare|sugamano)\b/i

/** Normalize: NFC, strip control chars, collapse internal whitespace runs. */
export function normalizeMultilingualText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
}

/** Segment text into maximal single-script runs (mixed-language view). */
export function mixedLanguageSegments(raw: string): ScriptRun[] {
  const text = normalizeMultilingualText(raw)
  const runs: ScriptRun[] = []
  let current: { script: ScriptRun['script']; buf: string[] } | null = null

  const scriptOf = (ch: string): ScriptRun['script'] => {
    for (const { script, re } of SCRIPT_RANGES) {
      if (re.test(ch)) return script
    }
    if (/[A-Za-z]/.test(ch)) return 'latin'
    // digits/whitespace/punctuation inherit the surrounding run so words are
    // not split by the space inside "Tamil Nadu".
    return current?.script ?? 'latin'
  }

  for (const ch of text) {
    const s = scriptOf(ch)
    if (current && current.script === s) {
      current.buf.push(ch)
    } else {
      if (current && current.buf.join('').trim().length > 0) runs.push({ script: current.script, text: current.buf.join('') })
      current = { script: s, buf: [ch] }
    }
  }
  if (current && current.buf.join('').trim().length > 0) runs.push({ script: current.script, text: current.buf.join('') })
  // Merge adjacent runs of the same script (punctuation created splits).
  const merged: ScriptRun[] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (prev && prev.script === run.script) prev.text += run.text
    else merged.push({ ...run })
  }
  return merged
}

/** Map script-dominant evidence to a language, honoring kana-over-han. */
function languageFromScripts(scripts: Array<{ script: ScriptRun['script']; chars: number }>): { language: SupportedLanguage; confidence: number } {
  if (scripts.length === 0) return { language: 'und', confidence: 0 }
  const total = scripts.reduce((a, s) => a + s.chars, 0)
  const top = scripts[0]
  // Japanese: kana presence is decisive even next to han.
  const hasKana = scripts.some((s) => s.script === 'kana')
  if (hasKana) {
    const kanaShare = (scripts.find((s) => s.script === 'kana')?.chars ?? 0) / total
    return { language: 'ja', confidence: Math.min(0.95, 0.55 + kanaShare) }
  }
  const mapped = SCRIPT_TO_LANGUAGE[top.script]
  if (!mapped) return { language: 'und', confidence: 0.2 }
  const share = top.chars / total
  return { language: mapped, confidence: Math.min(0.99, 0.6 + share * 0.4) }
}

/**
 * Detect the language profile of a prompt. NEVER throws; a pathological
 * input degrades to 'und' with low confidence.
 */
export function detectLanguage(raw: string): LanguageProfile {
  const text = normalizeMultilingualText(raw)
  const runs = mixedLanguageSegments(text)
  const byScript = new Map<ScriptRun['script'], number>()
  for (const run of runs) {
    const letters = run.text.replace(/[\s\d\p{P}\p{S}]/gu, '')
    if (letters.length === 0) continue
    byScript.set(run.script, (byScript.get(run.script) ?? 0) + letters.length)
  }
  const scripts = [...byScript.entries()]
    .map(([script, chars]) => ({ script, chars }))
    .sort((a, b) => b.chars - a.chars)

  const present = scripts.map((s) => ({
    language: SCRIPT_TO_LANGUAGE[s.script] ?? ('und' as SupportedLanguage),
    script: s.script,
    chars: s.chars,
  }))

  let primary: SupportedLanguage = 'und'
  let confidence = 0.2
  let note = ''

  const nonLatin = scripts.filter((s) => s.script !== 'latin' && s.script !== 'other')
  const latinChars = byScript.get('latin') ?? 0
  const totalChars = scripts.reduce((a, s) => a + s.chars, 0)

  if (nonLatin.length > 0 && nonLatin[0].chars >= totalChars * 0.25) {
    // Non-Latin script carries a meaningful share — script evidence decides.
    const fromScripts = languageFromScripts(nonLatin)
    primary = fromScripts.language
    confidence = fromScripts.confidence
    if (latinChars > totalChars * 0.15) {
      note = 'mixed-script input: non-Latin primary with substantial Latin content (likely embedded English terms/names)'
    }
  } else if (totalChars > 0) {
    // Latin-dominant (or punctuation-only) — separate English vs Spanish.
    const enHits = (text.match(new RegExp(LATIN_STOPWORDS.en.source, 'gi')) ?? []).length
    const esHits = (text.match(new RegExp(LATIN_STOPWORDS.es.source, 'gi')) ?? []).length
    if (esHits > enHits && esHits > 0) {
      primary = 'es'
      confidence = Math.min(0.9, 0.5 + esHits * 0.1)
    } else {
      primary = 'en'
      confidence = enHits > 0 ? Math.min(0.9, 0.55 + enHits * 0.08) : text.length < 12 ? 0.35 : 0.55
      if (enHits === 0) note = note || 'Latin script without function-word evidence — English assumed at low confidence'
    }
  }

  const transliterated = TRANSLITERATED_MARKERS.test(text)
  if (transliterated) {
    note = note ? `${note}; transliterated Indian-language words detected` : 'transliterated Indian-language words detected (Latin script)'
    // Transliteration does NOT change the primary-language decision by
    // itself, but it lowers English confidence — retrieval must keep the
    // original wording as the first query.
    if (primary === 'en') confidence = Math.min(confidence, 0.5)
  }

  const substantial = present
    .map((p) =>
      // Latin runs carry no script-decided language; resolve them to the
      // detected Latin language (en/es) so mixed Tamil+English inputs flag
      // correctly (both languages meaningfully present).
      p.script === 'latin' ? { ...p, language: (primary === 'es' ? 'es' : 'en') as SupportedLanguage } : p,
    )
    .filter((p) => totalChars > 0 && p.chars / totalChars >= 0.15 && p.language !== 'und')
  const mixed = substantial.length > 1

  return { primary, confidence, present, mixed, transliterated, note }
}

/**
 * Which languages retrieval should run in for this prompt.
 * Contract: the user's OWN language is always first (their wording is the
 * strongest query); English is added when the primary language is not
 * English, because technical/indexed coverage is broader. Never returns an
 * empty list for non-empty text.
 */
export function searchLanguagesFor(profile: LanguageProfile): SupportedLanguage[] {
  const langs: SupportedLanguage[] = [profile.primary === 'und' ? 'en' : profile.primary]
  if (profile.primary !== 'en' && profile.primary !== 'und') langs.push('en')
  // A mixed Tamil+English prompt may also carry an English sub-question.
  if (profile.mixed && !langs.includes('en')) langs.push('en')
  return langs
}

// ---------------------------------------------------------------------------
// Term preservation: proper nouns, technical tokens, measurements
// ---------------------------------------------------------------------------

export interface PreservedTerms {
  /** Capitalized multi-word sequences and known proper nouns (original case). */
  properNouns: string[]
  /** Code-like tokens: foo.bar, snake_case, PascalCase, package@version. */
  technical: string[]
  /** Measurements and units: 30s, 12 kg, 4K, 60 fps, 2.5 cm. */
  measurements: string[]
  /** Quoted strings — user-marked verbatim content. */
  quoted: string[]
}

const MEASUREMENT_RE =
  /\b\d+(?:[.,]\d+)?\s?(?:km|cm|mm|kg|g\b|lb|fps|px|mp|hz|khz|mhz|ghz|ms|sec|secs|min|mins|hr|hrs|°c|°f|%|m)\b/gi

export function extractPreservedTerms(raw: string): PreservedTerms {
  const text = normalizeMultilingualText(raw)
  const properNouns = new Set<string>()
  // Multi-word capitalized sequences: "Tamil Nadu", "Mount Everest", "Node.js".
  const seq = text.match(/\b(?:[A-Z][\p{L}'’\-]+\.?)(?:\s+(?:[A-Z][\p{L}'’\-]+\.?)){1,3}/gu) ?? []
  for (const s of seq) if (s.length > 3) properNouns.add(s.trim())
  // Single capitalized words NOT at sentence start (heuristic: preceded by
  // a lowercase word + space) — "visited Paris", "by NVIDIA".
  const single = text.match(/[a-z\p{L}]\s+([A-Z][\p{L}]{2,})/gu) ?? []
  for (const s of single) {
    const w = s.trim().split(/\s+/).pop()!
    if (w.length > 2) properNouns.add(w)
  }

  const technical = new Set<string>()
  const tech =
    text.match(
      /\b[\p{L}_][\p{L}\p{N}_]*(?:[.\-/][\p{L}\p{N}_\-]+)+\b|\b(?:npm|pip|yarn|bun)\s+[\w@/.\-]+|[\w@][\w@.\-]*\/[\w.\-]+@\^?\d[\w.\-]*|\b[\p{Lu}]{2,}(?:[-_][\p{Lu}\p{N}]+)+\b/gu,
    ) ?? []
  for (const t of tech) technical.add(t.trim())

  const measurements = new Set<string>()
  for (const m of text.match(MEASUREMENT_RE) ?? []) measurements.add(m.trim())

  const quoted = new Set<string>()
  for (const q of text.match(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/g) ?? []) {
    const inner = q.slice(1, -1).trim()
    if (inner) quoted.add(inner)
  }

  return {
    properNouns: [...properNouns].slice(0, 12),
    technical: [...technical].slice(0, 12),
    measurements: [...measurements].slice(0, 12),
    quoted: [...quoted].slice(0, 6),
  }
}

/** Language display names for audit logs and honest degradation notes. */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ta: 'Tamil',
  hi: 'Hindi',
  ml: 'Malayalam',
  ar: 'Arabic',
  es: 'Spanish',
  zh: 'Chinese',
  ja: 'Japanese',
  und: 'undetermined',
}
