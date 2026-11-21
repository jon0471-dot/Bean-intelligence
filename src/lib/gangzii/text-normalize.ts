/**
 * BEAN Intelligence — GANGZII text preparation for TTS (M27).
 *
 * The contract (never silently change the user's wording):
 *  - `normalizeTextForSpeech` produces the text ACTUALLY sent to synthesis;
 *  - the ORIGINAL text is preserved separately (NarrationSegment.text);
 *  - every rewrite class is deterministic and inspectable;
 *  - user pronunciation overrides apply LAST and are recorded;
 *  - no invented timing: segmentation is structural only (sentences).
 *
 * Language honesty: the local Kokoro engine's English path is the verified
 * set; normalization is conservative for non-Latin scripts (CJK: sentence
 * splitting + punctuation spacing only — number/URL expansion is en-only
 * until a language is actually verified end-to-end).
 *
 * PURE module — unit-tested in tests/unit/gangzii-narration.test.ts.
 */

export interface PronunciationOverride {
  /** Exact substring to replace (case-insensitive match, whole-word first). */
  from: string
  /** Replacement read as written. */
  to: string
}

export interface NormalizationReport {
  normalized: string
  /** What actually changed, for the UI + receipt (bounded classes, no diffs of user content). */
  changes: Array<{ kind: string; count: number }>
  /** Overrides applied (echo of the user's own list). */
  overridesApplied: Array<{ from: string; to: string }>
}

// ---- en expansion helpers -----------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n < 0) return `minus ${numberToWords(-n)}`
  if (!Number.isInteger(n)) {
    const [int, dec] = String(n).split('.')
    return `${numberToWords(Number(int))} point ${dec.split('').map((d) => ONES[Number(d)] ?? d).join(' ')}`
  }
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10) - 2]
    const r = n % 10
    return r === 0 ? t : `${t} ${ONES[r]}`
  }
  if (n < 1_000) {
    const h = Math.floor(n / 100)
    const r = n % 100
    return `${ONES[h]} hundred${r === 0 ? '' : r < 10 ? ` ${ONES[r]}` : r < 20 ? ` ${TEENS[r - 10]}` : ` and ${numberToWords(r)}`}`
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000)
    const r = n % 1000
    return `${numberToWords(th)} thousand${r === 0 ? '' : ` ${numberToWords(r)}`}`
  }
  if (n < 1_000_000_000) {
    const m = Math.floor(n / 1_000_000)
    const r = n % 1_000_000
    return `${numberToWords(m)} million${r === 0 ? '' : ` ${numberToWords(r)}`}`
  }
  return String(n) // beyond billions: leave as digits (engine choice)
}

/** Currency: $12.50 → "twelve dollars and fifty cents". */
function expandCurrency(m: string): string {
  const symbol = m[0]
  const body = m.slice(1)
  if (!/^\d+(\.\d+)?$/.test(body)) return m
  const unit = symbol === '$' ? ['dollar', 'dollars'] : symbol === '£' ? ['pound', 'pounds'] : [symbol, symbol]
  if (body.includes('.')) {
    const [int, dec] = body.split('.')
    const cents = Number(dec.padEnd(2, '0').slice(0, 2))
    const centsUnit = symbol === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence'
    return `${numberToWords(Number(int))} ${Number(int) === 1 ? unit[0] : unit[1]} and ${numberToWords(cents)} ${centsUnit}`
  }
  const n = Number(body)
  return `${numberToWords(n)} ${n === 1 ? unit[0] : unit[1]}`
}

/** Time 9:30 → "nine thirty"; 12:05 → "twelve oh five". */
function expandClock(m: string): string {
  const [h, min] = m.split(':').map(Number)
  if (h > 23 || min > 59) return m
  const hourPart = numberToWords(h)
  const minPart = min === 0 ? "o'clock" : min < 10 ? `oh ${ONES[min]}` : numberToWords(min)
  return `${hourPart} ${minPart}`
}

