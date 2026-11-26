/**
 * BEAN Intelligence — M42 universal web research: official security-advisory
 * and community-platform adapters (direct lane).
 *
 * ONE decision record per adapter (spec §13 M42.3):
 *
 *  - OSV.dev (api.osv.dev) — open security-vulnerability database from
 *    Google/OSV ecosystem aggregating GHSA/CVE/PyAdvisory/pip-audit data.
 *    API: official public JSON, no credentials, no key, no cost. Terms per
 *    osv.dev; attribution preserved through source records. Rate limits are
 *    generous but undocumented — bounded to one call per research run with
 *    an 8s timeout. Fields (id/aliases/summary/modified/published/severity)
 *    pass through EXACTLY as supplied; missing fields stay null.
 *    Two actions: GET /v1/vulns/{id} for a specific CVE/GHSA id, and
 *    POST /v1/query for package-scoped advisories (the only official way to
 *    enumerate advisories for an ecosystem/package pair).
 *
 *  - Stack Exchange (api.stackexchange.com) — official public API v2.3.
 *    No key: shared per-IP quota measured in the coverage doc (300/day/IP
 *    documented by Stack Apps); ONE bounded search call per research run,
 *    8s timeout. Community/UGC content: EVERY record is labeled
 *    user-generated — evidence of experience, never sole authority for a
 *    technical claim (spec §4 Tier B). Attribution: Stack Exchange requires
 *    linking back to the source page — the record URL does that. Titles are
 *    HTML-escaped by the API and decoded here with a bounded entity map
 *    (never a full HTML parser on untrusted input). Fields as supplied.
 *
 *  - Hacker News (hn.algolia.com) — the public HN Search API by Algolia
 *    (the search backend behind HN's own search box). Official, no
 *    credentials, no key, no cost, documented rate limits (10k/hr measured
 *    in the coverage doc); ONE bounded search call per research run, 8s
 *    timeout. Community/UGC: same labeling discipline as Stack Exchange.
 *    Fields as supplied.
 *
 * All adapters are SERVER-ONLY and pass through the SAME shared boundaries
 * as the academic lane: the exported host allowlist guard below (structural
 * SSRF bound) AND `guardedFetch`'s DNS/redirect revalidation. A failure is
 * honest: typed errors degrade into the calling lane's notes — one
 * platform's failure never disables the others.
 */

import { assertPublicHttpUrl, guardedFetch } from './reach/url-safety'
import { ResearchToolError } from './provider'
import type { RankedSource } from './rank'

/** Fixed host allowlist — a redirect to any other host invalidates the item. */
export const SECURITY_COMMUNITY_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'api.osv.dev',
  'api.stackexchange.com',
  'hn.algolia.com',
])

const LANE_UA = 'BEAN-Research/1.0 (universal reference access; respectful pooled use)'

interface LaneItem {
  url: string
  title: string
  snippet: string
  hostName: string
  rank: number
  date: string | null
  author: string | null
  /** true = user-generated content (community claims, never sole authority). */
  community: boolean
}

/** THE runtime host guard every adapter call passes through before any I/O. */
export async function assertSecurityCommunityHostAllowed(url: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ResearchToolError('direct_fetch', `invalid security/community API URL: ${url.slice(0, 80)}`)
  }
  if (parsed.protocol !== 'https:' || !SECURITY_COMMUNITY_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ResearchToolError('direct_fetch', `security/community adapter host not allowlisted: ${parsed.hostname}`)
  }
  return parsed.toString()
}

function boundedText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

