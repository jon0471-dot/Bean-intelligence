/**
 * BEAN Intelligence — evidence ranking (pure, deterministic).
 *
 * Source-preference order (documented in the RIISHE product spec):
 *   1. official government / institutional sources for their own records
 *   2. primary technical documentation
 *   3. original research / primary documents
 *   4. multiple independent reputable sources for contested claims
 *   5. reputable secondary sources otherwise
 *
 * Ranking combines: provider rank, domain-authority signals, date freshness
 * and snippet/query term overlap. All signals are deterministic and logged
 * with the evidence; none are invented.
 */
import type { WebSearchResult } from './provider'

export type SourceType = 'official' | 'reference' | 'news' | 'social' | 'other'

export interface RankedSource {
  id: number // 1-based citation id used in prompts and the UI
  url: string
  title: string
  snippet: string
  hostName: string
  /** Provider date string (unparsed, as supplied) or null. */
  date: string | null
  /** 0..1 freshness score when a date could be parsed; null when unknown. */
  freshness: number | null
  /** Parsed year when available (detects stale pages presented as current). */
  year: number | null
  /** 0..1 domain-authority heuristic. */
  authority: number
  /** True when the host is a government/institutional domain. */
  official: boolean
  /** True for social-media hosts (treated as low-trust for facts). */
  social: boolean
  /** Coarse source class used for ranking and UI labeling. */
  sourceType: SourceType
  score: number
}

// Domains whose own records are authoritative for their own announcements.
// Includes national second-level government domains (gov.in etc.) — police
// and state-government statements for incidents in India live there.
const OFFICIAL_SUFFIXES = [
  '.gov',
  '.gov.uk',
  '.gov.in',
  '.gov.au',
  '.govt.nz',
  '.gc.ca',
  '.nic.in',
  '.europa.eu',
  '.un.org',
  '.who.int',
  '.edu',
  '.ac.uk',
]

// Standards bodies and primary documentation hosts.
const PRIMARY_HOSTS = [
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'developer.apple.com',
  'learn.microsoft.com',
  'docs.microsoft.com',
  'cloud.google.com',
  'docs.aws.amazon.com',
  'arxiv.org',
  'doi.org',
  'nature.com',
  'science.org',
  'ieee.org',
  'acm.org',
  'w3.org',
  'ietf.org',
  'rfc-editor.org',
]

const REPUTABLE_HOSTS = [
  'reuters.com',
  'apnews.com',
  'afp.com',
  'bbc.com',
  'bbc.co.uk',
  'economist.com',
  'ft.com',
  'nytimes.com',
  'theguardian.com',
  'wsj.com',
  'bloomberg.com',
  'npr.org',
  'wikipedia.org',
  'nature.com',
  'scientificamerican.com',
  'stanford.edu',
  'mit.edu',
  'harvard.edu',
  // Established Indian outlets (national + widely-cited regional) —
  // incident coverage for Indian topics is usually broken there first.
  'thehindu.com',
  'indianexpress.com',
  'hindustantimes.com',
  'ndtv.com',
  'timesofindia.indiatimes.com',
  'deccanherald.com',
  'newindianexpress.com',
  'deccanchronicle.com',
  'tribuneindia.com',
  'thehindubusinessline.com',
  'ptinews.com',
  'ani.in',
  'dinamalar.com',
  'dailythanthi.com',
  'dinakaran.com',
  'oneindia.com',
  'mathrubhumi.com',
  'malayala.manoramaonline.com',
  'eenadu.net',
  'sakshi.com',
  'prabhanews.com',
]

// Social platforms: user-generated speculation, not reporting. For facts
// about identifiable people they are last-resort sources only.
export const SOCIAL_HOSTS = [
  'twitter.com',
  'x.com',
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'quora.com',
  't.me',
  'telegram.me',
  'whatsapp.com',
  'linkedin.com',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
]

function hostMatches(host: string, entries: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return entries.some((e) => h === e || h.endsWith(`.${e}`))
}

export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return OFFICIAL_SUFFIXES.some((s) => (s.startsWith('.') ? h === s.slice(1) || h.endsWith(s) : h === s || h.endsWith(`.${s}`)))
}

export function isSocialHost(host: string): boolean {
  return hostMatches(host, SOCIAL_HOSTS)
}

/** Coarse source class for ranking, prompts and UI labels. */
export function classifyHost(host: string): { official: boolean; social: boolean; sourceType: SourceType } {
  if (isOfficialHost(host)) return { official: true, social: false, sourceType: 'official' }
  if (isSocialHost(host)) return { official: false, social: true, sourceType: 'social' }
  if (hostMatches(host, ['wikipedia.org', 'britannica.com', 'wikidata.org'])) {
    return { official: false, social: false, sourceType: 'reference' }
  }
  if (hostMatches(host, REPUTABLE_HOSTS)) return { official: false, social: false, sourceType: 'news' }
  return { official: false, social: false, sourceType: 'other' }
}

export function authorityScore(host: string): number {
  if (isOfficialHost(host)) return 1
  if (hostMatches(host, PRIMARY_HOSTS)) return 0.9
  if (hostMatches(host, REPUTABLE_HOSTS)) return 0.75
  if (isSocialHost(host)) return 0.2
  return 0.4
}

