/**
 * BEAN Intelligence — intelligent retrieval policy (Part 9 of the work
 * order) + shared evidence facade.
 *
 * Three internal modes:
 *   1. direct        — answer/generate from the model; retrieval adds nothing.
 *   2. grounded      — search the web when current/specialized facts matter.
 *   3. multimodal    — bounded fact retrieval before image/video generation
 *                      when a NAMED real-world entity needs its appearance
 *                      verified (species, landmark, product...).
 *
 * The chat policy reuses the RIISHE research policy (already measured across
 * ~30 eval probes). This module adds the deterministic cross-product policy:
 * GIFTZ docs retrieval and multimodal grounding, each with explicit request
 * budgets (queries, pages, bytes, time, context tokens) and safe fallbacks.
 */

import { runSharedPageRead, mapWithConcurrency, isUsablePageText, searchWithBoundedRetry, type BoundedSearchOutcome } from '@/lib/research/pipeline'
import { searxngSearch } from './providers/searxng'
import type { WebSearchResult } from '@/lib/research/provider'
import { rankSources } from '@/lib/research/rank'
import type { RankedSource } from '@/lib/research/rank'
import { getSearchCache, getPageCache } from '@/lib/research/cache'
import { analyzeLanguage, type LanguageAnalysis } from './language'
import { buildQueryVariants } from './language'
import { searchViaChain } from './search-chain'
import type { ScenePlan } from './world/analyze'

export type RetrievalMode = 'direct' | 'grounded' | 'multimodal'

export { searchViaChain, type SearchVia, type SearchViaOutcome } from './search-chain'

/** Request budgets (work order Part 9: "Set request-specific limits"). */
export interface RetrievalBudget {
  maxQueries: number
  maxPages: number
  maxBytesPerPage: number
  pageTimeoutMs: number
  searchTimeoutMs: number
  totalTimeoutMs: number
  maxContextChars: number
}

export const BUDGETS: Record<RetrievalMode, RetrievalBudget> = {
  direct: {
    maxQueries: 0, maxPages: 0, maxBytesPerPage: 0,
    pageTimeoutMs: 0, searchTimeoutMs: 0, totalTimeoutMs: 0, maxContextChars: 0,
  },
  grounded: {
    maxQueries: 3, maxPages: 2, maxBytesPerPage: 24_000,
    pageTimeoutMs: 10_000, searchTimeoutMs: 20_000, totalTimeoutMs: 30_000,
    maxContextChars: 6_000,
  },
  multimodal: {
    maxQueries: 1, maxPages: 1, maxBytesPerPage: 8_000,
    pageTimeoutMs: 6_000, searchTimeoutMs: 8_000, totalTimeoutMs: 10_000,
    maxContextChars: 2_400,
  },
}

/** GIFTZ docs-policy: technical/library/API signals. */
const DOCS_TRIGGERS: Array<[RegExp, string]> = [
  [/\b(api|sdk|library|framework|package|module|function|method|class)\b/i, 'software API surface'],
  [/\b(docs?|documentation|reference|readme|changelog|migration)\b/i, 'documentation request'],
  [/\bhow\s+(do|to|can)\b.*\b(in|with|using)\b/i, 'how-to implementation question'],
  [/\b(node\.?js|npm|deno|bun|python|pip|rust|cargo|go|java|kotlin|swift|react|vue|angular|svelte|next\.?js|typescript|javascript|prisma|tailwind|express|fastapi|django|flask|spring|dotnet|\.net)\b/i, 'named technology'],
  [/\bversion|v?\d+\.\d+(\.\d+)?|lts|stable|release notes\b/i, 'version-sensitive question'],
  [/\b(deprecat\w+|breaking change|upgrade|downgrade|install)\b/i, 'lifecycle/upgrade question'],
  [/\b(error|exception|stack trace|traceback|exit code)\b/i, 'error diagnosis'],
]

/** Exclusions: pure concepts/math never need docs retrieval. */
const DOCS_EXCLUSIONS: Array<[RegExp, string]> = [
  [/^\s*(hi|hello|hey|thanks|thank you)\b/i, 'greeting'],
  [/\b(time complexity|big.?o|p vs np|theorem|proof|algorithm design)\b/i, 'theory question answerable from expertise'],
]

export interface DocsDecision {
  search: boolean
  reason: string
}

/** Deterministic GIFTZ retrieval decision (pure, unit-testable). */
export function shouldSearchDocs(message: string): DocsDecision {
  const text = (message ?? '').trim()
  if (text.length === 0) return { search: false, reason: 'empty message' }
  for (const [re, reason] of DOCS_EXCLUSIONS) {
    if (re.test(text)) return { search: false, reason }
  }
  const hit = DOCS_TRIGGERS.find(([re]) => re.test(text))
  if (hit) return { search: true, reason: hit[1] }
  return { search: false, reason: 'no technical documentation signal' }
}

/** Extract library/package-like targets for focused queries. */
export function extractTechTargets(message: string): string[] {
  const targets = new Set<string>()
  const named = message.match(/\b(next\.?js|node\.?js|react|vue|svelte|typescript|prisma|tailwind|fastapi|django|flask|bun|deno)\b/gi) ?? []
  for (const n of named) targets.add(n.replace(/\./g, '').toLowerCase())
  const dotted = message.match(/\b[a-z][a-z0-9_-]+(?:\.js|\.py|\.ts)\b/gi) ?? []
  for (const d of dotted) targets.add(d.replace(/\.(js|py|ts)$/i, '').toLowerCase())
  return [...targets].slice(0, 2)
}

export interface IntelSource {
  id: number
  url: string
  title: string
  snippet: string
  hostName: string
  date: string | null
  /** Full-page excerpt when the page was read (rare, budgeted). */
  excerpt: string | null
}

