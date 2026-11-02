/**
 * BEAN Intelligence — research pipeline.
 *
 * Understand -> Retrieve: generates refined queries ONLY for complex or
 * compound questions (one fast LLM call, zod-validated — SKIPPED for
 * straightforward single-question lookups, where the user's own question is
 * already the strongest query), runs REAL web searches, dedups/ranks evidence
 * and reads top pages ONLY when the snippets alone would be over-interpreted.
 *
 * Latency design (measured evidence in worklog):
 *  - straightforward current-fact questions go straight to search with ONE
 *    strong query (no semantic-routing model call);
 *  - near-duplicate queries collapse before dispatch (no redundant searches);
 *  - search/page results are cached briefly with freshness-aware TTLs
 *    (research/cache.ts) and cache hits keep their ORIGINAL fetch time;
 *  - full-page retrieval happens only for sources whose snippet is too thin
 *    to ground the answer, or when snippets are missing entirely;
 *  - a provider failure or empty result triggers EXACTLY ONE bounded
 *    same-query retry (measured: the provider intermittently 422s queries it
 *    serves seconds later) — never an unbounded loop.
 *
 * Honesty contract: the returned EvidencePack contains only sources actually
 * retrieved by the provider (or served from a cache of a real provider
 * response). Failures degrade honestly (reported in `degraded`) — the
 * pipeline never invents or retries indefinitely.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { z } from 'zod'
import { webSearch, readPage, WebSearchResult, PageContent, ResearchToolError } from './provider'
import { rankSources, stalenessWarning, RankedSource, parseSourceDate } from './rank'
import type { SearchDecision } from './policy'
import { getSearchCache, getPageCache } from './cache'
import { fastPathQueryVariants, regionContextFor, geoTermsOf, placeKeysOf, textMentionsTerm } from './geo'
import { isOngoingCaseQuery } from './policy'
import { coreTopic, detectSensitiveCase } from './sensitive'
import { isPrimaryHost } from './rank'
import { extractDatelineFromText } from './provider'
import { UpstreamRateLimitError } from '@/lib/upstream/gateway'

const queriesSchema = z.object({
  queries: z.array(z.string().min(3).max(300)).min(1).max(3),
})

interface QueryGenCompletion {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export interface EvidenceSource extends RankedSource {
  /** Whether the full page (not just the snippet) was read. */
  pageRead: boolean
  /** Excerpt used as grounding when the page was read. */
  excerpt: string | null
}

export interface EvidencePack {
  sources: EvidenceSource[]
  queries: string[]
  degraded: string[]
  staleness: string | null
  /** Set when the topic named a place but NO selected source mentions it. */
  geoWarning: string | null
  durationMs: number
  /** Wall time spent inside provider search calls (parallel, cache-aware). */
  searchMs: number
  /** Wall time spent in full-page fetches (parallel, cache-aware). */
  pageReadMs: number
  /** How many provider searches actually ran (cache hits excluded). */
  searchCalls: number
  /** How many full-page reads actually ran (cache hits excluded). */
  pageReadCalls: number
  /** True when the ranked evidence came from a cache of a real fetch. */
  cacheHits: number
  /** ISO time of the ORIGINAL fetch backing this pack (cache-aware). */
  fetchedAt: string
}

const QUERY_SYSTEM =
  'You generate concise web search queries for a fact-checking pipeline. ' +
  'Given a user question, output 1-3 search queries that would surface authoritative, current sources. ' +
  'Prefer the exact entities, names, versions or dates involved. No explanations.'

/**
 * Straightforward-question detector: when the message is a short,
 * single-question lookup, the user's own wording IS the strong query and the
 * query-refinement model call is pure added latency. Complex, compound or
 * long questions still get refinement.
 */
export function isStraightforwardQuestion(message: string): boolean {
  const text = message.trim()
  if (text.length === 0 || text.length > 140) return false
  // Multiple sentences (excluding a single trailing '?') suggest compound asks.
  const sentences = text.replace(/[?!.]+\s*$/, '').split(/[?!.]\s+/).filter((s) => s.trim().length > 0)
  if (sentences.length > 1) return false
  // Comparison openers are compound by nature ("Compare X and Y", "X vs Y").
  if (/^(compare|difference|differences|which\s+is\s+better)\b/i.test(text)) return false
  // Multi-part coordination: multiple "and"/"or", or a conjunction followed
  // by another question word ("X and what changed in Y").
  if (/\b(and|or)\b/i.test(text) && (text.match(/\b(and|or)\b/gi) ?? []).length > 1) return false
  if (/\b(and|or)\s+(what|how|why|when|who|where|which)\b/i.test(text)) return false
  return true
}

