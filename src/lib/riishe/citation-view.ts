/**
 * BEAN Intelligence — RIISHE citation rendering (pure, unit-testable).
 *
 * Work-order contract (clean citations):
 *  - a RESOLVED [n] / [n,m] marker becomes a concise clickable SOURCE NAME
 *    ("The Hindu", "tn.gov.in") — never a bare number, never an index;
 *  - UNRESOLVED, orphaned or partial groups are STRIPPED from the displayed
 *    text (an unresolved marker is clutter; the Sources section still carries
 *    what was really retrieved — stripping is the opposite of faking);
 *  - code fences / inline code are never touched, and a marker glued to a
 *    word or digit ("arr[0]") is not treated as a citation at all;
 *  - copy text carries no citation IDs and no internal anchors — clean prose.
 */

import { splitIntoSentences } from './dedupe'

export interface CitableSourceView {
  id: number
  hostName: string
}

const MARKER_RE = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g

/** True when the "[" does not sit inside code and is not glued to a word/digit. */
function isCitationPosition(text: string, index: number): boolean {
  if (index > 0) {
    const prev = text[index - 1]
    if (/[\p{L}\p{N}_]/u.test(prev)) return false
  }
  return true
}

/** Split content into segments; citation transforms skip code segments. */
function segmentsOutsideCode(content: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = []
  const re = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), code: false })
    parts.push({ text: m[0], code: true })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ text: content.slice(last), code: false })
  return parts
}

/**
 * Readable publisher-style source name. Curated for common hosts
 * ("tn.gov.in" -> "Tamil Nadu Government", "bbc.com" -> "BBC News");
 * otherwise the cleaned domain ("www.thehindu.com" -> "thehindu.com").
 */
const PUBLISHER_NAMES: Record<string, string> = {
  'tn.gov.in': 'Tamil Nadu Government',
  'bbc.com': 'BBC News',
  'bbc.co.uk': 'BBC News',
  'reuters.com': 'Reuters',
  'apnews.com': 'AP News',
  'thehindu.com': 'The Hindu',
  'theprint.in': 'ThePrint',
  'indiatoday.in': 'India Today',
  'ndtv.com': 'NDTV',
  'indianexpress.com': 'Indian Express',
  'deccanherald.com': 'Deccan Herald',
  'timesofindia.indiatimes.com': 'Times of India',
  'economictimes.indiatimes.com': 'Economic Times',
  'wikipedia.org': 'Wikipedia',
  'britannica.com': 'Britannica',
  'cnn.com': 'CNN',
  'theguardian.com': 'The Guardian',
  'nytimes.com': 'NY Times',
  'aljazeera.com': 'Al Jazeera',
  'npmjs.com': 'npm',
  'github.com': 'GitHub',
  'nodejs.org': 'Node.js',
  'nextjs.org': 'Next.js',
  'developer.mozilla.org': 'MDN',
}

function conciseSourceName(hostName: string): string {
  const host = hostName.replace(/^www\./, '').toLowerCase()
  for (const [suffix, name] of Object.entries(PUBLISHER_NAMES)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return name
  }
  return host || 'source'
}

function transformMarkers(
  text: string,
  transform: (ids: number[], raw: string) => string | null,
): string {
  let out = ''
  let last = 0
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(text)) !== null) {
    if (!isCitationPosition(text, m.index)) continue
    out += text.slice(last, m.index)
    const ids = m[1].split(',').map((p) => Number(p.trim()))
    let replacement = transform(ids, m[0])
    if (replacement === null) replacement = ''
    // Adjacent resolved markers read better with a thin separator.
    if (replacement.startsWith('[') && out.endsWith(')')) out += ' '
    out += replacement
    last = m.index + m[0].length
  }
  out += text.slice(last)
  return out
}

/**
 * Display transform: resolved markers -> source-name links; unresolved or
 * partially-resolved markers -> removed. With no sources at all, every
 * numeric marker is orphaned by definition and is stripped.
 */
export function linkifyCitations(content: string, sources?: CitableSourceView[]): string {
  const byId = new Map((sources ?? []).map((s) => [s.id, conciseSourceName(s.hostName)]))
  return segmentsOutsideCode(content)
    .map(({ text, code }) => {
      if (code) return text
      return transformMarkers(text, (ids, raw) => {
        if (ids.some((id) => !byId.has(id))) return '' // strip unresolved/orphaned
        return ids.map((id) => `[${byId.get(id)}](#bean-src-${id})`).join(' ')
      })
    })
    .join('')
}

/**
 * Server-side counterpart: remove every marker that does NOT fully resolve
 * against the retrieved sources, keeping resolved ones as raw [n] (the
 * client linkifies them into source names). The persisted answer therefore
 * never carries orphaned or fabricated citation indices.
 */
export function stripUnresolvedMarkers(content: string, resolvedIds: ReadonlySet<number>): string {
  return segmentsOutsideCode(content)
    .map(({ text, code }) =>
      code
        ? text
        : transformMarkers(text, (ids, raw) => (ids.every((id) => resolvedIds.has(id)) ? raw : null)),
    )
    .join('')
}

/**
 * Copy transform: the answer text WITHOUT citation IDs, internal anchors or
 * UI metadata. External markdown links are preserved (they are content);
 * internal #bean-src anchors collapse to their label; all numeric markers
 * are removed.
 */
export function cleanAnswerForCopy(content: string): string {
  const withoutAnchors = content.replace(/\[([^\]]*)\]\(#bean-src-\d+\)/g, '$1')
  return segmentsOutsideCode(withoutAnchors)
    .map(({ text, code }) =>
      code ? text : transformMarkers(text, () => ''),
    )
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim()
}

/** First ~1 sentence per cited source, for the "supports" line in Sources. */
export function mapSourceClaims(
  content: string,
  sources: CitableSourceView[],
): Map<number, string> {
  const claims = new Map<number, string>()
  if (sources.length === 0) return claims
  const prose = segmentsOutsideCode(content)
    .map(({ text, code }) => (code ? ' ' : text))
    .join(' ')
  for (const s of sources) {
    const sentences = splitIntoSentences(prose)
    for (const sentence of sentences) {
      const markerHit = new RegExp(`\\[(?:\\d{1,2}\\s*,\\s*)*${s.id}(?:\\s*,\\s*\\d{1,2})*\\]`).test(sentence)
      if (!markerHit) continue
      // Present the claim as readable prose: markdown structure (headings,
      // list bullets, bold) and the raw numeric markers are noise in a
      // one-line "supports" summary.
      const clean = sentence
        .replace(/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, '')
        .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)+/, '')
        .replace(/\*\*|##|__/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim()
      claims.set(s.id, clean.length > 130 ? `${clean.slice(0, 127).trimEnd()}...` : clean)
      break
    }
  }
  return claims
}
