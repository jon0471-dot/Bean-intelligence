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
  readonly tool: 'web_search' | 'page_reader'
  constructor(tool: 'web_search' | 'page_reader', message: string) {
    super(message)
    this.name = 'ResearchToolError'
    this.tool = tool
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, tool: 'web_search' | 'page_reader'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResearchToolError(tool, `${tool} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Run a real web search through the authorized gateway. */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new ResearchToolError('web_search', 'Empty search query.')
  if (trimmed.length > 400) throw new ResearchToolError('web_search', 'Search query too long.')
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
    if (e instanceof ResearchToolError) throw e
    throw new ResearchToolError('web_search', `web_search failed: ${e instanceof Error ? e.message : 'unknown error'}`)
  }

  if (!Array.isArray(raw)) throw new ResearchToolError('web_search', 'Malformed search response.')
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
    if (e instanceof ResearchToolError) throw e
    throw new ResearchToolError('page_reader', `page_reader failed: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  const html = raw?.data?.html
  if (typeof html !== 'string' || html.length === 0) {
    throw new ResearchToolError('page_reader', 'Page reader returned no content.')
  }
  return {
    url: typeof raw.data?.url === 'string' ? raw.data.url : url,
    title: typeof raw.data?.title === 'string' ? raw.data.title : '',
    publishedTime: typeof raw.data?.publishedTime === 'string' ? raw.data.publishedTime : null,
    text: htmlToText(html).slice(0, 24_000),
  }
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