/** Generate 1-3 refined search queries with a fast LLM call; falls back to the raw message. */
export async function generateQueries(message: string, risk: SearchDecision): Promise<{ queries: string[]; usedFallback: boolean }> {
  const fallback = { queries: [truncateQuery(message)], usedFallback: true }
  try {
    const zai = await ZAI.create()
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: QUERY_SYSTEM },
          {
            role: 'user',
            content:
              `Question: ${message.slice(0, 2000)}\n` +
              `Freshness: ${risk.risk}${risk.recencyDays ? ` (results should be from the last ~${risk.recencyDays} days)` : ''}\n` +
              'Respond with JSON only: {"queries": ["...", "..."]}',
          },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('query-gen timeout')), 6_000)),
    ])
    const content = (completion as QueryGenCompletion).choices?.[0]?.message?.content ?? ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback
    const parsed = queriesSchema.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) return fallback
    return { queries: parsed.data.queries.slice(0, 3), usedFallback: false }
  } catch {
    return fallback
  }
}

function truncateQuery(message: string): string {
  const q = message.replace(/\s+/g, ' ').trim()
  return q.length <= 280 ? q : `${q.slice(0, 277)}...`
}

/**
 * Strip directive scaffolding the user wrapped around a lookup so the search
 * provider receives the SUBJECT, not the imperative. Measured failure class
 * (worklog): "Research a current topic: Gingee girl missing" searched (and
 * would have searched) for the literal sentence including the prefix.
 * Applied ONLY on the fast path; complex questions get LLM refinement.
 */
export function toSearchQuery(message: string): string {
  let q = message.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i += 1) {
    const next = q
      .replace(/^(?:please\s+)?(?:kindly\s+)?(?:research|search(?:\s+(?:the\s+web|the\s+internet|online))?(?:\s+for)?|google|look\s+up|lookup|find(?:\s+out)?|check(?:\s+online)?|browse)\b[\s:,-]*/i, '')
      .replace(/^(?:a\s+|an\s+|the\s+)?(?:current|recent|latest|breaking)\s+(?:topic|topics|news|story|stories|event|events|affairs?|developments?)\s*[:\-—]\s*/i, '')
      .replace(/\s*(?:right\s+now|as\s+of\s+(?:now|today)|these\s+days)\s*[?!.]*\s*$/i, '')
      .trim()
    if (next === q || next.length === 0) break
    q = next
  }
  return q.length > 0 ? (q.length <= 280 ? q : `${q.slice(0, 277)}...`) : truncateQuery(message)
}

/**
 * True when a freshness-sensitive (news) query deserves ONE bounded follow-up
 * search for newer reporting: every selected source is either undated or the
 * newest dated source is older than `staleDays` (default 45). Older reporting
 * still ranks — as background, never presented as the latest development.
 * Version/release questions pass a TIGHTER window (measured failure: the
 * Next.js turn's newest source was 39 days old, under the 45-day default, so
 * no follow-up ran and a 12-month-old third-party post was presented as the
 * current release — a software project's release cadence is 1–3 weeks).
 */
export function needsFreshnessFollowUp(ranked: RankedSource[], staleDays = 45): boolean {
  if (ranked.length === 0) return false
  const ages = ranked.map((r) => parseSourceDate(r.date).ageDays).filter((a): a is number => a !== null)
  if (ages.length === 0) return true
  return Math.min(...ages) > staleDays
}

