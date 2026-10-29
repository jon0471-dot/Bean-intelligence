/**
 * BEAN Intelligence — freshness-aware research cache.
 *
 * Short-TTL caches for web search results and fetched pages so repeated or
 * overlapping questions do not re-pay provider latency (and rate-limit
 * budget) within a conversational window. Freshness rules:
 *   - high-risk (rapidly changing facts): 90 seconds
 *   - moderate risk (docs, laws, explicit lookups): 5 minutes
 *   - page reads: 10 minutes (page content moves slower than rankings)
 *
 * Honesty contract: cached entries remember WHEN they were fetched
 * (`fetchedAt`), and the pipeline surfaces that timestamp as the evidence's
 * "last checked" time — a cache hit never pretends to be a fresh fetch.
 * The cache is process-wide (globalThis) so Next.js route-bundle module
 * duplication cannot fragment it (same pattern as the LLM probe cache).
 */

const SEARCH_TTL_HIGH_MS = 90_000
const SEARCH_TTL_MODERATE_MS = 300_000
const PAGE_TTL_MS = 600_000
/** Unbounded growth guard: the cache holds at most this many entries. */
const MAX_ENTRIES = 128

const STORE_KEY = '__bean_research_cache__'

interface CacheEntry<T> {
  value: T
  at: number
}

interface ResearchCacheStore {
  search?: Map<string, CacheEntry<unknown[]>>
  page?: Map<string, CacheEntry<unknown>>
}

function store(): ResearchCacheStore {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[STORE_KEY]) g[STORE_KEY] = { search: new Map(), page: new Map() }
  return g[STORE_KEY] as ResearchCacheStore
}

/** Normalize a query into a stable cache key (case/punctuation-insensitive). */
export function normalizeQueryKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ')
}

function evictOldest(map: Map<string, CacheEntry<unknown>>, max: number): void {
  while (map.size > max) {
    const oldestKey = map.keys().next().value
    if (oldestKey === undefined) break
    map.delete(oldestKey)
  }
}

export interface CachedResult<T> {
  value: T
  /** ISO timestamp of the ORIGINAL fetch that populated the entry. */
  fetchedAt: string
  ageMs: number
  hit: true
}

export interface MissToken<T> {
  hit: false
  /** Call this with the freshly fetched value to populate the cache. */
  put: (value: T) => void
}

/**
 * Read a cached search result set. `risk` selects the TTL tier (freshness
 * rule): 'high' entries expire fast so rapidly changing facts re-verify;
 * 'moderate' entries live longer.
 */
export function getSearchCache<T>(
  query: string,
  recencyDays: number | undefined,
  risk: 'none' | 'moderate' | 'high',
): CachedResult<T[]> | MissToken<T[]> {
  const map = store().search ?? (store().search = new Map())
  const key = `${normalizeQueryKey(query)}|r${recencyDays ?? 0}`
  const entry = map.get(key)
  const ttl = risk === 'high' ? SEARCH_TTL_HIGH_MS : SEARCH_TTL_MODERATE_MS
  if (entry && Date.now() - entry.at < ttl) {
    return {
      value: entry.value as T[],
      fetchedAt: new Date(entry.at).toISOString(),
      ageMs: Date.now() - entry.at,
      hit: true,
    }
  }
  return {
    hit: false,
    put: (value: T[]) => {
      map.set(key, { value, at: Date.now() })
      evictOldest(map, MAX_ENTRIES)
    },
  }
}

/** Read a cached page fetch (10-minute TTL, content moves slower than rankings). */
export function getPageCache<T>(url: string): CachedResult<T> | MissToken<T> {
  const map = store().page ?? (store().page = new Map())
  const entry = map.get(url)
  if (entry && Date.now() - entry.at < PAGE_TTL_MS) {
    return {
      value: entry.value as T,
      fetchedAt: new Date(entry.at).toISOString(),
      ageMs: Date.now() - entry.at,
      hit: true,
    }
  }
  return {
    hit: false,
    put: (value: T) => {
      map.set(url, { value, at: Date.now() })
      evictOldest(map, MAX_ENTRIES)
    },
  }
}

/** Test-only: drop every cached entry (unit tests use unique queries anyway). */
export function clearResearchCache(): void {
  const s = store()
  s.search?.clear()
  s.page?.clear()
}