/** Parse a provider date string into {year, ageDays} when possible. */
export function parseSourceDate(raw: string | null): { year: number | null; ageDays: number | null } {
  if (!raw) return { year: null, ageDays: null }
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? Number(yearMatch[0]) : null
  let ageDays: number | null = null
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) {
    ageDays = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
  }
  return { year, ageDays }
}

export function freshnessScore(ageDays: number | null): number | null {
  if (ageDays === null) return null
  if (ageDays <= 7) return 1
  if (ageDays <= 30) return 0.9
  if (ageDays <= 90) return 0.75
  if (ageDays <= 365) return 0.5
  if (ageDays <= 730) return 0.3
  return 0.1
}

/** Lowercase word-overlap between the query and title+snippet. */
function relevanceScore(query: string, result: { title: string; snippet: string }): number {
  const stop = new Set([
    'the', 'a', 'an', 'of', 'is', 'are', 'was', 'were', 'in', 'on', 'for', 'to', 'and',
    'what', 'who', 'when', 'which', 'how', 'does', 'do', 'did', 'current', 'latest',
  ])
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !stop.has(t))
  if (terms.length === 0) return 0
  const hay = `${result.title} ${result.snippet}`.toLowerCase()
  const hits = terms.filter((t) => hay.includes(t)).length
  return hits / terms.length
}

/** Exact-URL dedup with near-dup collapse (same host + path minus query). */
export function dedupByUrl(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Map<string, WebSearchResult>()
  for (const r of results) {
    let key = r.url
    try {
      const u = new URL(r.url)
      u.hash = ''
      u.search = ''
      key = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
    } catch {
      // keep raw url as key
    }
    const existing = seen.get(key)
    if (!existing || r.snippet.length > existing.snippet.length) seen.set(key, r)
  }
  return [...seen.values()]
}

export interface RankOptions {
  /** When true, freshness carries extra weight (freshness-sensitive query). */
  freshnessMatters: boolean
  limit: number
}

/**
 * Merge, dedup, score and select the final evidence set. Citation ids are
 * assigned 1..n by final score order — the SAME ids the model must use when
 * citing, and the same ids rendered in the UI.
 */
export function rankSources(query: string, results: WebSearchResult[], opts: RankOptions): RankedSource[] {
  const deduped = dedupByUrl(results)
  const scored = deduped.map((r) => {
    const { year, ageDays } = parseSourceDate(r.date)
    const fresh = freshnessScore(ageDays)
    const cls = classifyHost(r.hostName)
    const authority = authorityScore(r.hostName)
    const relevance = relevanceScore(query, r)
    const providerRankScore = Math.max(0, 1 - Math.log2(1 + Math.max(0, r.rank - 1)) / 4)
    const freshnessWeight = opts.freshnessMatters ? 0.35 : 0.1
    const score =
      0.3 * relevance +
      0.25 * authority +
      freshnessWeight * (fresh ?? 0.35) + // unknown date scores conservatively
      0.15 * providerRankScore +
      (cls.official ? 0.08 : 0)
    return {
      id: 0,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      hostName: r.hostName,
      date: r.date,
      freshness: fresh,
      year,
      authority,
      official: cls.official,
      social: cls.social,
      sourceType: cls.sourceType,
      score,
    } satisfies RankedSource
  })

  scored.sort((a, b) => b.score - a.score)
  const selected = scored.slice(0, Math.max(1, opts.limit))
  return selected.map((s, i) => ({ ...s, id: i + 1 }))
}

export interface StalenessOptions {
  /** The question demands recent reporting (incident or freshness signal). */
  timeSensitive?: boolean
}

/**
 * Detect stale or undated evidence for a time-sensitive question.
 *
 * Returns a warning string for the verification summary when:
 *  - no retrieved source states ANY publication date (freshness unverifiable), or
 *  - the newest dated source predates the current year, or
 *  - the question is time-sensitive and the newest dated source is older
 *    than ~30 days (older reporting may no longer describe the present
 *    state — the answer must not claim "latest" beyond its evidence).
 */
export function stalenessWarning(ranked: RankedSource[], opts: StalenessOptions = {}): string | null {
  if (ranked.length === 0) return null
  const dated = ranked.filter((r) => r.year !== null)
  if (dated.length === 0) {
    return 'No retrieved source states a publication date; freshness could not be verified.'
  }
  const currentYear = new Date().getFullYear()
  const newest = Math.max(...dated.map((r) => r.year as number))
  if (newest < currentYear) {
    return `Newest retrieved source is dated ${newest}; the question is time-sensitive, so the answer may be out of date.`
  }
  if (opts.timeSensitive) {
    const ages = dated.map((r) => parseSourceDate(r.date).ageDays).filter((a): a is number => a !== null)
    if (ages.length > 0) {
      const newestAge = Math.min(...ages)
      if (newestAge > 30) {
        return `Newest retrieved source is ~${newestAge} days old; no newer coverage was found in this search, so the current status may have changed.`
      }
    }
  }
  return null
}
