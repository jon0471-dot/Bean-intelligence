/**
 * BEAN Intelligence — research provider (REAL search via the authorized
 * gateway).
 *
 * Wraps z-ai-web-dev-sdk function tools:
 *   - functions.invoke('web_search', { query, num?, recency_days? })
 *     -> ranked results with url, name, snippet, host_name, date
 *   - functions.invoke('page_reader', { url })
 *     -> page HTML + title + publishedTime
 *
 * Honesty contract: these wrappers NEVER fabricate results. Every failure is
 * normalized into a typed error the orchestrator reports as TOOL_UNAVAILABLE
 * or degraded behavior — never as fake evidence.
 */
import ZAI from 'z-ai-web-dev-sdk'
import type { SearchFunctionResultItem } from 'z-ai-web-dev-sdk'
import type { HealthReport } from '@/lib/adapters/types'
import {
  classifyUpstreamError,
  healthFailureCategory,
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  upstreamBreakerState,
  upstreamCoolingDown,
  UpstreamAuthError,
  UpstreamBillingError,
  UpstreamRateLimitError,
  type UpstreamEndpointClass,
} from '@/lib/upstream/gateway'
import { lastRealAttempt, noteRealAttempt, recentUpstreamFailure, UPSTREAM_FAILURE_CATEGORIES } from '@/lib/adapters/last-attempts'
import { gatewayConfig, probeGatewayReachability } from '@/lib/adapters/gateway-reachability'

export interface WebSearchResult {
  url: string
  title: string
  snippet: string
  hostName: string
  rank: number
  /** Provider-supplied date string, when present (format varies). */
  date: string | null
}

export interface WebSearchOptions {
  num?: number
  /** Restrict to results from the last N days (freshness-sensitive queries). */
  recencyDays?: number
  timeoutMs?: number
}

export interface PageContent {
  url: string
  title: string
  /** Extracted readable text (tags stripped, whitespace normalized). */
  text: string
  /** Provider-supplied published time, when present. */
  publishedTime: string | null
}

export class ResearchToolError extends Error {
  /** 'direct_fetch' = the gateway-free independent lane (see ./direct). */
  readonly tool: 'web_search' | 'page_reader' | 'direct_fetch'
  constructor(tool: 'web_search' | 'page_reader' | 'direct_fetch', message: string) {
    super(message)
    this.name = 'ResearchToolError'
    this.tool = tool
  }
}

/**
 * Normalize ANY error from an upstream SDK call into the typed boundary:
 *  - HTTP 429  -> UpstreamRateLimitError + the class's cooldown breaker opens
 *    (measured: the throttle window lasts minutes — firing more requests into
 *    it only deepens the throttle, so the breaker fails callers fast while
 *    open; expiry is verified by a real probe call, never assumed).
 *  - 401/403   -> UpstreamAuthError, 402 -> UpstreamBillingError (operator /
 *    account action, distinct from throttling — never mislabeled).
 *  - everything else stays a ResearchToolError with the REAL provider text.
 * No error is ever swallowed or relabeled as success.
 */
