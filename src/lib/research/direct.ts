/**
 * BEAN Intelligence — INDEPENDENT retrieval lane (no shared LLM gateway).
 *
 * Why this exists (measured failure): live research previously depended
 * EXCLUSIVELY on the authorized gateway's `functions` endpoint class
 * (web_search + page_reader). That class is throttled separately from chat,
 * and its 429 windows last minutes — during one, every current-fact question
 * degraded to "could not verify" model-only answers even though perfectly
 * permitted, key-free official sources were reachable directly (Wikipedia
 * MediaWiki API 0.1–0.8s, nodejs.org release feed, pmindia.gov.in,
 * whitehouse.gov measured live).
 *
 * This lane retrieves evidence WITHOUT the gateway:
 *   - directFetch: plain bounded HTTP GET of an official primary source with
 *     the same HTML→text + error-page rejection rules as the gateway reader;
 *   - Wikipedia MediaWiki API: key-free permitted search + article extracts
 *     + infobox wikitext fields (incumbent/term-start) — real page content,
 *     not snippets;
 *   - deterministic official-source candidates per current-fact question
 *     class (official release feeds, government pages).
 *
 * Honesty contract: every result carries a URL actually fetched and text
 * actually extracted from it. Failures are typed errors recorded by the
 * pipeline — never fabricated results, never guessed content. Nothing here
 * touches the gateway, so a 429 window cannot starve it.
 */
import { htmlToText, extractPublishedTime, ResearchToolError, type WebSearchResult } from './provider'

/** Overall wall-time budget for one independent-lane run (brief: 3–8s discovery). */
export const DIRECT_LANE_BUDGET_MS = 8_000
/** Per-request cap for one direct fetch / API call. */
export const DIRECT_FETCH_TIMEOUT_MS = 6_000
/** Body-size cap for direct fetches (protects memory, keeps latency bounded). */
const DIRECT_MAX_BYTES = 1_200_000

export interface DirectPage {
  url: string
  title: string
  /** Cleaned text actually extracted from the fetched page. */
  text: string
  publishedTime: string | null
  /** Structured facts parsed from the page (e.g. Wikipedia infobox fields). */
  facts?: Record<string, string>
  /** Where this page came from — provenance for the evidence pack. */
  origin: 'wikipedia-api' | 'official-site' | 'official-feed'
}

export interface DirectOutcome {
  /** Search-style results (real URLs + real text) mergeable into the pipeline. */
  results: WebSearchResult[]
  /** Full-page evidence for the same URLs (pageRead=true, excerpt=text). */
  pages: DirectPage[]
  /** Honest provenance notes for the evidence pack. */
  notes: string[]
}

// ---------------------------------------------------------------------------
// Direct fetch
// ---------------------------------------------------------------------------

const DIRECT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) BEANResearch/1.0'

export interface DirectFetchResult {
  finalUrl: string
  status: number
  title: string
  text: string
  publishedTime: string | null
}

/**
 * Wikimedia User-Agent policy (measured live: a bare/browser UA 403s from
 * this runtime; a UA identifying the client with contact info + the
 * Api-User-Agent header is accepted). Used for Wikipedia API calls.
 */
const WIKI_POLICY_HEADERS = {
  'user-agent': 'BEANResearch/1.0 (BEAN assistant research lane; contact: ops@bean.local) userinfo',
  'api-user-agent': 'BEANResearch/1.0 (BEAN assistant research lane; contact: ops@bean.local)',
}

/**
 * Plain bounded HTTP GET — completely independent of the gateway. Throws
 * ResearchToolError('direct_fetch') on every failure mode (invalid URL,
 * non-2xx, timeout, empty/error body). No retries here: the caller owns the
 * time budget and the fallback chain.
 */