async function fetchJson(guarded: string, timeoutMs: number, method: 'GET' | 'POST', body?: string): Promise<unknown> {
  const fetched = await guardedFetch(guarded, {
    timeoutMs,
    method,
    ...(body ? { body } : {}),
    headers: {
      'user-agent': LANE_UA,
      accept: 'application/json',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (!fetched.res.ok) {
    throw new ResearchToolError('direct_fetch', `security/community fetch of ${hostOf(guarded)} returned HTTP ${fetched.res.status}`)
  }
  const text = await fetched.res.text().catch(() => {
    throw new ResearchToolError('direct_fetch', `body read failed from ${hostOf(guarded)}`)
  })
  if (!text || text.length === 0) {
    throw new ResearchToolError('direct_fetch', `empty response from ${hostOf(guarded)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ResearchToolError('direct_fetch', `unparseable JSON from ${hostOf(guarded)}`)
  }
}

// ---------------------------------------------------------------------------
// OSV.dev — security advisories (official public API, no credentials)
// ---------------------------------------------------------------------------

/** Advisory ids this lane recognizes: CVE, GHSA, and OSV ids. */
export const ADVISORY_ID_RE = /\b(CVE-\d{4}-\d{4,7}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|OSV-[A-Z]+-\d+)\b/i

export async function osvVulnById(id: string, timeoutMs = 8_000): Promise<LaneItem | null> {
  const clean = id.trim().toUpperCase().slice(0, 40)
  const guarded = await assertSecurityCommunityHostAllowed(`https://api.osv.dev/v1/vulns/${encodeURIComponent(clean)}`)
  const data = (await fetchJson(guarded, timeoutMs, 'GET')) as Record<string, unknown>
  return mapOsvVuln(data)
}

/** PURE mapper — fields exactly as the OSV record supplies them; never invented. */
export function mapOsvVuln(data: Record<string, unknown>): LaneItem | null {
  const vulnId = boundedText(data.id, 60)
  if (!vulnId) return null
  const aliases = Array.isArray(data.aliases) ? (data.aliases as unknown[]).map((a) => boundedText(a, 40)).filter((v): v is string => !!v).slice(0, 4) : []
  const summary = boundedText(data.summary, 300) ?? boundedText(data.details, 300)
  const severity = Array.isArray(data.severity) && typeof data.severity[0] === 'object'
    ? boundedText((data.severity[0] as Record<string, unknown>).score, 40)
    : typeof data.database_specific === 'object' && data.database_specific !== null
      ? boundedText((data.database_specific as Record<string, unknown>).severity, 40)
      : null
  return {
    url: `https://osv.dev/vulnerability/${vulnId}`,
    title: `${vulnId}${aliases.length ? ` (aka ${aliases.join(', ')})` : ''}`,
    snippet: `official security advisory${summary ? ` — ${summary}` : ''}${severity ? ` [severity: ${severity}]` : ''}`,
    hostName: 'osv.dev',
    rank: 1,
    date: boundedText(data.modified, 30) ?? boundedText(data.published, 30),
    author: null,
    community: false,
  }
}

export async function osvPackageAdvisories(pkg: string, ecosystem: 'npm' | 'PyPI', timeoutMs = 8_000): Promise<LaneItem[]> {
  const name = pkg.trim().slice(0, 120)
  if (!name) return []
  const guarded = await assertSecurityCommunityHostAllowed('https://api.osv.dev/v1/query')
  const data = (await fetchJson(guarded, timeoutMs, 'POST', JSON.stringify({ package: { name, ecosystem } }))) as { vulns?: Array<Record<string, unknown>> }
  return mapOsvPackageVulns(data, name, ecosystem)
}

/** PURE mapper — at most 3 advisories, ids/aliases/dates exactly as supplied. */
export function mapOsvPackageVulns(data: { vulns?: Array<Record<string, unknown>> }, name: string, ecosystem: 'npm' | 'PyPI'): LaneItem[] {
  const vulns = Array.isArray(data.vulns) ? data.vulns.slice(0, 3) : []
  return vulns.map((v, i) => {
    const vulnId = boundedText(v.id, 60) ?? 'unknown advisory'
    const aliases = Array.isArray(v.aliases) ? (v.aliases as unknown[]).map((a) => boundedText(a, 40)).filter((x): x is string => !!x).slice(0, 3) : []
    const summary = boundedText(v.summary, 260) ?? boundedText(v.details, 260)
    return {
      url: `https://osv.dev/vulnerability/${vulnId}`,
      title: `${name} (${ecosystem}): ${vulnId}${aliases.length ? ` (aka ${aliases.join(', ')})` : ''}`,
      snippet: `official security advisory${summary ? ` — ${summary}` : ''}`,
      hostName: 'osv.dev',
      rank: i + 1,
      date: boundedText(v.modified, 30) ?? boundedText(v.published, 30),
      author: null,
      community: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Stack Exchange — community Q&A (official API v2.3, UGC labeling)
// ---------------------------------------------------------------------------

/** Bounded entity decode for the API's HTML-escaped titles (fixed map only). */
export function decodeStackExchangeTitle(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:x27|39);/g, "'")
    .replace(/&#[xX]?[0-9a-fA-F]+;/g, '') // drop anything outside the fixed map — never guess
}

export async function stackExchangeSearch(query: string, timeoutMs = 8_000, rows = 3): Promise<LaneItem[]> {
  const url =
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance` +
    `&q=${encodeURIComponent(query.slice(0, 180))}&site=stackoverflow&pagesize=${Math.min(Math.max(rows, 1), 4)}`
  const guarded = await assertSecurityCommunityHostAllowed(url)
  const data = (await fetchJson(guarded, timeoutMs, 'GET')) as { items?: Array<Record<string, unknown>>, backoff?: number, error_message?: string }
  if (typeof data.error_message === 'string') {
    throw new ResearchToolError('direct_fetch', `stack exchange API error: ${data.error_message.slice(0, 120)}`)
  }
  return mapStackExchangeResponse(data, query)
}

/** PURE mapper — community records; the UGC label lives in the snippet itself. */
export function mapStackExchangeResponse(data: { items?: Array<Record<string, unknown>> }, query: string): LaneItem[] {
  const items = data.items ?? []
  return items.map((it, i) => {
    const title = decodeStackExchangeTitle(boundedText(it.title, 240) ?? 'Untitled question')
    const link = boundedText(it.link, 300) ?? `https://stackoverflow.com/search?q=${encodeURIComponent(query.slice(0, 60))}`
    const score = typeof it.score === 'number' ? it.score : null
    const answers = typeof it.answer_count === 'number' ? it.answer_count : null
    const answered = it.is_answered === true
    const owner = (it.owner && typeof it.owner === 'object' ? (it.owner as Record<string, unknown>).display_name : null) as string | null
    const created = typeof it.creation_date === 'number' ? new Date(it.creation_date * 1000).toISOString() : null
    return {
      url: link,
      title,
      snippet: `community Q&A (user-generated) — score ${score ?? 'n/a'}, ${answers ?? '?'} answer(s), ${answered ? 'has an accepted/answer' : 'no accepted answer'}${created ? `, asked ${created.slice(0, 10)}` : ''}`,
      hostName: 'stackoverflow.com',
      rank: i + 1,
      date: created,
      author: boundedText(owner, 60),
      community: true,
    }
  })
}

// ---------------------------------------------------------------------------
// Hacker News — community discussion (official Algolia HN Search API)
// ---------------------------------------------------------------------------

export async function hackerNewsSearch(query: string, timeoutMs = 8_000, rows = 3): Promise<LaneItem[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query.slice(0, 180))}&tags=story&hitsPerPage=${Math.min(Math.max(rows, 1), 4)}`
  const guarded = await assertSecurityCommunityHostAllowed(url)
  const data = (await fetchJson(guarded, timeoutMs, 'GET')) as { hits?: Array<Record<string, unknown>> }
  return mapHackerNewsResponse(data, query)
}

/** PURE mapper — community records; missing url falls back to the item page. */
export function mapHackerNewsResponse(data: { hits?: Array<Record<string, unknown>> }, query: string): LaneItem[] {
  const hits = data.hits ?? []
  return hits.map((h, i) => {
    const title = boundedText(h.title, 240) ?? boundedText(h.story_title, 240) ?? 'Untitled discussion'
    const link = boundedText(h.url, 300)
      ?? (boundedText(h.objectID, 20) ? `https://news.ycombinator.com/item?id=${boundedText(h.objectID, 20)}` : null)
      ?? `https://hn.algolia.com/?q=${encodeURIComponent(query.slice(0, 60))}`
    const points = typeof h.points === 'number' ? h.points : null
    const comments = typeof h.num_comments === 'number' ? h.num_comments : null
    return {
      url: link,
      title,
      snippet: `community discussion (user-generated) — ${points ?? '?'} point(s), ${comments ?? '?'} comment(s) on Hacker News`,
      hostName: 'news.ycombinator.com',
      rank: i + 1,
      date: boundedText(h.created_at, 25),
      author: boundedText(h.author, 60),
      community: true,
    }
  })
}

// ---------------------------------------------------------------------------
// Dispatch — which adapters does this query deserve? (deterministic, bounded)
// ---------------------------------------------------------------------------

const SECURITY_PKG_RE = /\b(vulnerab\w*|cve|security|insecure|exploit|injection|prototype pollution|advisories|dependenc(?:y|ies) (?:audit|vulnerab))\b/i
const STACKEXCHANGE_RE = /\b(stack\s?overflow|stack\s?exchange|accepted answer|q&a on stackoverflow)\b/i
const HACKERNEWS_RE = /\b(hacker\s?news|show\s+hn\b|ask\s+hn\b|news\.ycombinator)\b/i

/** Deterministic package-name candidates for advisory queries (bounded). */
function advisoryCandidates(query: string): Array<{ pkg: string; ecosystem: 'npm' | 'PyPI' }> {
  const out: Array<{ pkg: string; ecosystem: 'npm' | 'PyPI' }> = []
  const scoped = query.match(/@[\w-]+\/[\w.-]+/g)
  if (scoped) out.push({ pkg: scoped[0], ecosystem: 'npm' })
  if (/\bnpm\b/i.test(query) && !scoped) {
    const m = query.match(/\b(?:package|module|library|dependency)\s+["'“]?([a-z][\w.-]{1,80})["'”]?/i)
    if (m) out.push({ pkg: m[1], ecosystem: 'npm' })
  }
  if (/\bpypi|pip\b/i.test(query)) {
    const m = query.match(/\b(?:package|module|library|dependency)\s+["'“]?([a-z][\w.-]{1,80})["'“]?/i)
      ?? query.match(/\bpip (?:install|show)\s+([\w.-]+)/i)
    if (m) out.push({ pkg: m[1], ecosystem: 'PyPI' })
  }
  return out.slice(0, 2)
}

/** PURE classification — the ranking-pool record a lane item becomes. */
export function toRankedSource(item: LaneItem): RankedSource {
  return {
    id: 0,
    url: item.url,
    title: item.title,
    snippet: item.snippet,
    hostName: item.hostName,
    date: item.date,
    freshness: null,
    year: item.date ? Number(item.date.slice(0, 4)) || null : null,
    authority: item.community ? 0.45 : 0.85,
    official: !item.community,
    social: item.community,
    sourceType: item.community ? 'community' : 'official',
    ...(item.author ? { author: item.author } : {}),
    score: item.community ? 0.4 : 0.7,
  }
}

/** PURE dispatch plan — which adapters does this query deserve (names only, no I/O). */
export function planAttempts(query: string): string[] {
  const names: string[] = []
  if (ADVISORY_ID_RE.test(query)) names.push('osv-by-id')
  if (SECURITY_PKG_RE.test(query)) {
    for (const c of advisoryCandidates(query).slice(0, 1)) names.push(`osv-package(${c.ecosystem})`)
  }
  if (STACKEXCHANGE_RE.test(query)) names.push('stackexchange')
  if (HACKERNEWS_RE.test(query)) names.push('hackernews')
  return names
}

/**
 * Run the security/community lane for a query when its shape deserves it.
 * NEVER throws — per-adapter failures degrade into the notes array.
 * Evidence enters the SAME ranking pool as gateway results (provenance
 * engine 'direct'; community records keep social=true + bounded snippets).
 */
export async function runSecurityCommunityLane(
  query: string,
  opts: { userId: string | null; budgetMs?: number } = { userId: null },
): Promise<{ results: RankedSource[]; notes: string[]; adaptersUsed: string[] }> {
  const notes: string[] = []
  const adaptersUsed: string[] = []
  const budgetMs = opts.budgetMs ?? 10_000
  const t0 = Date.now()
  const out: RankedSource[] = []

  const attempts: Array<{ name: string; run: () => Promise<LaneItem[]> }> = []

  const advisoryId = query.match(ADVISORY_ID_RE)
  if (advisoryId) {
    attempts.push({ name: 'osv-by-id', run: () => osvVulnById(advisoryId[0]).then((r) => (r ? [r] : [])) })
  }
  if (SECURITY_PKG_RE.test(query)) {
    for (const c of advisoryCandidates(query).slice(0, 1)) {
      attempts.push({ name: `osv-package(${c.ecosystem})`, run: () => osvPackageAdvisories(c.pkg, c.ecosystem) })
    }
  }
  if (STACKEXCHANGE_RE.test(query)) {
    attempts.push({ name: 'stackexchange', run: () => stackExchangeSearch(query) })
  }
  if (HACKERNEWS_RE.test(query)) {
    attempts.push({ name: 'hackernews', run: () => hackerNewsSearch(query) })
  }
  if (attempts.length === 0) return { results: [], notes, adaptersUsed }

  for (const attempt of attempts) {
    if (Date.now() - t0 > budgetMs) {
      notes.push(`security/community lane: budget exhausted before ${attempt.name}`)
      continue
    }
    try {
      const items = await attempt.run()
      adaptersUsed.push(attempt.name)
      for (const item of items) {
        out.push(toRankedSource(item))
      }
    } catch (e) {
      notes.push(`security/community lane ${attempt.name}: ${e instanceof Error ? e.message.slice(0, 120) : 'unavailable'}`)
    }
  }
  if (out.some((r) => r.social)) {
    notes.push('security/community lane: Stack Exchange / Hacker News results are USER-GENERATED — corroborate important claims with official sources')
  }
  return { results: out, notes, adaptersUsed }
}