function normalizeUpstreamError(
  endpointClass: UpstreamEndpointClass,
  tool: 'web_search' | 'page_reader',
  e: unknown,
): Error {
  if (e instanceof ResearchToolError) return e // internal timeout guard keeps its own label
  const failure = classifyUpstreamError(e)
  const raw = e instanceof Error ? e.message : String(e)
  if (failure.kind === 'rate_limited') {
    noteUpstream429(endpointClass)
    return new UpstreamRateLimitError(
      endpointClass,
      `${tool} is rate-limited upstream (HTTP 429): ${raw.slice(0, 200)}`,
    )
  }
  if (failure.kind === 'auth') {
    return new UpstreamAuthError(`${tool} failed: gateway rejected credentials (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 401)
  }
  if (failure.kind === 'billing') {
    return new UpstreamBillingError(`${tool} failed: gateway refused for account reasons (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 402)
  }
  return new ResearchToolError(tool, `${tool} failed: ${raw.slice(0, 300)}`)
}

/** Fail fast (no network) while the class's cooldown breaker is open. */
function assertGatewayOpen(endpointClass: UpstreamEndpointClass, tool: 'web_search' | 'page_reader'): void {
  if (upstreamCoolingDown(endpointClass)) {
    noteUpstreamSkip(endpointClass)
    throw new UpstreamRateLimitError(
      endpointClass,
      `${tool} not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago); ` +
        `call skipped to avoid worsening the throttle`,
      false,
    )
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, tool: 'web_search' | 'page_reader'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResearchToolError(tool, `${tool} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * CHAT-RECOVERY (2026-11-10): record every REAL functions-class attempt
 * (success and upstream failure alike — never breaker skips) as health
 * evidence. The quota-free research health probe reads this instead of
 * firing its own "ping" search.
 */
function recordSearchAttempt(ok: boolean, failure: { kind: string; status: number | null } | null, rawMessage: string | null): void {
  let category: ReturnType<typeof healthFailureCategory> | 'backend-error' | null = null
  if (!ok && failure) category = healthFailureCategory(failure.kind as never)
  if (!ok && !failure && rawMessage) {
    // Local failure (timeout guard / malformed response): classify from the
    // message so a real gateway timeout still counts as timeout evidence.
    category = /timed out/i.test(rawMessage) ? 'timeout' : 'backend-error'
  }
  noteRealAttempt('research-search', {
    at: new Date().toISOString(),
    ok,
    backendId: 'research-functions-primary',
    failureCategory: category,
    httpStatus: ok ? null : (failure?.status ?? null),
    upstream: ok ? false : category !== null && UPSTREAM_FAILURE_CATEGORIES.has(category),
  })
}

/** Run a real web search through the authorized gateway. */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new ResearchToolError('web_search', 'Empty search query.')
  if (trimmed.length > 400) throw new ResearchToolError('web_search', 'Search query too long.')
  assertGatewayOpen('functions', 'web_search')
  const zai = await ZAI.create()
  let raw: SearchFunctionResultItem[]
  try {
    raw = await withTimeout(
      zai.functions.invoke('web_search', {
        query: trimmed,
        ...(opts.num ? { num: Math.min(Math.max(1, opts.num), 10) } : {}),
        ...(opts.recencyDays ? { recency_days: Math.min(Math.max(1, opts.recencyDays), 365) } : {}),
      }),
      opts.timeoutMs ?? 20_000,
      'web_search',
    )
  } catch (e) {
    // Normalize EVERY failure (raw SDK/network errors included) into the typed
    // error so degraded reports carry the real reason, not a bare "unavailable".
    const normalized = normalizeUpstreamError('functions', 'web_search', e)
    const failure = classifyUpstreamError(normalized)
    recordSearchAttempt(false, failure.kind === 'other' ? null : failure, normalized.message)
    throw normalized
  }
  // PHASE 1 bounded backoff: a real success resets the consecutive-429 streak.
  noteUpstreamSuccess('functions')

  if (!Array.isArray(raw)) {
    recordSearchAttempt(false, null, 'Malformed search response.')
    throw new ResearchToolError('web_search', 'Malformed search response.')
  }
  recordSearchAttempt(true, null, null)
  return raw
    .filter((r) => typeof r?.url === 'string' && typeof r?.name === 'string')
    .map((r, i) => ({
      url: r.url,
      title: String(r.name).slice(0, 300),
      snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 1200) : '',
      hostName: typeof r.host_name === 'string' && r.host_name ? r.host_name : safeHost(r.url),
      rank: typeof r.rank === 'number' ? r.rank : i + 1,
      date: typeof r.date === 'string' && r.date.trim() ? r.date.trim() : null,
    }))
}

/**
 * RIISHE research-availability probe (functions endpoint class).
 *
 * QUOTA-FREE (CHAT-RECOVERY, 2026-11-10). The previous probe ran ONE real
 * `web_search('ping')` per fresh poll — every dashboard refresh burned a
 * functions-class request against the shared account budget, and the
 * health fan-out's concurrent burst (2 chat completions + this search)
 * measurably tripped the provider's authoritative 2-QPS limit. The probe
 * now fires ZERO metered requests; its evidence, in order:
 *   1. CONFIG — the gateway client resolves with baseUrl/apiKey present;
 *   2. REACHABILITY — the free, unmetered /models liveness GET (see
 *      gateway-reachability.ts) proves the configured host answers;
 *   3. BREAKER — an open functions-class breaker (a real 429 was observed)
 *      is reported rate-limited; recovery stays verified by the next REAL
 *      research call, never assumed;
 *   4. REAL-ATTEMPT EVIDENCE — the most recent actual web_search performed
 *      by customer research turns (recorded by webSearch itself). Research
 *      attempts are not persisted, so after a quiet restart the report says
 *      exactly what its status is based on (reachability + config).
 */
export async function probeResearchHealth(): Promise<HealthReport> {
  const checkedAt = new Date().toISOString()
  let zai: unknown
  try {
    zai = await ZAI.create()
  } catch (e) {
    return {
      healthy: false,
      checkedAt,
      latencyMs: null,
      httpStatus: null,
      failureCategory: 'misconfigured',
      detail: `Misconfigured: the gateway client failed to initialize (${e instanceof Error ? e.message : String(e)}). No search request was made.`,
    }
  }
  const cfg = gatewayConfig(zai)
  if (!cfg.baseUrl || !cfg.apiKey) {
    return {
      healthy: false,
      checkedAt,
      latencyMs: null,
      httpStatus: null,
      failureCategory: 'misconfigured',
      detail:
        'Misconfigured: gateway client initialized but its config is missing baseUrl/apiKey, so the functions endpoint cannot be reached. No search request was made.',
    }
  }
  const reach = await probeGatewayReachability(cfg.baseUrl, cfg.apiKey)
  if (!reach.reachable) {
    return {
      healthy: false,
      checkedAt,
      latencyMs: reach.latencyMs,
      httpStatus: null,
      failureCategory: reach.error?.startsWith('no response within') ? 'timeout' : 'unreachable',
      detail: `Research backend UNREACHABLE: the configured gateway host answered no request (${reach.error}). No search was fired (health never consumes provider quota).`,
    }
  }
  const breaker = upstreamBreakerState('functions')
  if (breaker.coolingDown && breaker.last429At) {
    return {
      healthy: false,
      checkedAt,
      latencyMs: reach.latencyMs,
      httpStatus: 429,
      failureCategory: 'rate-limited',
      detail: `Research (web_search) deferred: the functions endpoint class is rate-limited upstream (HTTP 429 observed ${breaker.last429At}; breaker open for ${Math.round(breaker.remainingMs / 1000)}s, ${breaker.skippedCalls} call(s) skipped so far). No search was fired — recovery is verified by the next REAL research call.`,
    }
  }
  const freshFailure = recentUpstreamFailure('research-search')
  if (freshFailure) {
    return {
      healthy: false,
      checkedAt,
      latencyMs: reach.latencyMs,
      httpStatus: freshFailure.httpStatus,
      failureCategory: freshFailure.failureCategory,
      detail: `The most recent REAL web_search failed upstream (${freshFailure.failureCategory ?? 'unknown'}, at ${freshFailure.at}). Gateway host reachable. No search was fired by this probe.`,
    }
  }
  if (lastRealAttempt('research-search')?.ok) {
    return {
      healthy: true,
      checkedAt,
      latencyMs: reach.latencyMs,
      httpStatus: null,
      failureCategory: null,
      detail: `Gateway host reachable (free liveness check, HTTP ${reach.status}); the most recent REAL web_search succeeded at ${lastRealAttempt('research-search')!.at}. No search was fired by this probe (health never consumes provider quota).`,
    }
  }
  return {
    healthy: true,
    checkedAt,
    latencyMs: reach.latencyMs,
    httpStatus: null,
    failureCategory: null,
    detail: `Gateway host reachable (free liveness check, HTTP ${reach.status}) and configuration valid; no real research attempt evidence yet in this process. Status is from reachability + config ONLY — no search was fired (health never consumes provider quota).`,
  }
}

/** Fetch and extract readable text from a page (tags stripped). */
export async function readPage(url: string, timeoutMs = 25_000): Promise<PageContent> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ResearchToolError('page_reader', `Invalid URL: ${url.slice(0, 100)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ResearchToolError('page_reader', 'Only http(s) URLs are supported.')
  }
  assertGatewayOpen('functions', 'page_reader')
  const zai = await ZAI.create()
  // invoke() is generically typed by the SDK's FunctionMap — no cast needed.
  let raw: { data?: { html?: unknown; url?: unknown; title?: unknown; publishedTime?: unknown } }
  try {
    raw = await withTimeout(
      zai.functions.invoke('page_reader', { url }),
      timeoutMs,
      'page_reader',
    )
  } catch (e) {
    throw normalizeUpstreamError('functions', 'page_reader', e)
  }
  // PHASE 1 bounded backoff: a real success resets the consecutive-429 streak.
  noteUpstreamSuccess('functions')
  const html = raw?.data?.html
  if (typeof html !== 'string' || html.length === 0) {
    throw new ResearchToolError('page_reader', 'Page reader returned no content.')
  }
  const providerTime = typeof raw.data?.publishedTime === 'string' && raw.data.publishedTime.trim() ? raw.data.publishedTime.trim() : null
  // Publication-date verification: when the provider omits a date, extract
  // one from the page's own structured metadata (JSON-LD / meta / <time>).
  // Publication date ≠ event date — the prompt layer must keep the two apart.
  const publishedTime = providerTime ?? extractPublishedTime(html)
  return {
    url: typeof raw.data?.url === 'string' ? raw.data.url : url,
    title: typeof raw.data?.title === 'string' ? raw.data.title : '',
    publishedTime,
    text: htmlToText(html).slice(0, 24_000),
  }
}

/**
 * Extract the article publication date from raw HTML metadata.
 * Priority: JSON-LD datePublished > article:published_time / date meta tags
 * > <time datetime>. Returns null when none is present (never guesses).
 * Exported pure for unit testing.
 */
export function extractPublishedTime(html: string): string | null {
  const limited = html.slice(0, 400_000)

  // 1. JSON-LD blocks (Next.js/WordPress/news sites embed datePublished).
  const ldRe = /<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = ldRe.exec(limited)) !== null) {
    const date = firstDateInJsonLd(m[1])
    if (date) return date
  }

  // 2. Standard meta tags.
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']publish(?:ed)?-?date["'][^>]+content=["']([^"']+)["']/i,
  ]
  for (const re of metaPatterns) {
    m = re.exec(limited)
    if (m && looksLikeDate(m[1])) return m[1].trim()
  }

  // 3. <time datetime="..."> (first one only — later ones are often updates
  //    on unrelated blocks).
  m = /<time[^>]+datetime=["']([^"']+)["']/i.exec(limited)
  if (m && looksLikeDate(m[1])) return m[1].trim()

  return null
}