/** Build the bounded follow-up query used to hunt for newer reporting. */
export function buildFollowUpQuery(baseQuery: string): string {
  const base = baseQuery.replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${base} latest news update`
}

/**
 * Deterministic query additions for measured retrieval-failure classes
 * (2026-11-02 eval). Each addition is bounded (total ≤ 5 queries), skipped
 * when an existing query already targets the intent, and anchored on the
 * question's OWN entities — no memorized answers:
 *
 *  (a) TITLED WORK — "the movie Scene" must search the EXACT title (quoted)
 *      plus release/cast intent, so the evidence contains the actual film
 *      instead of a similarly-titled substitute the model improvised.
 *  (b) ENTITY DEVELOPMENTS — "latest developments from NVIDIA" gets one
 *      official-announcement query so the company's own newsroom surfaces.
 *  (c) VERSION/RELEASE — "latest stable version of Next.js" gets an
 *      official-release-notes query; third-party posts lag real releases.
 *  (d) OFFICEHOLDER OATH DATES — "when did they take office" gets an
 *      oath/sworn-date query; announcement and publication dates otherwise
 *      dominate the results and the exact event day goes unverified.
 */
export function buildDeterministicQuerySet(message: string, queries: string[]): { queries: string[]; added: string[] } {
  const added: string[] = []
  const next = [...queries]
  const push = (q: string | null): void => {
    if (!q) return
    const t = truncateQuery(q)
    if (next.some((e) => e.toLowerCase() === t.toLowerCase())) return
    added.push(t)
    next.push(t)
  }
  const existing = next.join(' \n ').toLowerCase()

  // (a) Titled work: quoted title OR "<kind> <Capitalized Title>".
  const quoted = message.match(/["“]([\p{L}\p{N}][^"”]{1,48})["”]/u)
  const kindTitle = message.match(
    /\b(movie|film|series|album|song|game|novel|book)\s+([\p{Lu}][\p{L}\p{N}'&.:\-]*(?:\s+[\p{Lu}][\p{L}\p{N}'&.:\-]*)?)/u,
  )
  const title = (quoted?.[1] ?? kindTitle?.[2] ?? '').trim().replace(/[.:,'\-–—]+$/, '').trim()
  const kind = (kindTitle?.[1] ?? 'movie').trim()
  if (title && /\b(movie|film|series|album|song|game|novel|book|cast|hero|villain|actor|actress|release)\b/i.test(message)) {
    push(`"${title}" ${kind} release cast details`)
  }

  // (b) Entity's latest developments → official announcement sources.
  const devEntity = message.match(
    /\b(?:latest|recent|newest)\s+(?:developments?|announcements?|updates?|news)\s+(?:from|at|about|on|of|for)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*)?)/,
  )
  if (devEntity && !/\b(official|newsroom|announcement)\b/.test(existing)) {
    push(`${devEntity[1].trim()} official announcement newsroom`)
  }

  // (c) Software version/release → official release notes.
  if (/\bversion\b/i.test(message) || /\brelease\b/i.test(message)) {
    const before = message.match(/\b([A-Z][\w.+#\-]*(?:\s?[A-Z][\w.+#\-]*)?)\s+(?:version|release)/)
    const after = message.match(/\bversion\s+(?:of\s+)?([A-Z][\w.+#\-]*(?:\s?[A-Z][\w.+#\-]*)?)/)
    const product = (after?.[1] ?? before?.[1] ?? '').trim()
    if (product && !/\b(release notes|changelog|official)\b/.test(existing)) {
      push(`${product} official release notes changelog`)
    }
  }

  // (d) Officeholder oath/appointment date.
  if (
    /\b(chief minister|prime minister|president|governor|chief justice|mayor)\b/i.test(message) &&
    /\b(oath|sworn|took office|take office|taking office|appointed)\b/i.test(message) &&
    !/\b(oath|sworn)\b/i.test(existing)
  ) {
    const core = coreTopic(message)
    push(core ? `${core} oath sworn in date official` : null)
  }

  return { queries: next.slice(0, 5), added }
}

/**
 * Age in days of the NEWEST dated source (null when none carry a parseable
 * date). Used by the ongoing-case follow-up trigger below.
 */
export function newestSourceAgeDays(ranked: RankedSource[]): number | null {
  const ages = ranked
    .map((r) => parseSourceDate(r.date).ageDays)
    .filter((a): a is number => a !== null)
  return ages.length > 0 ? Math.min(...ages) : null
}
/** Collapse near-duplicate queries (normalized word-set equality) before dispatch. */
export function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const q of queries) {
    const key = q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').sort().join(' ')
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}

/**
 * Sensitive-case deterministic query set (work order: prioritize official
 * police/government statements AND search for newer reporting before
 * summarizing an ongoing case). Added on top of the policy/LLM queries and
 * BEFORE dedupe so near-duplicates collapse; bounded so a sensitive turn
 * never fans out unbounded searches.
 *
 * Returns the (possibly re-anchored) query list plus the freshness query
 * actually appended (for the honest degraded note), or null.
 */
export function buildSensitiveQuerySet(
  message: string,
  queries: string[],
): { queries: string[]; addedFreshnessQuery: string | null; addedOfficialQuery: string | null } {
  const sensitive = detectSensitiveCase(message)
  if (!sensitive.sensitive) return { queries, addedFreshnessQuery: null, addedOfficialQuery: null }
  const core = coreTopic(message) ?? queries[0] ?? null
  if (!core) return { queries, addedFreshnessQuery: null, addedOfficialQuery: null }
  const next = [...queries]
  // Anchor the set to the core topic when the generated queries drifted.
  const coreKey = core.toLowerCase().slice(0, 24)
  if (!next.some((q) => q.toLowerCase().includes(coreKey))) {
    next.unshift(truncateQuery(core))
  }
  const lowerJoined = next.join(' \n ').toLowerCase()
  const freshnessQuery = truncateQuery(`${core} latest update`)
  const officialQuery = truncateQuery(`${core} police official statement`)
  let addedFreshnessQuery: string | null = null
  let addedOfficialQuery: string | null = null
  // Skip an extra when an existing query ALREADY targets that intent —
  // near-duplicate searches burn the (rate-limited) gateway for nothing.
  const targetsFreshness = /\b(latest|newest|update|updates|today|now)\b/i.test(lowerJoined)
  const targetsOfficial = /\b(police|official|government|statement|cb-cid|cbcid)\b/i.test(lowerJoined)
  if (!targetsFreshness) {
    next.push(freshnessQuery)
    addedFreshnessQuery = freshnessQuery
  }
  if (!targetsOfficial) {
    next.push(officialQuery)
    addedOfficialQuery = officialQuery
  }
  return { queries: next.slice(0, 5), addedFreshnessQuery, addedOfficialQuery }
}

export interface RunResearchOptions {
  maxSources?: number
  /** How many top sources to read in full (0 disables page reading). */
  readTopN?: number
}

/**
 * Decide how many top-ranked pages to read in full. Snippets that already
 * carry substantial grounded text make page retrieval pure added latency;
 * thin snippets (or high-risk questions where snippet over-interpretation is
 * likely) justify reading the source. Ongoing-case questions get one extra
 * read: identifying details (names, dates, statuses) in snippets are
 * frequently wrong or compressed — the work order requires verifying the
 * article's actual content, and for an evolving case the cost is bounded.
 */
export function decidePageReads(
  ranked: RankedSource[],
  decision: SearchDecision,
  opts: RunResearchOptions,
  ongoingCase = false,
): number {
  const configured =
    opts.readTopN ??
    (decision.risk === 'high' ? (ongoingCase ? 3 : 2) : decision.risk === 'moderate' ? 1 : 0)
  const count = Math.min(Math.max(0, configured), ranked.length)
  if (count === 0) return 0
  // Snippet sufficiency: if every page we WOULD read already has a
  // substantial snippet, skip page retrieval entirely.
  const SUBSTANTIAL_SNIPPET = 260
  const allSubstantial = ranked.slice(0, count).every((s) => s.snippet.length >= SUBSTANTIAL_SNIPPET)
  return allSubstantial ? 0 : count
}

/**
 * PRIMARY-HOSTS-FIRST read scheduling (pure): within the read budget,
 * official and primary hosts are read before third-party pages. Measured
 * failure (2026-11-02 eval): a version question spent its 2 reads on a
 * year-old third-party blog while the actual release announcement sat
 * unread in the evidence set. Deterministic reorder of the top slice only —
 * evidence-set composition and ranking order are otherwise untouched.
 */
export function officialFirstReads<T extends { official: boolean; hostName: string }>(
  sources: readonly T[],
  count: number,
): T[] {
  if (count <= 0) return []
  if (sources.length <= 1) return sources.slice(0, count)
  const isPrimaryRanked = (s: T): boolean => s.official || isPrimaryHost(s.hostName)
  const pool = sources.slice(0, Math.min(Math.max(count, 3), sources.length))
  const primaryFirst = [...pool].sort((a, b) => Number(isPrimaryRanked(b)) - Number(isPrimaryRanked(a)))
  return primaryFirst.slice(0, count)
}

/**
 * Backoff before the single bounded search retry. Measured evidence
 * (worklog): the provider intermittently rejects a query it serves seconds
 * later (HTTP 422 "No search results available" on a healthy index), so one
 * short-delay retry recovers grounding without unbounded calls.
 */
export const SEARCH_RETRY_BACKOFF_MS = 1_200

/**
 * Wall-time budget for ONE full-page fetch. Measured evidence (baseline
 * perf run): the provider occasionally takes ~20s for a slow page while the
 * p50 is well under 4s — an unbounded tail dominated total user-perceived
 * latency for multi-source research (pageReadMs 19.9s of a 23.6s turn).
 * A read that exceeds the budget is discarded HONESTLY: it surfaces as a
 * degraded note and the answer is grounded on the snippets we already have.
 */
export const PAGE_READ_BUDGET_MS = 10_000

/**
 * Page-read content validation. Measured failure (work order evidence): the
 * page reader returned Chrome's ERR_BLOCKED_BY_CLIENT interstitial for a
 * news site and a literal "404 Not Found" body for a YouTube playlist — both
 * were recorded as successful reads and their garbage text entered the
 * grounding context as "verified article content". A read whose extracted
 * text is an error/wall page (or too short to be an article) is treated as a
 * FAILED read: the source falls back to its search snippet and the failure
 * degrades honestly. No fabricated content verification.
 */
const PAGE_ERROR_SIGNATURES: RegExp[] = [
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
/** Minimum extracted text for a read to count as real article content. */
export const PAGE_MIN_USEFUL_CHARS = 200

export function isUsablePageText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < PAGE_MIN_USEFUL_CHARS) return false
  // A single error signature near the START of the text means the body we
  // captured IS the error page, not an article that merely mentions one.
  const head = trimmed.slice(0, 400)
  return !PAGE_ERROR_SIGNATURES.some((re) => re.test(head))
}

/**
 * In-flight dedup: identical concurrent retrieval work (same normalized
 * query / same URL) shares ONE provider call instead of racing duplicates.
 * Bounded naturally — entries live only for the duration of the call.
 */
const inFlightSearches = new Map<string, Promise<WebSearchResult[]>>()
const inFlightPages = new Map<string, Promise<PageContent>>()

function searchInFlightKey(q: string, opts: { num?: number; recencyDays?: number }): string {
  return `${q.toLowerCase().replace(/\s+/g, ' ').trim()}|${opts.recencyDays ?? ''}|${opts.num ?? ''}`
}

export function runSharedSearch(q: string, opts: { num?: number; recencyDays?: number } = {}): Promise<WebSearchResult[]> {
  const key = searchInFlightKey(q, opts)
  const existing = inFlightSearches.get(key)
  if (existing) return existing
  const p = webSearch(q, opts).finally(() => inFlightSearches.delete(key))
  inFlightSearches.set(key, p)
  return p
}

export function runSharedPageRead(url: string): Promise<PageContent> {
  const key = url
  const existing = inFlightPages.get(key)
  if (existing) return existing
  const p = readPage(url, PAGE_READ_BUDGET_MS).finally(() => inFlightPages.delete(key))
  inFlightPages.set(key, p)
  return p
}

/**
 * One search attempt with EXACTLY ONE bounded retry for TRANSIENT failures: a
 * provider 5xx/422/timeout or a zero-result response gets a single same-query
 * retry after a short backoff (measured: the provider intermittently 422s
 * queries it serves seconds later). A rate-limit (HTTP 429) is DIFFERENT:
 * the measured throttle window lasts minutes, so retrying 1.2s later only
 * adds a second burst while the gateway is actively rejecting — a 429 fails
 * fast with attempts=1 and the real reason. Never loops, never fabricates,
 * NEVER throws — the outcome carries the honest attempt count and the real
 * provider error for the pack's degraded notes.
 */
export interface BoundedSearchOutcome {
  results: WebSearchResult[]
  /** Real provider calls made (0 for cache hits, 0-2 otherwise; 0 also when
   *  the call was skipped by the open 429 breaker). */
  attempts: number
  retried: boolean
  /** Most recent provider error message when the search ultimately failed. */
  error: string | null
}

export async function searchWithBoundedRetry(
  q: string,
  opts: { num?: number; recencyDays?: number },
): Promise<BoundedSearchOutcome> {
  try {
    const first = await runSharedSearch(q, opts)
    if (first.length > 0) return { results: first, attempts: 1, retried: false, error: null }
  } catch (e) {
    // Rate-limited (observed 429 OR the cooldown breaker skipped the call):
    // fail fast. Retrying into an active throttle deepens it (measured).
    if (e instanceof UpstreamRateLimitError) {
      return { results: [], attempts: e.attempted ? 1 : 0, retried: false, error: e.message }
    }
    // First attempt failed (transient provider error) — fall through to retry.
  }
  await new Promise((r) => setTimeout(r, SEARCH_RETRY_BACKOFF_MS))
  try {
    const second = await runSharedSearch(q, opts)
    return { results: second, attempts: 2, retried: true, error: null }
  } catch (e) {
    if (e instanceof UpstreamRateLimitError) {
      return { results: [], attempts: e.attempted ? 2 : 1, retried: true, error: e.message }
    }
    return {
      results: [],
      attempts: 2,
      retried: true,
      error: e instanceof Error ? e.message : 'unavailable',
    }
  }
}

/**
 * Map over items with at most `limit` workers in flight. Used to bound the
 * research pipeline's upstream concurrency: the gateway rate-limits per
 * time window, and firing 5 searches (plus a page-read volley) in one instant
 * measurably trips it. Two lanes keep the burst flat with negligible latency
 * cost (measured p50 search ~1-3s).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(lanes)
  return results
}

/** Bounded upstream concurrency for the research pipeline (measured 2026-10-29). */
export const SEARCH_CONCURRENCY = 2
export const PAGE_READ_CONCURRENCY = 2

/**
 * Execute the full research pipeline for one question.
 * Never throws: all tool failures are collected into `degraded`.
 */
export async function runResearch(
  message: string,
  decision: SearchDecision,
  opts: RunResearchOptions = {},
): Promise<EvidencePack> {
  const t0 = Date.now()
  const degraded: string[] = []
  const maxSources = opts.maxSources ?? 6

  let rawQueries: string[]
  if (isStraightforwardQuestion(message)) {
    // Fast path: no model call — the question (minus directive scaffolding)
    // is the strong query. When the topic names a place whose broader region
    // is missing from the wording, one region-anchored variant is added so
    // local reporting is actually retrievable (measured: "Gingee girl
    // missing" alone surfaced a stale, unrelated foreign article).
    rawQueries = fastPathQueryVariants(toSearchQuery(message))
  } else {
    const generated = await generateQueries(message, decision)
    if (generated.usedFallback) degraded.push('query refinement unavailable; searched the raw question')
    rawQueries = generated.queries
    // Same region guarantee for the refined path (bounded to 3 queries).
    const region = regionContextFor(message)
    if (region && !rawQueries.some((q) => q.toLowerCase().includes(region.toLowerCase()))) {
      rawQueries = [...rawQueries.slice(0, 2), `${rawQueries[0]} ${region}`]
    }
  }
  // Ongoing incident/case: deterministically target the NEWEST reporting and
  // official police/government statements (work-order priorities), bounded.
  const sensitiveSet = buildSensitiveQuerySet(message, rawQueries)
  rawQueries = sensitiveSet.queries
  if (sensitiveSet.addedFreshnessQuery) {
    degraded.push(`incident detected: added newest-coverage query "${sensitiveSet.addedFreshnessQuery.slice(0, 60)}"`)
  }
  if (sensitiveSet.addedOfficialQuery) {
    degraded.push(`incident detected: added official-statement query "${sensitiveSet.addedOfficialQuery.slice(0, 60)}"`)
  }
  // Deterministic entity/version/oath additions (measured eval failures:
  // titled-work questions searched nothing exact, entity-development
  // questions never hit the company's own announcements, version questions
  // surfaced only third-party posts, oath dates went unverified).
  const entitySet = buildDeterministicQuerySet(message, rawQueries)
  rawQueries = entitySet.queries
  for (const q of entitySet.added) {
    degraded.push(`added targeted query "${q.slice(0, 60)}"`)
  }
  const queries = dedupeQueries(rawQueries)

  // --- retrieval (parallel, bounded, cache-aware) ---------------------------
  let searchCalls = 0
  let searchRetries = 0
  let cacheHits = 0
  let oldestFetchAt: number | null = null
  const tSearchStart = Date.now()
  const settled = await mapWithConcurrency(queries, SEARCH_CONCURRENCY, async (q): Promise<BoundedSearchOutcome> => {
    const cached = getSearchCache<WebSearchResult>(q, decision.recencyDays, decision.risk === 'none' ? 'moderate' : decision.risk)
    if (cached.hit) {
      cacheHits += 1
      oldestFetchAt = oldestFetchAt === null
        ? Date.parse(cached.fetchedAt)
        : Math.min(oldestFetchAt, Date.parse(cached.fetchedAt))
      return { results: cached.value, attempts: 0, retried: false, error: null }
    }
    const outcome = await searchWithBoundedRetry(q, {
      num: 6,
      ...(decision.recencyDays ? { recencyDays: decision.recencyDays } : {}),
    })
    if (outcome.error === null) {
      cached.put(outcome.results)
      oldestFetchAt = oldestFetchAt === null ? Date.now() : Math.min(oldestFetchAt, Date.now())
    }
    return outcome
  })
  const rawResults: WebSearchResult[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      searchCalls += s.value.attempts
      if (s.value.retried) searchRetries += 1
      if (s.value.error !== null) {
        degraded.push(`search "${queries[i].slice(0, 60)}" failed: ${s.value.error}`)
      } else {
        rawResults.push(...s.value.results)
      }
    } else {
      degraded.push(
        `search "${queries[i].slice(0, 60)}" failed: ${
          s.reason instanceof ResearchToolError ? s.reason.message : 'unavailable'
        }`,
      )
    }
  })
  void searchRetries
  const searchMs = Date.now() - tSearchStart

  if (rawResults.length === 0) {
    return {
      sources: [],
      queries,
      degraded: degraded.length > 0 ? degraded : ['web search returned no results'],
      staleness: null,
      geoWarning: null,
      durationMs: Date.now() - t0,
      searchMs,
      pageReadMs: 0,
      searchCalls,
      pageReadCalls: 0,
      cacheHits,
      fetchedAt: new Date(oldestFetchAt ?? Date.now()).toISOString(),
    }
  }

  let ranked = rankSources(message, rawResults, { freshnessMatters: decision.risk === 'high', limit: maxSources })

  // --- one bounded follow-up for newer reporting ----------------------------
  // Two triggers, ONE bounded follow-up (never loops; failures degrade
  // honestly):
  //  1. STALE EVIDENCE — every selected source is stale or undated for a
  //     freshness-sensitive question (existing trigger); a 30-day window
  //     hunts for newer reporting.
  //  2. ONGOING CASE — the question names an evolving case (missing person,
  //     rescue, accident investigation...) and the newest dated source is
  //     more than ~3 days old (work order: "search for newer relevant
  //     reporting before summarizing an ongoing case"). A case summary
  //     built on week-old reporting can silently miss a resolution; a
  //     10-day-window follow-up checks once, and older reporting still
  //     ranks only as background.
  if (decision.risk === 'high' && ranked.length > 0) {
    const newestAge = newestSourceAgeDays(ranked)
    const ongoing = isOngoingCaseQuery(queries[0])
    // Version/release questions run on a TIGHTER staleness threshold (21d):
    // a software project's release cadence is 1–3 weeks, so a 39-day-old
    // newest source (the measured Next.js failure) must trigger the hunt for
    // the actual current release instead of presenting a year-old post.
    const versionSensitive = /\b(version|release)\b/i.test(message)
    const staleEvidence = needsFreshnessFollowUp(ranked, versionSensitive ? 21 : 45)
    const ongoingStale = ongoing && newestAge !== null && newestAge > 3
    const ongoingUndated = ongoing && newestAge === null
    if (staleEvidence || ongoingStale || ongoingUndated) {
      const followUpQuery = versionSensitive
        ? `${queries[0]} official release notes changelog`.slice(0, 280)
        : buildFollowUpQuery(queries[0])
      if (!queries.includes(followUpQuery)) {
        const recency = ongoing ? 10 : 30
        const outcome = await searchWithBoundedRetry(followUpQuery, { num: 6, recencyDays: recency })
        if (outcome.error !== null) {
          degraded.push(`freshness follow-up search failed: ${outcome.error}`)
        } else if (outcome.results.length > 0) {
          searchCalls += outcome.attempts
          rawResults.push(...outcome.results)
          ranked = rankSources(message, rawResults, { freshnessMatters: decision.risk === 'high', limit: maxSources })
          queries.push(followUpQuery)
        }
      }
    }
  }

  // --- full-page reading, only where snippets are insufficient --------------
  const sources: EvidenceSource[] = ranked.map((r) => ({ ...r, pageRead: false, excerpt: null }))
  const ongoingCase = isOngoingCaseQuery(queries[0])
  const readCount = decidePageReads(ranked, decision, opts, ongoingCase)
  let pageReadCalls = 0
  let pageReadMs = 0
  if (readCount > 0) {
    const tPageStart = Date.now()
    const toRead = officialFirstReads(sources, readCount)
    const readResults = await mapWithConcurrency(toRead, PAGE_READ_CONCURRENCY, (s) => {
      const cached = getPageCache<{ url: string; text: string; publishedTime: string | null }>(s.url)
      if (cached.hit) {
        oldestFetchAt = oldestFetchAt === null
          ? Date.parse(cached.fetchedAt)
          : Math.min(oldestFetchAt, Date.parse(cached.fetchedAt))
        return Promise.resolve(cached.value)
      }
      pageReadCalls += 1
      return runSharedPageRead(s.url).then((page) => {
        const value = { url: page.url, text: page.text.slice(0, 6_000), publishedTime: page.publishedTime }
        cached.put(value)
        oldestFetchAt = oldestFetchAt === null ? Date.now() : Math.min(oldestFetchAt, Date.now())
        return value
      })
    })
    readResults.forEach((res) => {
      if (res.status === 'fulfilled') {
        const match = sources.find((s) => samePage(s.url, res.value.url))
        if (match) {
          if (isUsablePageText(res.value.text)) {
            match.pageRead = true
            match.excerpt = res.value.text
            // Publication-date verification: the page's own structured
            // metadata (JSON-LD/meta) is the authoritative publication date —
            // it OVERRIDES the search-engine-supplied date (often a crawl or
            // index date, not the article date).
            if (res.value.publishedTime) match.date = res.value.publishedTime
            // Last-resort date extraction from the article TEXT (dateline
            // "Published: 22 Oct 2026") when neither the provider nor the
            // page metadata supplied one. Explicit dateline only — never a
            // bare year mention in body copy.
            else if (!match.date) match.date = extractDatelineFromText(res.value.text)
          } else {
            // Content-verification failure: what came back is an error or
            // blocked page, NOT the article. Honest fallback to the snippet.
            degraded.push(
              `page read for ${match.hostName.replace(/^www\./, '')} returned an error or blocked page; grounded on the search snippet`,
            )
          }
        }
      } else {
        degraded.push(`page read failed: ${res.reason instanceof ResearchToolError ? res.reason.message : 'unavailable'}`)
      }
    })
    pageReadMs = Date.now() - tPageStart
  }

  // re-parse freshness in case page reading supplied a publishedTime
  const geoWarning = computeGeoWarning(
    message,
    sources.map((s) => ({ title: s.title, snippet: s.snippet, excerpt: s.excerpt })),
  )

  return {
    sources,
    queries,
    degraded,
    staleness: stalenessWarning(sources, decision.risk === 'high'),
    geoWarning,
    durationMs: Date.now() - t0,
    searchMs,
    pageReadMs,
    searchCalls,
    pageReadCalls,
    cacheHits,
    fetchedAt: new Date(oldestFetchAt ?? Date.now()).toISOString(),
  }
}

function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '') && ua.pathname === ub.pathname
  } catch {
    return a === b
  }
}

/**
 * Geographic relevance audit (pure, deterministic): when the topic names a
 * PLACE and no selected source mentions it, the retrieved reports are
 * probably about a different case — the answer must say so instead of
 * presenting them as the asked case.
 *
 * DOMAIN GATE (work-order defect: a Next.js version question surfaced "the
 * specific case or place may not be identified"): the place/case warning is
 * meaningful ONLY when the query is actually place-anchored — a gazetteer
 * place in the wording, or an ongoing-case question. Software/version and
 * other non-geo queries never receive it. Mention checks are
 * punctuation-insensitive so "Next.js" matches the extracted term "nextjs".
 */
export function computeGeoWarning(
  message: string,
  sources: ReadonlyArray<{ title: string; snippet: string; excerpt?: string | null }>,
): string | null {
  const geoTerms = geoTermsOf(message)
  if (geoTerms.length === 0) return null
  const placeAnchored = placeKeysOf(message).length > 0 || isOngoingCaseQuery(message)
  if (!placeAnchored) return null
  const anyGeoMatch = sources.some((s) => {
    const hay = `${s.title} ${s.snippet} ${s.excerpt ?? ''}`
    return geoTerms.some((t) => textMentionsTerm(hay, t))
  })
  return anyGeoMatch
    ? null
    : `none of the retrieved reports mention ${geoTerms.slice(0, 3).join(', ')}; the specific case or place may not be identified`
}

/**
 * Cross-source conflict check (pure, deterministic): when the retrieved
 * sources carry publication dates that SPAN more than a year, the pack
 * mixes current reporting with potentially outdated material. The solver
 * is told explicitly so it prefers the newer sources and names the
 * disagreement instead of blending stale and fresh claims.
 */
export function findDateDisagreement(
  sources: ReadonlyArray<{ date: string | null; id: number; title: string }>,
): string | null {
  const dated = sources
    .map((s) => ({ title: s.title, year: s.date ? parseSourceDate(s.date).year ?? null : null }))
    .filter((s): s is { title: string; year: number } => s.year !== null)
  if (dated.length < 2) return null
  let newest = dated[0]
  let oldest = dated[0]
  for (const s of dated) {
    if (s.year > newest.year) newest = s
    if (s.year < oldest.year) oldest = s
  }
  if (newest.year - oldest.year <= 1) return null
  return (
    `NOTE: retrieved sources span a wide date range (${oldest.title.slice(0, 80)} vs ${newest.title.slice(0, 80)}). ` +
    'Prefer the newer sources for anything time-sensitive, and say when sources disagree.'
  )
}

/** Compact, numbered evidence block for the solver prompt. */
export function formatEvidenceBlock(pack: EvidencePack): string | null {
  if (pack.sources.length === 0) return null
  const lines = pack.sources.map((s) => {
    const date = s.date ? ` (dated ${s.date})` : ' (no date supplied)'
    const body = s.excerpt ? s.excerpt.slice(0, 1_200) : s.snippet.slice(0, 600)
    return `[${s.id}] ${s.title}${date}\nURL: ${s.url}\nEXCERPT: ${body}`
  })
  const disagreement = findDateDisagreement(pack.sources)
  return disagreement ? `${lines.join('\n\n')}\n\n${disagreement}` : lines.join('\n\n')
}
