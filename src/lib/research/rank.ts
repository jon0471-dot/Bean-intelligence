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
import { geoTermsOf, textMentionsTerm } from './geo'

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
  /** True when the host is a social/video platform (provenance labeling + demotion). */
  social: boolean
  /** Coarse source class used for ranking and UI labeling. */
  sourceType: SourceType
  score: number
}

// User-generated / social platforms: real posts exist, but as EVIDENCE for
// current-events claims they are weak (measured: Facebook posts about the
// Gingee case outranked nothing useful and carried no dates). Video
// platforms are included too: a playlist/watch page is an aggregation of
// clips, not a verifiable report (measured: a News18 YouTube playlist ranked
// [2] for the Gingee case with no date and no readable content).
const UGC_HOSTS = [
  'facebook.com', 'm.facebook.com', 'x.com', 'twitter.com', 'instagram.com',
  'tiktok.com', 'reddit.com', 'threads.net', 'quora.com', 'pinterest.com',
  'whatsapp.com', 'telegram.me', 'linkedin.com',
  'youtube.com', 'youtu.be', 'm.youtube.com', 'vimeo.com', 'dailymotion.com',
]

// Domains whose own records are authoritative for their own announcements.
// Includes national second-level government domains (gov.in etc.) — police
// and state-government statements for incidents in India live there.
const OFFICIAL_SUFFIXES = [
  '.gov',
  '.gov.in',
  '.nic.in',
  '.gov.uk',
  '.gov.au',
  '.govt.nz',
  '.gc.ca',
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
  'nextjs.org',
  'react.dev',
  'vuejs.org',
  'angular.dev',
  'svelte.dev',
  'vitejs.dev',
  'npmjs.com',
  'github.com',
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
  'thefederal.com',
  'thewire.in',
  'scroll.in',
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
  return hostMatches(host, UGC_HOSTS)
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

/**
 * A result whose TITLE is itself a (truncated) URL — the measured shape of
 * social reposts ("https://www.dtnext.in/news/tamilnadu/suspect-in-tn-girls…").
 * Rendered as-is it is garbage in the Sources section; rewritten honestly as
 * a social post pointing at the linked article's host.
 */
export function cleanSourceTitle(title: string, hostName: string): string {
  const t = title.trim()
  if (!/^https?:\/\//i.test(t)) return title
  let linkedHost = ''
  try {
    linkedHost = new URL(t).hostname.replace(/^www\./, '')
  } catch {
    // truncated URL may not parse — fall through with no linked host
  }
  return linkedHost && linkedHost !== hostName.replace(/^www\./, '')
    ? `Social media post linking to ${linkedHost}`
    : `Social media post on ${hostName.replace(/^www\./, '')}`
}

export function authorityScore(host: string): number {
  if (isOfficialHost(host)) return 1
  if (hostMatches(host, PRIMARY_HOSTS)) return 0.9
  if (hostMatches(host, REPUTABLE_HOSTS)) return 0.75
  if (hostMatches(host, UGC_HOSTS)) return 0.2
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

/** Extra penalty for a high-risk (news) result older than 45/120 days. */
export function staleNewsPenalty(ageDays: number | null, freshnessMatters: boolean): number {
  if (!freshnessMatters || ageDays === null) return 0
  if (ageDays > 120) return 0.22
  if (ageDays > 45) return 0.1
  return 0
}

/**
 * Social-evidence demotion for freshness-sensitive (news) queries: social and
 * video platforms are LAST-RESORT evidence for current events (no dates, no
 * editorial verification, mixed provenance — measured: an undated Facebook
 * post about a DIFFERENT missing girl ranked inside the Gingee evidence set).
 * Stacked on the low authority score so UGC survives only when nothing
 * credible was retrieved.
 */
export function ugcNewsPenalty(hostName: string, freshnessMatters: boolean): number {
  return freshnessMatters && isSocialHost(hostName) ? 0.12 : 0
}

/**
 * Geographic-relevance penalty: when the topic carries location terms, a
 * result that mentions NONE of them is probably about a different place
 * (measured failure: a US missing-person article ranked for an Indian case).
 * The penalty is decisive, not cosmetic — it pushes unrelated results out of
 * the evidence set and out of page reads. Mention checks are
 * punctuation-insensitive (work-order defect: "Next.js" in a result never
 * matched the extracted term "nextjs", so relevant software results were
 * penalized for a software query).
 */
export function geoMismatchPenalty(
  query: string,
  result: { title: string; snippet: string },
  freshnessMatters: boolean,
): number {
  const terms = geoTermsOf(query)
  if (terms.length === 0) return 0
  const hay = `${result.title} ${result.snippet}`
  const mentioned = terms.some((t) => textMentionsTerm(hay, t))
  return mentioned ? 0 : freshnessMatters ? 0.24 : 0.12
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

/** Normalized title key for syndication/copy detection (host-independent). */
function normalizedTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Merge, dedup, score and select the final evidence set. Citation ids are
 * assigned 1..n by final score order — the SAME ids the model must use when
 * citing, and the same ids rendered in the UI.
 *
 * Deduplication is two-layer: exact canonical-URL dedup (same page listed
 * twice) AND syndication collapse — a verbatim-titled copy of the same story
 * on another host (measured: thesamaja.com copying ThePrint's Gingee article
 * title word-for-word) is the SAME reporting, not independent confirmation,
 * so only the higher-scoring copy survives into the evidence set.
 */
export function rankSources(query: string, results: WebSearchResult[], opts: RankOptions): RankedSource[] {
  const deduped = dedupByUrl(results)
  const scored = deduped.map((r) => {
    const { year, ageDays } = parseSourceDate(r.date)
    const fresh = freshnessScore(ageDays)
    const authority = authorityScore(r.hostName)
    const relevance = relevanceScore(query, r)
    const providerRankScore = Math.max(0, 1 - Math.log2(1 + Math.max(0, r.rank - 1)) / 4)
    const freshnessWeight = opts.freshnessMatters ? 0.35 : 0.1
    const geoPenalty = geoMismatchPenalty(query, r, opts.freshnessMatters)
    const stalePenalty = staleNewsPenalty(ageDays, opts.freshnessMatters)
    const ugcPenalty = ugcNewsPenalty(r.hostName, opts.freshnessMatters)
    const score =
      0.3 * relevance +
      0.25 * authority +
      freshnessWeight * (fresh ?? 0.35) - // unknown date scores conservatively
      geoPenalty -
      stalePenalty -
      ugcPenalty +
      0.15 * providerRankScore +
      (isOfficialHost(r.hostName) ? 0.08 : 0)
    return {
      id: 0,
      url: r.url,
      title: cleanSourceTitle(r.title, r.hostName),
      snippet: r.snippet,
      hostName: r.hostName,
      date: r.date,
      freshness: fresh,
      year,
      authority,
      official: isOfficialHost(r.hostName),
      social: isSocialHost(r.hostName),
      sourceType: classifyHost(r.hostName).sourceType,
      score,
    } satisfies RankedSource
  })

  scored.sort((a, b) => b.score - a.score)
  // Syndication collapse: identical normalized titles across DIFFERENT hosts
  // are one story — keep the first (higher-scoring) copy only.
  const seenTitles = new Set<string>()
  const unique: typeof scored = []
  for (const s of scored) {
    const key = normalizedTitleKey(s.title)
    if (key.length >= 12 && seenTitles.has(key)) continue
    if (key.length >= 12) seenTitles.add(key)
    unique.push(s)
  }
  const selected = unique.slice(0, Math.max(1, opts.limit))
  return selected.map((s, i) => ({ ...s, id: i + 1 }))
}

/**
 * Detect a likely stale evidence set: the selected sources are older than
 * the current year. When the question is genuinely freshness-sensitive this
 * warns the answer may be out of date; when it is not (a historical question),
 * the phrasing is informational only — old sources are correct for old events.
 */
export function stalenessWarning(ranked: RankedSource[], freshnessMatters = false): string | null {
  if (ranked.length === 0) return null
  const dated = ranked.filter((r) => r.year !== null)
  // (undated handled separately by the orchestrator's undated-cited note)
  if (dated.length === 0) {
    return freshnessMatters
      ? 'No retrieved source states a publication date; freshness could not be verified.'
      : null
  }
  const currentYear = new Date().getFullYear()
  const newest = Math.max(...dated.map((r) => r.year as number))
  if (newest < currentYear) {
    return freshnessMatters
      ? `Newest retrieved source is dated ${newest}; the question is time-sensitive, so the answer may be out of date.`
      : `Newest retrieved source is dated ${newest} — older reporting; label it as background, not the latest news.`
  }
  return null
}