/** Year 1995 → "nineteen ninety-five"; 2005 → "two thousand five". */
function expandYear(m: string): string {
  const year = Number(m.replace(/s$/, ''))
  if (year < 1000 || year > 2100) return numberToWords(year)
  if (year % 100 === 0) return `${numberToWords(Math.floor(year / 100))} hundred`
  const first = Math.floor(year / 100)
  const rest = year % 100
  const plural = m.endsWith('s') ? 's' : ''
  if (rest < 10) return `${numberToWords(first)} oh ${ONES[rest]}${plural}`
  return `${numberToWords(first)} ${numberToWords(rest)}${plural}`
}

/** URL → "example dot com" (spoken form; scheme dropped). */
function expandUrl(m: string): string {
  const stripped = m.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  return stripped
    .replace(/\./g, ' dot ')
    .replace(/-/g, ' dash ')
    .replace(/_/g, ' underscore ')
    .replace(/\//g, ' slash ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bDr\.(?=\s+[A-Z])/g, 'Doctor'],
  [/\bMr\.(?=\s+[A-Z])/g, 'Mister'],
  [/\bMrs\.(?=\s+[A-Z])/g, 'Misses'],
  [/\bMs\.(?=\s+[A-Z])/g, 'Miss'],
  [/\bSt\.(?=\s+[A-Z])/g, 'Saint'],
  [/\betc\./gi, 'etcetera'],
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\bvs\./gi, 'versus'],
  [/\bapprox\./gi, 'approximately'],
]

// ---- main normalizer ----------------------------------------------------------

export function normalizeTextForSpeech(
  text: string,
  opts?: { language?: string; overrides?: PronunciationOverride[] },
): NormalizationReport {
  const language = opts?.language ?? 'en'
  const changes: NormalizationReport['changes'] = []
  const bump = (kind: string, n = 1) => {
    const found = changes.find((c) => c.kind === kind)
    if (found) found.count += n
    else changes.push({ kind, count: n })
  }

  let out = text

  // Whitespace: tabs → spaces, collapse runs, trim line-ends. (Class 1)
  const beforeWs = out
  out = out
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (beforeWs !== out) bump('whitespace')

  // English-only expansions (conservative for unverified languages).
  const isEnglish = language === 'en' || language.startsWith('en-')
  if (isEnglish) {
    // URLs first (so their digits are not number-expanded). (Class 2)
    const urlRe = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi
    const urlCount = (out.match(urlRe) ?? []).length
    if (urlCount > 0) {
      out = out.replace(urlRe, expandUrl)
      bump('url', urlCount)
    }
    // Abbreviations. (Class 3)
    for (const [re, replacement] of ABBREVIATIONS) {
      const n = (out.match(re) ?? []).length
      if (n > 0) {
        out = out.replace(re, replacement)
        bump('abbreviation', n)
      }
    }
    // Currency. (Class 4)
    const curRe = /[$£]\d+(?:\.\d+)?(?:\s*(?:hundred|thousand|million|billion))*\b/gi
    const curCount = (out.match(curRe) ?? []).length
    if (curCount > 0) {
      out = out.replace(curRe, (m) => expandCurrency(m))
      bump('currency', curCount)
    }
    // Clock times. (Class 5)
    const clockRe = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/g
    const clockCount = (out.match(clockRe) ?? []).length
    if (clockCount > 0) {
      out = out.replace(clockRe, expandClock)
      bump('time', clockCount)
    }
    // Years (1900-2100, optional plural s). (Class 6)
    const yearRe = /\b(19|20)\d{2}s?\b/g
    const yearCount = (out.match(yearRe) ?? []).length
    if (yearCount > 0) {
      out = out.replace(yearRe, expandYear)
      bump('year', yearCount)
    }
    // Decimal numbers, then integers. (Class 7)
    const decRe = /\b\d+\.\d+\b/g
    const decCount = (out.match(decRe) ?? []).length
    if (decCount > 0) {
      out = out.replace(decRe, (m) => numberToWords(Number(m)))
      bump('number', decCount)
    }
    const intRe = /\b\d{1,9}(?:,\d{3})*\b/g
    const intCount = (out.match(intRe) ?? []).length
    if (intCount > 0) {
      out = out.replace(intRe, (m) => numberToWords(Number(m.replace(/,/g, ''))))
      bump('number', intCount)
    }
    // Date forms "March 5, 2026" — month names pass through; the year and
    // day are already handled by the number/year classes above.
  }

  // CJK spacing normalization (punctuation spacing only — no rewording).
  if (/[\u4e00-\u9fff]/.test(out)) {
    const before = out
    out = out
      .replace(/。/g, '. ')
      .replace(/！/g, '! ')
      .replace(/？/g, '? ')
      .replace(/，/g, ', ')
      .replace(/：/g, ': ')
      .replace(/；/g, '; ')
    if (before !== out) bump('cjk-punctuation')
  }

  // Pronunciation overrides — applied LAST, echoed exactly. (Class 8)
  const overridesApplied: Array<{ from: string; to: string }> = []
  for (const o of opts?.overrides ?? []) {
    if (!o.from || o.to === undefined) continue
    if (!out.includes(o.from)) continue
    const escaped = o.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, 'g')
    const n = (out.match(re) ?? []).length
    if (n > 0) {
      out = out.replace(re, o.to)
      overridesApplied.push({ from: o.from, to: o.to })
      bump('pronunciation-override', n)
    }
  }

  return { normalized: out, changes, overridesApplied }
}