/**
 * Last-resort publication-date extraction from the ARTICLE TEXT itself
 * (datelines like "Published: 22 Oct 2026", "Updated: October 23, 2026",
 * "Posted on 22.10.2026"). Runs only when metadata yielded nothing, so a
 * date is never guessed from a bare year mention in body copy. Returns the
 * matched date phrase, or null. Exported pure for unit testing.
 */
export function extractDatelineFromText(text: string): string | null {
  const head = text.slice(0, 2_000)
  const patterns: RegExp[] = [
    /\b(?:published|posted|dated)\s*(?:on|:)?\s*((?:\d{1,2}[\s./-])?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:\d{1,2}\s*,?\s*)?(?:19|20)\d{2})/i,
    /\b(?:published|posted|dated)\s*(?:on|:)?\s*((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i,
    /\b(?:published|posted|dated)\s*(?:on|:)?\s*(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2})/i,
    /\bupdated\s*(?:on|:)?\s*((?:\d{1,2}[\s./-])?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:\d{1,2}\s*,?\s*)?(?:19|20)\d{2})/i,
    /\bupdated\s*(?:on|:)?\s*(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2})/i,
  ]
  for (const re of patterns) {
    const m = re.exec(head)
    if (m && looksLikeDate(m[1])) return m[1].replace(/\s+/g, ' ').trim()
  }
  return null
}

/** Pull the first plausible date out of a JSON-LD blob (may be an array/graph). */
function firstDateInJsonLd(blob: string): string | null {
  const dateRe = /"(?:datePublished|dateCreated|uploadDate)"\s*:\s*"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = dateRe.exec(blob)) !== null) {
    if (looksLikeDate(m[1])) return m[1].trim()
  }
  return null
}

/** Cheap plausibility gate: ISO-ish or contains a 4-digit year + separator. */
function looksLikeDate(s: string): boolean {
  if (!s || s.length < 4 || s.length > 64) return false
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true // ISO 8601
  // e.g. "12 Oct 2026", "Oct 12, 2026", "2026.10.12"
  return /\b(19|20)\d{2}\b/.test(t) && /[-/.]|\d\s+[A-Za-z]{3}|[A-Za-z]{3}\s+\d/.test(t)
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Minimal, dependency-free HTML -> text extraction with cleanup. */
export function htmlToText(html: string): string {
  return html
    // drop non-content blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // block-level tags become whitespace to keep words separated
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|blockquote|table|thead|tbody|ul|ol|dl|dt|dd|pre|figcaption)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // entities (most common only — keep honest, no over-interpretation)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // collapse whitespace, keep line structure
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
}
