/**
 * BEAN Intelligence — research pipeline.
 *
 * Understand -> Retrieve: generates refined queries (one fast LLM call,
 * zod-validated), runs REAL web searches, dedups/ranks evidence and reads
 * the top pages where the snippet alone would be over-interpreted.
 *
 * Honesty contract: the returned EvidencePack contains only sources actually
 * retrieved by the provider. Failures degrade honestly (they are reported in
 * `degraded`) — the pipeline never invents or retries indefinitely.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { z } from 'zod'
import { webSearch, readPage, WebSearchResult, ResearchToolError } from './provider'
import { rankSources, stalenessWarning, RankedSource } from './rank'
import type { SearchDecision } from './policy'
import { coreTopic, detectSensitiveCase } from './sensitive'

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
  /** Numbered (1-based) sources for citation in the answer. */
  sources: EvidenceSource[]
  queries: string[]
  degraded: string[]
  staleness: string | null
  durationMs: number
}

const QUERY_SYSTEM =
  'You generate concise web search queries for a fact-checking pipeline. ' +
  'Given a user question, output 1-3 search queries that would surface authoritative, current sources. ' +
  'Prefer the exact entities, names, places and dates involved. ' +
  'For ongoing incidents (missing persons, crimes, accidents, disasters, investigations), include one ' +
  'query targeting the NEWEST developments (e.g. "<entity> latest update today") and one targeting official ' +
  'statements (police/government) where plausible. No explanations.'

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
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('query-gen timeout')), 8_000)),
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

export interface RunResearchOptions {
  maxSources?: number
  /** How many top sources to read in full (0 disables page reading). */
  readTopN?: number
}

/**
 * Build the final query set: LLM-refined queries plus, for ongoing incidents,
 * one deterministic newest-coverage query built from the core topic. The
 * extra query guarantees "newer coverage is searched before summarizing an
 * ongoing case" even when the LLM query-gen call fails or under-delivers.
 */
export function buildQuerySet(message: string, llmQueries: string[], usedFallback: boolean): { queries: string[]; usedFallback: boolean; addedFreshnessQuery: string | null } {
  const queries = llmQueries.slice(0, 3)
  let addedFreshnessQuery: string | null = null
  const sensitive = detectSensitiveCase(message)
  if (sensitive.sensitive) {
    const core = coreTopic(message)
    if (core) {
      const freshnessQuery = `${core} latest update`
      if (!queries.some((q) => q.toLowerCase().includes(core.toLowerCase().slice(0, 24)))) {
        // LLM queries drifted away from the core topic — anchor one to it.
        queries.unshift(truncateQuery(core))
      }
      queries.push(freshnessQuery)
      addedFreshnessQuery = freshnessQuery
    }
  }
  if (queries.length === 0) {
    queries.push(truncateQuery(message))
  }
  return { queries: queries.slice(0, 4), usedFallback, addedFreshnessQuery }
}

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
  const readTopN = opts.readTopN ?? 3

  const gen = await generateQueries(message, decision)
  const { queries, addedFreshnessQuery } = buildQuerySet(message, gen.queries, gen.usedFallback)
  if (gen.usedFallback) degraded.push('query refinement unavailable; searched the raw question')
  if (addedFreshnessQuery) degraded.push(`incident detected: added newest-coverage query "${addedFreshnessQuery.slice(0, 60)}"`)

  // --- retrieval (parallel, bounded) ---------------------------------------
  const settled = await Promise.allSettled(
    queries.map((q) =>
      webSearch(q, {
        num: 6,
        ...(decision.recencyDays ? { recencyDays: decision.recencyDays } : {}),
      }),
    ),
  )
  const rawResults: WebSearchResult[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') rawResults.push(...s.value)
    else
      degraded.push(
        `search "${queries[i].slice(0, 60)}" failed: ${
          s.reason instanceof ResearchToolError ? s.reason.message : 'unavailable'
        }`,
      )
  })

  if (rawResults.length === 0) {
    return {
      sources: [],
      queries,
      degraded: degraded.length > 0 ? degraded : ['web search returned no results'],
      staleness: null,
      durationMs: Date.now() - t0,
    }
  }

  const ranked = rankSources(message, rawResults, { freshnessMatters: decision.risk !== 'none', limit: maxSources })

  // --- full-page reading for the top sources (snippet != proof) -------------
  const sources: EvidenceSource[] = ranked.map((r) => ({ ...r, pageRead: false, excerpt: null }))
  const toRead = sources.slice(0, Math.max(0, readTopN))
  const readResults = await Promise.allSettled(toRead.map((s) => readPage(s.url)))
  readResults.forEach((res) => {
    if (res.status === 'fulfilled') {
      const match = sources.find((s) => samePage(s.url, res.value.url))
      if (match) {
        match.pageRead = true
        match.excerpt = res.value.text.slice(0, 6_000)
        // Publication-date verification: the page's own structured metadata
        // (JSON-LD/meta) is the authoritative publication date — it overrides
        // the search-engine-supplied date (often a crawl/index date).
        if (res.value.publishedTime) match.date = res.value.publishedTime
      }
    } else {
      degraded.push(`page read failed: ${res.reason instanceof ResearchToolError ? res.reason.message : 'unavailable'}`)
    }
  })

  // re-parse freshness in case page reading supplied a publishedTime
  return {
    sources,
    queries,
    degraded,
    staleness: stalenessWarning(sources, { timeSensitive: decision.risk !== 'none' }),
    durationMs: Date.now() - t0,
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

/** Compact, numbered evidence block for the solver prompt. */
export function formatEvidenceBlock(pack: EvidencePack): string | null {
  if (pack.sources.length === 0) return null
  const lines = pack.sources.map((s) => {
    const date = s.date ? ` (published ${s.date})` : ' (no publication date found — do NOT claim it is recent)'
    const kind = s.sourceType === 'social' ? ' [SOCIAL MEDIA — user-generated, not reporting]' : ''
    const body = s.excerpt ? s.excerpt.slice(0, 1_200) : s.snippet.slice(0, 600)
    return `[${s.id}] ${s.title}${date}${kind}\nURL: ${s.url}\nEXCERPT: ${body}`
  })
  return lines.join('\n\n')
}