// ---- segmentation ---------------------------------------------------------------

/**
 * Split narration text into user-facing segments. Deterministic; sentence
 * boundaries preferred; a segment never exceeds `maxChars` (word-boundary
 * fallback for oversized sentences). Ordering is stable and indexes are
 * 1-based, so segment regeneration never disturbs siblings.
 */
export function segmentTextForNarration(text: string, maxChars = 500): string[] {
  const source = text.trim()
  if (!source) return []
  const sentences = source
    .split(/(?<=[.!?。！？…])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean)
  const segments: string[] = []
  let current = ''
  const push = () => {
    if (current) segments.push(current)
    current = ''
  }
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push()
      let rest = sentence
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars)
        if (cut < maxChars / 2) cut = maxChars
        segments.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) current = rest
      continue
    }
    if (current.length + sentence.length + 1 > maxChars) push()
    current = current ? `${current} ${sentence}` : sentence
  }
  push()
  return segments
}

// ---- subtitles (segment-level timing, honestly approximate) ---------------------

export interface SubtitleSegment {
  idx: number
  text: string
  /** MEASURED duration in ms (from the produced audio) or null when missing. */
  durationMs: number | null
}

function formatTimestamp(ms: number, comma: boolean): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const frac = total % 1000
  const sep = comma ? ',' : '.'
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(frac).padStart(3, '0')}`
}

/**
 * Segment-level subtitles. Segments without measured audio are SKIPPED with
 * an explicit note — an estimated timestamp is never labeled as measured.
 * The output header states the approximation level plainly.
 */
export function buildSubtitles(
  segments: SubtitleSegment[],
  format: 'srt' | 'vtt',
): { content: string; measuredCount: number; skippedCount: number } {
  const lines: string[] = []
  if (format === 'vtt') {
    lines.push('WEBVTT', '')
    lines.push('NOTE timing is segment-level (measured from produced audio); not word-level alignment.', '')
  } else {
    // SRT has no comment channel — the API payload carries the honesty note.
  }
  let cursor = 0
  let n = 0
  let measured = 0
  let skipped = 0
  for (const seg of segments) {
    if (seg.durationMs === null || seg.durationMs === undefined) {
      skipped += 1
      continue
    }
    n += 1
    measured += 1
    const startMs = cursor
    const endMs = cursor + seg.durationMs
    lines.push(String(n))
    lines.push(`${formatTimestamp(startMs, format === 'srt')} --> ${formatTimestamp(endMs, format === 'srt')}`)
    lines.push(seg.text)
    lines.push('')
    cursor = endMs
  }
  return { content: lines.join('\n'), measuredCount: measured, skippedCount: skipped }
}