export async function directFetch(
  url: string,
  timeoutMs = DIRECT_FETCH_TIMEOUT_MS,
  extraHeaders: Record<string, string> = {},
): Promise<DirectFetchResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ResearchToolError('direct_fetch', `Invalid URL: ${url.slice(0, 100)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ResearchToolError('direct_fetch', 'Only http(s) URLs are supported.')
  }
  const t0 = Date.now()
  let res: Response
  try {
    // Wikimedia properties reject generic client UAs (measured: HTTP 403
    // from this runtime) — apply the policy-compliant headers for their
    // hosts on every direct fetch, not just the API calls.
    const host = parsed.hostname
    const policy = /(^|\.)wikipedia\.org$/.test(host) || /(^|\.)wikimedia\.org$/.test(host) || /(^|\.)wiktionary\.org$/.test(host)
      ? WIKI_POLICY_HEADERS
      : {}
    res = await fetch(parsed.toString(), {
      headers: {
        'user-agent': DIRECT_UA,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...policy,
        ...extraHeaders,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new ResearchToolError('direct_fetch', `direct fetch of ${parsed.host} failed after ${Date.now() - t0}ms: ${reason.slice(0, 160)}`)
  }
  if (!res.ok) {
    throw new ResearchToolError('direct_fetch', `direct fetch of ${parsed.host} returned HTTP ${res.status}`)
  }
  const len = Number(res.headers.get('content-length') ?? '0')
  if (len > DIRECT_MAX_BYTES * 4) {
    throw new ResearchToolError('direct_fetch', `direct fetch of ${parsed.host}: body too large (${len} bytes)`)
  }
  const raw = await res.text().catch((e: unknown) => {
    throw new ResearchToolError('direct_fetch', `direct fetch of ${parsed.host}: body read failed: ${e instanceof Error ? e.message : 'error'}`)
  })
  const body = raw.slice(0, DIRECT_MAX_BYTES)
  const isJson = (res.headers.get('content-type') ?? '').includes('json') || /^\s*[[{]/.test(body.slice(0, 20))
  const title = isJson ? '' : (/<title[^>]*>([^<]{1,300})<\/title>/i.exec(body)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const text = isJson ? body : htmlToText(body)
  return {
    finalUrl: res.url || parsed.toString(),
    status: res.status,
    title,
    text,
    publishedTime: isJson ? null : extractPublishedTime(body),
  }
}

// ---------------------------------------------------------------------------
// Page-content validation (shared with the pipeline's gateway page reads —
// pipeline.ts re-exports these, keeping a single source of truth).
// ---------------------------------------------------------------------------

export const PAGE_ERROR_SIGNATURES: RegExp[] = [
  /err[_-]blocked[_-]by[_-]client/i,
  /this page has been blocked/i,
  /\b404\b\s*(not found)?\b/i,
  /page not found/i,
  /access (denied|forbidden)/i,
  /enable javascript/i,
  /sign in to confirm/i,
  /just a moment\.{3,}/i,
  /checking your browser/i,
  /attention required/i,
  /unusual traffic from your computer/i,
  /are you a robot/i,
  /consent\.youtube\.com/i,
]
export const PAGE_MIN_USEFUL_CHARS = 200

export function isUsablePageText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < PAGE_MIN_USEFUL_CHARS) return false
  const head = trimmed.slice(0, 400)
  return !PAGE_ERROR_SIGNATURES.some((re) => re.test(head))
}

// ---------------------------------------------------------------------------
// Wikipedia MediaWiki API (key-free, permitted, measured 0.1–0.8s live)
// ---------------------------------------------------------------------------

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

async function wikiApiGet(params: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const url = `${WIKI_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString()}`
  const res = await directFetch(url, timeoutMs, WIKI_POLICY_HEADERS)
  try {
    return JSON.parse(res.text)
  } catch {
    throw new ResearchToolError('direct_fetch', `Wikipedia API returned malformed JSON for: ${String(params.titles ?? params.srsearch ?? '').slice(0, 80)}`)
  }
}

function wikiArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

/** Real Wikipedia search via the MediaWiki API → pipeline-compatible results. */
export async function wikipediaSearch(query: string, num = 3, timeoutMs = DIRECT_FETCH_TIMEOUT_MS): Promise<WebSearchResult[]> {
  const data = (await wikiApiGet({ action: 'query', list: 'search', srsearch: query.slice(0, 300), srlimit: String(Math.min(Math.max(1, num), 10)) }, timeoutMs)) as {
    query?: { search?: Array<{ title?: unknown; snippet?: unknown; timestamp?: unknown }> }
  }
  const hits = data?.query?.search ?? []
  return hits
    .filter((h) => typeof h.title === 'string' && h.title.length > 0)
    .map((h, i) => ({
      url: wikiArticleUrl(h.title as string),
      title: h.title as string,
      snippet: typeof h.snippet === 'string' ? htmlToText(h.snippet).slice(0, 600) : '',
      hostName: 'en.wikipedia.org',
      rank: i + 1,
      // The MediaWiki search API's timestamp field proved to be page-age
      // (creation-era) rather than content currency in live measurement
      // ("C. Joseph Vijay" reported 2004 while describing the 2026
      // incumbency) — surfacing it as the source date would poison freshness
      // ranking. Date=null; currency comes from the article's own content
      // (extract + infobox) fetched in wikipediaArticleEvidence.
      date: null,
    }))
}

/** Strip common wikitext markup from an infobox field value (no invention). */
export function cleanWikiFieldValue(raw: string): string {
  return raw
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/>]*\/>/gi, '')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?([^']+?)'''?/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse a template-parameter line out of section-0 wikitext. Exported pure
 * for unit testing. Only EXPLICIT keys are extracted — never guessed.
 */
export function extractInfoboxFields(wikitext: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const re = new RegExp(`\\|\\s*${key}\\s*=\\s*(.+)`, 'i')
    const m = re.exec(wikitext)
    if (m) {
      const value = cleanWikiFieldValue(m[1])
      if (value.length > 0 && value.length <= 400) out[key] = value
    }
  }
  return out
}

const INFOBOX_FACT_KEYS = ['incumbent', 'took_office', 'term_start', 'assumed_office', 'appointment', 'latest_release_version', 'latest_release_date'] as const

/**
 * Article evidence for ONE known Wikipedia title: intro plain-text extract
 * (real page content) + section-0 infobox fields (incumbent/term-start).
 */
export async function wikipediaArticleEvidence(title: string, timeoutMs = DIRECT_FETCH_TIMEOUT_MS): Promise<DirectPage> {
  const [extractData, wikitextData] = await Promise.all([
    wikiApiGet({ action: 'query', prop: 'extracts', explaintext: '1', exintro: '1', titles: title, redirects: '1' }, timeoutMs),
    wikiApiGet({ action: 'parse', page: title, prop: 'wikitext', section: '0', redirects: '1' }, timeoutMs),
  ])
  const extract = (extractData as { query?: { pages?: Array<{ extract?: unknown; title?: unknown }> } })?.query?.pages?.[0]
  const text = typeof extract?.extract === 'string' ? extract.extract : ''
  const resolvedTitle = typeof extract?.title === 'string' ? extract.title : title
  // formatversion=2 shape: action=parse returns `wikitext` as a PLAIN STRING
  // (measured live); older shapes nested it under { '*' } / { content }.
  const rawWiki = (wikitextData as { parse?: { wikitext?: unknown } })?.parse?.wikitext
  const wikitext = typeof rawWiki === 'string' ? rawWiki : typeof (rawWiki as { content?: unknown } | null)?.content === 'string' ? (rawWiki as { content: string }).content : ''
  const facts = typeof wikitext === 'string' ? extractInfoboxFields(wikitext, INFOBOX_FACT_KEYS) : {}
  // Structured infobox facts go FIRST: the solver prompt truncates excerpts
  // (measured: a 1200-char slice cut the incumbent line off a 4000-char
  // extract and the model claimed the evidence "does not provide the name").
  // The extract is background; the facts are the answer-bearing payload.
  const body = [
    ...Object.entries(facts).map(([k, v]) => `${k}: ${v}`),
    text.slice(0, 4_000),
  ]
    .filter((p) => p.length > 0)
    .join('\n')
  if (body.trim().length === 0) {
    throw new ResearchToolError('direct_fetch', `Wikipedia article "${title}" returned no extract content`)
  }
  return {
    url: wikiArticleUrl(resolvedTitle),
    title: resolvedTitle,
    text: body,
    publishedTime: null,
    facts,
    origin: 'wikipedia-api',
  }
}

// ---------------------------------------------------------------------------
// Deterministic official-source candidates per current-fact question class
// ---------------------------------------------------------------------------

interface OfficialCandidate {
  kind: 'url' | 'node-feed'
  url: string
  label: string
}

/**
 * Bounded map from question wording to OFFICIAL primary sources worth
 * fetching directly (all verified reachable from this deployment; failures
 * degrade honestly). Wikipedia coverage is handled generically by
 * wikipediaSearch — this table adds the government/vendor primary pages.
 * Deliberately small: each candidate costs ≤ DIRECT_FETCH_TIMEOUT_MS.
 */
export function officialDirectCandidates(message: string): OfficialCandidate[] {
  const m = message.toLowerCase()
  const candidates: OfficialCandidate[] = []
  const mentionsNodeVersion = /\bnode\.?js?\b/.test(m) && /\b(version|release|stable|lts|update)\b/.test(m)
  if (mentionsNodeVersion) {
    candidates.push({ kind: 'node-feed', url: 'https://nodejs.org/dist/index.json', label: 'Node.js official release index' })
  }
  if (/\bpresident\b/.test(m) && /\b(united states|usa|u\.s\.|us|america)\b/.test(m)) {
    candidates.push({ kind: 'url', url: 'https://www.whitehouse.gov/', label: 'The White House (official)' })
  }
  if (/\bprime minister\b/.test(m) && /\bindia\b/.test(m)) {
    candidates.push({ kind: 'url', url: 'https://www.pmindia.gov.in/en/', label: 'Prime Minister of India (official)' })
  }
  if (/\b(chief minister|\bcm\b)\b/.test(m) && /\btamil\s?nadu\b/.test(m)) {
    candidates.push({ kind: 'url', url: 'https://www.tn.gov.in/minister_list.php', label: 'Government of Tamil Nadu council of ministers (official)' })
  }
  // Government-announcement questions: the state's own portal is the FIRST
  // candidate, but it is unreachable from some deployments (measured:
  // tn.gov.in times out). The Press Information Bureau — the Government of
  // India's nodal agency for disseminating government announcements,
  // including state-level ones — is the official fallback and is reachable.
  if (
    /\b(announcement|announced|press\s+release|notification|order|scheme|tender)\b/.test(m) &&
    /\b(government|govt|gov|official|website|portal)\b/.test(m) &&
    /\btamil\s?nadu\b/.test(m)
  ) {
    candidates.unshift({ kind: 'url', url: 'https://www.tn.gov.in/', label: 'Government of Tamil Nadu portal (official)' })
    candidates.push({ kind: 'url', url: 'https://pib.gov.in/AllReleasem.aspx?MenuId=3', label: 'Press Information Bureau, Government of India (official releases)' })
  } else if (
    /\b(announcement|announced|press\s+release|notification|order|scheme|tender)\b/.test(m) &&
    /\b(government|govt|gov|official)\b/.test(m) &&
    /\b(india|indian)\b/.test(m)
  ) {
    candidates.push({ kind: 'url', url: 'https://pib.gov.in/AllReleasem.aspx?MenuId=3', label: 'Press Information Bureau, Government of India (official releases)' })
  }
  return candidates.slice(0, 3)
}

/**
 * Latest stable line from the official Node.js release feed (real data):
 * newest entry whose version carries no pre-release suffix ("-" tag).
 * Exported pure for unit testing.
 */
export function latestStableNodeRelease(feed: Array<{ version?: unknown; date?: unknown; lts?: unknown }>): { version: string; date: string; lts: string | boolean } | null {
  for (const entry of feed) {
    if (typeof entry?.version !== 'string' || !entry.version.startsWith('v')) continue
    if (entry.version.includes('-')) continue // pre-release (alpha/rc/nightly)
    return {
      version: entry.version,
      date: typeof entry.date === 'string' ? entry.date : '',
      lts: typeof entry.lts === 'string' || typeof entry.lts === 'boolean' ? entry.lts : false,
    }
  }
  return null
}

/** Turn the official Node release feed into one evidence page (real data). */
async function nodeFeedEvidence(timeoutMs: number): Promise<DirectPage> {
  const res = await directFetch('https://nodejs.org/dist/index.json', timeoutMs)
  let feed: Array<{ version?: unknown; date?: unknown; lts?: unknown }> = []
  try {
    feed = JSON.parse(res.text)
  } catch {
    throw new ResearchToolError('direct_fetch', 'Node.js release feed returned malformed JSON')
  }
  if (!Array.isArray(feed) || feed.length === 0) {
    throw new ResearchToolError('direct_fetch', 'Node.js release feed returned no entries')
  }
  const stable = latestStableNodeRelease(feed)
  if (!stable) throw new ResearchToolError('direct_fetch', 'Node.js release feed contained no stable release entry')
  const newest = feed[0]
  const lines = [
    `Official Node.js release index (nodejs.org/dist/index.json), fetched live ${new Date().toISOString().slice(0, 10)}:`,
    `Newest release line: ${String(newest.version)} (${String(newest.date)})${newest.lts ? `, LTS "${String(newest.lts)}"` : ', Current line (no LTS status)'}.`,
    `Latest stable (non-pre-release) release: ${stable.version} (${stable.date})${stable.lts ? `, LTS line "${String(stable.lts)}"` : ', Current line'}.`,
  ]
  return {
    url: 'https://nodejs.org/dist/index.json',
    title: 'Node.js official release index',
    text: lines.join(' '),
    publishedTime: stable.date || null,
    facts: { latest_stable: `${stable.version} (${stable.date})` },
    origin: 'official-feed',
  }
}

// ---------------------------------------------------------------------------
// Orchestrated independent-lane run
// ---------------------------------------------------------------------------

async function settled(p: Promise<DirectPage>): Promise<{ ok: true; page: DirectPage } | { ok: false; error: string }> {
  try {
    return { ok: true, page: await p }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * One full independent-lane run for a question: Wikipedia search → top
 * article evidence (extract + infobox) → deterministic official candidates.
 * Every step bounded; overall budget DIRECT_LANE_BUDGET_MS; failures are
 * recorded as notes, never thrown past this boundary, never fabricated.
 */
export async function runDirectRetrieval(message: string, budgetMs = DIRECT_LANE_BUDGET_MS): Promise<DirectOutcome> {
  const t0 = Date.now()
  const notes: string[] = []
  const pages: DirectPage[] = []
  const results: WebSearchResult[] = []
  const left = () => Math.max(0, budgetMs - (Date.now() - t0))

  // 1. Wikipedia search for the core topic (one bounded call).
  let searchHits: WebSearchResult[] = []
  try {
    searchHits = await withBudget(wikipediaSearch(message, 3), left())
    if (searchHits.length > 0) {
      results.push(...searchHits)
      notes.push(`independent search (Wikipedia MediaWiki API): ${searchHits.length} result(s) for "${message.slice(0, 60)}"`)
    }
  } catch (e) {
    notes.push(`independent search failed: ${e instanceof Error ? e.message : 'unavailable'}`)
  }

  // 2. Article evidence for the top titles (extract + infobox fields).
  const titles = searchHits.slice(0, 2).map((h) => h.title)
  if (titles.length > 0 && left() > 500) {
    const articles = await Promise.all(titles.map((t) => settled(wikipediaArticleEvidence(t, Math.min(left(), DIRECT_FETCH_TIMEOUT_MS)))))
    articles.forEach((a, i) => {
      if (a.ok) {
        pages.push(a.page)
        const factLine = Object.entries(a.page.facts ?? {}).map(([k, v]) => `${k}="${v}"`).join(', ')
        notes.push(`independent page evidence (Wikipedia API): "${a.page.title}"${factLine ? ` — ${factLine.slice(0, 200)}` : ''}`)
      } else {
        notes.push(`independent article evidence failed for "${titles[i].slice(0, 60)}": ${a.error}`)
      }
    })
  }

  // 3. Deterministic official candidates (government pages / official feeds).
  const candidates = officialDirectCandidates(message)
  if (candidates.length > 0 && left() > 500) {
    const fetched = await Promise.all(
      candidates.map((c) =>
        settled(c.kind === 'node-feed' ? nodeFeedEvidence(Math.min(left(), DIRECT_FETCH_TIMEOUT_MS)) : officialPageEvidence(c.url, c.label, Math.min(left(), DIRECT_FETCH_TIMEOUT_MS))),
      ),
    )
    fetched.forEach((f, i) => {
      if (f.ok) {
        pages.push(f.page)
        // A direct official fetch is BOTH a search result and page content —
        // snippet comes from the ACTUAL fetched text (never a search-engine
        // snippet presented as page content).
        results.push({
          url: f.page.url,
          title: f.page.title,
          snippet: f.page.text.slice(0, 600),
          hostName: safeHost(f.page.url),
          rank: results.length + 1,
          date: f.page.publishedTime,
        })
        notes.push(`independent official source fetched: ${f.page.title} (${safeHost(f.page.url)})`)
      } else {
        notes.push(`independent official source failed: ${candidates[i].label}: ${f.error}`)
      }
    })
  }

  return { results, pages, notes }
}

/** Fetch one official page and package it as DirectPage evidence. */
async function officialPageEvidence(url: string, label: string, timeoutMs: number): Promise<DirectPage> {
  const res = await directFetch(url, timeoutMs)
  if (!isUsablePageText(res.text)) {
    throw new ResearchToolError('direct_fetch', `official page ${safeHost(url)} returned no usable content`)
  }
  return {
    url: res.finalUrl,
    title: res.title || label,
    text: res.text.slice(0, 6_000),
    publishedTime: res.publishedTime,
    origin: 'official-site',
  }
}

/** Reject with a typed timeout error when the lane exceeds its budget. */
async function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) throw new ResearchToolError('direct_fetch', 'independent retrieval budget exhausted')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResearchToolError('direct_fetch', `independent retrieval timed out after ${ms}ms budget`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Direct-fetch fallback for a URL the gateway page-reader failed on. Same
 * validation rules as the pipeline's page reads; returns page content only
 * when it is genuinely usable.
 */
export async function directFetchPage(url: string, timeoutMs = DIRECT_FETCH_TIMEOUT_MS): Promise<DirectPage> {
  const res = await directFetch(url, timeoutMs)
  if (!isUsablePageText(res.text)) {
    throw new ResearchToolError('direct_fetch', `direct fetch returned an error or unusable page for ${safeHost(url)}`)
  }
  return {
    url: res.finalUrl,
    title: res.title || res.finalUrl,
    text: res.text.slice(0, 6_000),
    publishedTime: res.publishedTime,
    origin: 'official-site',
  }
}

/**
 * Resolve an aggregator redirect wrapper (e.g. google.com/goto?...) to its
 * REAL destination URL (measured live: the TN CM question's top gateway
 * result was an opaque /goto link that 302s to the OFFICIAL
 * tn.gov.in/minister_list.php). The redirect chain is followed for real and
 * only the final URL is used — the destination is never guessed. Returns the
 * original URL unchanged when the host is not a redirect wrapper, on
 * failure, or on timeout (bounded — resolution must not add real latency).
 */
const REDIRECT_WRAPPER_RE = /(^|\.)(google\.com|news\.google\.com)$/i

export function isRedirectWrapperUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (!REDIRECT_WRAPPER_RE.test(u.hostname)) return false
    return u.pathname.startsWith('/goto') || u.pathname.startsWith('/news/') || u.pathname === '/url'
  } catch {
    return false
  }
}

export async function resolveRedirectUrl(url: string, timeoutMs = 4_000): Promise<string> {
  if (!isRedirectWrapperUrl(url)) return url
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': DIRECT_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    // The body is irrelevant — only the resolved destination matters. Cancel
    // it immediately so the resolution costs no more than the redirect chain.
    try {
      await res.body?.cancel()
    } catch {
      /* body already consumed or unavailable — the URL is what we came for */
    }
    if (res.url && res.url !== url && !REDIRECT_WRAPPER_RE.test(safeHost(res.url))) {
      return res.url
    }
    return url
  } catch {
    return url // honest fallback: keep the original (still real) URL
  }
}