export interface IntelEvidence {
  mode: RetrievalMode
  queries: string[]
  sources: IntelSource[]
  degraded: string[]
  durationMs: number
  fetchedAt: string
  language: LanguageAnalysis
}

/**
 * Shared bounded retrieval used by CODE GIFTZ (docs mode) and by image/video
 * multimodal grounding. Wraps the SAME measured provider boundary the RIISHE
 * research pipeline uses (breaker-aware, cache-aware, honesty-normalized).
 * Never throws for retrieval failure — degrades into `degraded` notes.
 */
export async function retrieveEvidence(args: {
  mode: 'grounded' | 'multimodal'
  message: string
  /** Explicit extra queries (e.g. entity-focused for multimodal). */
  extraQueries?: string[]
  analysis?: LanguageAnalysis
  /** docs mode biases queries toward official documentation. */
  docsMode?: boolean
}): Promise<IntelEvidence> {
  const t0 = Date.now()
  const budget = BUDGETS[args.mode]
  const analysis = args.analysis ?? analyzeLanguage(args.message)
  const degraded: string[] = []

  // Query construction: original-language variants first, then explicit extras.
  let queries = buildQueryVariants(args.message, analysis).slice(0, budget.maxQueries)
  if (args.docsMode) {
    const targets = extractTechTargets(args.message)
    const year = new Date().getFullYear()
    const focus = targets.length > 0 ? targets.join(' ') : ''
    const docsQuery = [focus, args.message.split(/\s+/).slice(0, 8).join(' '), 'official documentation', String(year)]
      .filter(Boolean).join(' ').slice(0, 200)
    queries = [docsQuery, ...queries].slice(0, budget.maxQueries)
  }
  if (args.extraQueries && args.extraQueries.length > 0) {
    queries = [...args.extraQueries, ...queries].slice(0, budget.maxQueries)
  }
  if (queries.length === 0) {
    return { mode: args.mode, queries: [], sources: [], degraded: ['no query could be built'], durationMs: Date.now() - t0, fetchedAt: new Date().toISOString(), language: analysis }
  }

  // Bounded search with the shared breaker/cache boundary: ONE call per
  // query through searchWithBoundedRetry (never throws; 429s fail fast and
  // are carried honestly). Cache hits record zero attempts.
  const outcomes: BoundedSearchOutcome[] = []
  for (const q of queries) {
    const cache = getSearchCache<WebSearchResult>(q, undefined, 'moderate')
    if (cache.hit) {
      outcomes.push({ results: cache.value, attempts: 0, retried: false, error: null, noResults: false })
      continue
    }
    const outcome = await withTimeout(
      searchViaChain(q, { num: 6 }),
      budget.searchTimeoutMs + 6_000,
      `search: ${q.slice(0, 60)}`,
    )
    if (outcome.results.length > 0) cache.put(outcome.results)
    if (outcome.error) degraded.push(`search "${q.slice(0, 60)}" via ${outcome.via} failed after ${outcome.attempts} attempt(s): ${outcome.error}`.slice(0, 240))
    outcomes.push(outcome)
  }

  const merged = outcomes.flatMap((o) => o.results)
  if (merged.length === 0) {
    return { mode: args.mode, queries, sources: [], degraded: [...degraded, 'no results retrieved'], durationMs: Date.now() - t0, fetchedAt: new Date().toISOString(), language: analysis }
  }

  const ranked: RankedSource[] = rankSources(args.message, merged, { freshnessMatters: false, limit: 4 })

  // Budgeted page reads: only when snippets are thin.
  const thin = ranked.filter((s) => s.snippet.length < 260).slice(0, budget.maxPages)
  const excerpts = new Map<string, string>()
  if (thin.length > 0 && args.mode === 'grounded') {
    await mapWithConcurrency(thin, 2, async (s) => {
      const pc = getPageCache<unknown>(s.url)
      if (pc.hit) {
        const content = pc.value as { text?: string }
        if (typeof content?.text === 'string' && isUsablePageText(content.text)) {
          excerpts.set(s.url, content.text.slice(0, budget.maxBytesPerPage))
        }
        return
      }
      try {
        const page = await withTimeout(runSharedPageRead(s.url), budget.pageTimeoutMs, `read: ${s.hostName}`)
        if (isUsablePageText(page.text)) {
          pc.put(page)
          excerpts.set(s.url, page.text.slice(0, budget.maxBytesPerPage))
        }
      } catch (e) {
        degraded.push(`page read failed for ${s.hostName}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
      }
    })
  } else if (thin.length > 0) {
    // multimodal mode: one page max, snippet-first otherwise
    const s = thin[0]
    try {
      const page = await withTimeout(runSharedPageRead(s.url), budget.pageTimeoutMs, `read: ${s.hostName}`)
      if (isUsablePageText(page.text)) {
        excerpts.set(s.url, page.text.slice(0, budget.maxBytesPerPage))
      }
    } catch (e) {
      degraded.push(`page read failed for ${s.hostName}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    }
  }

  const sources: IntelSource[] = ranked.map((s, i) => ({
    id: i + 1,
    url: s.url,
    title: s.title,
    snippet: s.snippet,
    hostName: s.hostName,
    date: s.date,
    excerpt: excerpts.get(s.url) ?? null,
  }))

  return {
    mode: args.mode,
    queries,
    sources,
    degraded,
    durationMs: Date.now() - t0,
    fetchedAt: new Date().toISOString(),
    language: analysis,
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** True when an image/video scene names a specific real-world entity. */
export function entityFactQuery(plan: ScenePlan): string | null {
  const named = plan.subjects.find((s) => s.namedEntity)
  if (!named) return null
  return `${named.mention} appearance characteristics`
}
