/**
 * BEAN Intelligence — citation integrity (pure, deterministic).
 *
 * Validates that every citation the answer makes refers to a source that was
 * ACTUALLY retrieved by the research pipeline. Detects:
 *   - [n] references outside the evidence set
 *   - bare URLs in the answer that were never retrieved (fabricated links)
 *   - answers that cite nothing despite evidence being provided
 *
 * The model cannot mint evidence here: anything not present in the
 * EvidencePack is flagged, not rendered as a source.
 */
import type { EvidenceSource } from '@/lib/research/pipeline'

/** Minimal source shape citation auditing needs (id + url). The full
 * EvidenceSource (and the UI's EvidenceSourceView) are structurally
 * compatible, so both work without casts. */
export interface CitableSource {
  id: number
  url: string
}

export interface CitationAudit {
  /** [n] references found in the answer text. */
  referencedIds: number[]
  /** [n] references that point to a source NOT in the evidence pack. */
  invalidIds: number[]
  /** URLs appearing in the answer that were never retrieved. */
  fabricatedUrls: string[]
  /** Sources actually cited (subset of the evidence pack). */
  usedSources: CitableSource[]
  /** True when evidence existed but the answer cites nothing. */
  uncitedEvidence: boolean
}

/** Extract citation markers like [1], [2,3], [1] [4] from the answer. */
export function extractCitationIds(answer: string): number[] {
  const ids = new Set<number>()
  const re = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(answer)) !== null) {
    for (const part of m[1].split(',')) {
      const n = Number(part.trim())
      if (Number.isInteger(n) && n >= 1 && n <= 99) ids.add(n)
    }
  }
  return [...ids].sort((a, b) => a - b)
}

/** Extract http(s) URLs from the answer text (excluding markdown link targets). */
export function extractUrls(answer: string): string[] {
  const urls = new Set<string>()
  // markdown links: [text](url) — target captured in group 1
  const mdRe = /\]\((https?:\/\/[^\s)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(answer)) !== null) urls.add(m[1])
  // bare URLs not already captured as markdown targets
  const bareRe = /(^|[\s(])(https?:\/\/[^\s)<>"']+)/g
  while ((m = bareRe.exec(answer)) !== null) {
    const url = m[2].replace(/[.,;:!?]+$/, '')
    urls.add(url)
  }
  return [...urls]
}

function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    const norm = (u: URL) => `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
    return norm(ua) === norm(ub)
  } catch {
    return a === b
  }
}

export function auditCitations(answer: string, sources: readonly CitableSource[]): CitationAudit {
  const referencedIds = extractCitationIds(answer)
  const validIdSet = new Set(sources.map((s) => s.id))
  const invalidIds = referencedIds.filter((id) => !validIdSet.has(id))

  const answerUrls = extractUrls(answer)
  const fabricatedUrls = answerUrls.filter((u) => !sources.some((s) => sameUrl(s.url, u)))

  const usedSources = sources.filter((s) => referencedIds.includes(s.id))
  const citedSomething = referencedIds.length > 0 || (answerUrls.length > 0 && fabricatedUrls.length < answerUrls.length)
  const uncitedEvidence = sources.length > 0 && !citedSomething

  return { referencedIds, invalidIds, fabricatedUrls, usedSources, uncitedEvidence }
}

/**
 * Produce the final source list for the UI: only sources genuinely cited,
 * or the full evidence set when the model cited by URL instead of [n].
 * Fabricated URLs are never included.
 */
export function buildRenderableSources(answer: string, sources: readonly CitableSource[]): CitableSource[] {
  const audit = auditCitations(answer, sources)
  if (audit.usedSources.length > 0) return audit.usedSources
  // URL-style citations: match sources whose URL appears in the answer.
  const byUrl = sources.filter((s) => extractUrls(answer).some((u) => sameUrl(u, s.url)))
  if (byUrl.length > 0) return byUrl
  return []
}

/** Remove fabricated bare URLs (never-retrieved links) from the answer. */
export function stripFabricatedUrls(answer: string, sources: readonly CitableSource[]): { text: string; removed: string[] } {
  const removed: string[] = []
  let text = answer
  for (const url of extractUrls(answer)) {
    if (!sources.some((s) => sameUrl(s.url, url))) {
      // remove markdown links to fabricated targets entirely
      const mdRe = new RegExp(`\\[[^\\]]*\\]\\(${escapeRegExp(url)}\\)`, 'g')
      text = text.replace(mdRe, '')
      text = text.replace(new RegExp(escapeRegExp(url), 'g'), '')
      removed.push(url)
    }
  }
  return { text, removed }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
