/**
 * BEAN Intelligence — search provider chain.
 *
 * Order via BEAN_INTEL_SEARCH_ORDER (default "gateway,searxng"):
 *   1. gateway  — the authorized web_search (measured breaker semantics)
 *   2. searxng  — the self-hosted SearXNG lane (zero gateway quota)
 *
 * The chain exists so RESEARCH SURVIVES GATEWAY THROTTLE WINDOWS: the
 * measured account-wide 429 windows no longer take live knowledge down with
 * them. `via` records what actually served a query — the answer layer never
 * claims a provider it did not use. Lives in its own module (no import
 * cycle with research/pipeline, whose bounded-retry semantics it reuses).
 */

import { searchWithBoundedRetry, type BoundedSearchOutcome } from '@/lib/research/pipeline'
import { searxngSearch } from './providers/searxng'

export type SearchVia = 'gateway' | 'searxng' | 'none'

export type SearchViaOutcome = BoundedSearchOutcome & { via: SearchVia }

export async function searchViaChain(
  q: string,
  opts: { num?: number; recencyDays?: number } = {},
): Promise<SearchViaOutcome> {
  const order = (process.env.BEAN_INTEL_SEARCH_ORDER?.trim() || 'gateway,searxng')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const errors: string[] = []
  let attempts = 0
  let retried = false
  // Authoritative-zero-results propagation: when the gateway explicitly
  // answered "nothing in the index" and no other provider served results,
  // the chain-level outcome carries that honest signal forward.
  let authoritativeEmpty = false
  for (const provider of order) {
    if (provider === 'gateway') {
      const outcome = await searchWithBoundedRetry(q, opts) // never throws
      attempts += outcome.attempts
      retried = retried || outcome.retried
      if (outcome.results.length > 0) return { ...outcome, attempts, retried, via: 'gateway' }
      if (outcome.noResults) authoritativeEmpty = true
      if (outcome.error) errors.push(`gateway: ${outcome.error}`)
    } else if (provider === 'searxng') {
      try {
        const results = await searxngSearch(q, { num: opts.num ?? 6 })
        if (results.length > 0) return { results, attempts: attempts + 1, retried, error: null, noResults: false, via: 'searxng' }
      } catch (e) {
        errors.push(`searxng: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  // EVERY provider failure is reported — never just the last one (a throttled
  // gateway followed by an unreachable SearXNG must show both truths).
  return {
    results: [],
    attempts,
    retried,
    error: errors.length > 0 ? errors.join(' | ').slice(0, 500) : 'no search provider returned results',
    noResults: authoritativeEmpty,
    via: 'none',
  }
}
