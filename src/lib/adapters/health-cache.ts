/**
 * BEAN Intelligence — short-lived health-probe cache with in-flight dedup.
 *
 * Why: the dashboard and health endpoint fire REAL backend probes on every
 * mount; repeated identical probes within seconds are pure overhead and —
 * during an upstream outage — a mini retry storm against a struggling or
 * quota-limited provider (measured: every /api/health request ran two live
 * completion probes).
 *
 * Honesty contract (work order 7):
 *  - a cached report is served at most TTL_MS old, keeps the ORIGINAL
 *    checkedAt of the real probe, and carries `cached: true` so consumers
 *    can never mistake it for a fresh probe result;
 *  - a failure result is cached like a success (never retried into a fake
 *    success), and identical concurrent probes share ONE provider call;
 *  - the underlying probe always decides health — this layer never upgrades
 *    or downgrades an outcome.
 */
import type { HealthReport } from './types'

export const HEALTH_CACHE_TTL_MS = 20_000

interface CacheEntry {
  report: HealthReport
  expiresAt: number
}

/**
 * globalThis-keyed (same pattern as the 429 breaker and the research cache):
 * Next.js route-bundle module duplication fragments module-level Maps, which
 * MEASURED 2026-10-29 — two /api/health requests seconds apart each ran a
 * fresh probe because each request resolved a different module instance.
 * Keying on globalThis makes the dedup actually hold across requests.
 */
const STORE_KEY = '__bean_health_probe_cache__'

interface HealthCacheStore {
  cache: Map<string, CacheEntry>
  inFlight: Map<string, Promise<HealthReport>>
}

function store(): HealthCacheStore {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[STORE_KEY]) g[STORE_KEY] = { cache: new Map(), inFlight: new Map() }
  return g[STORE_KEY] as HealthCacheStore
}

export function clearHealthCacheForTests(): void {
  const s = store()
  s.cache.clear()
  s.inFlight.clear()
}

export async function cachedHealth(
  key: string,
  probe: () => Promise<HealthReport>,
  opts?: { ttlMs?: number },
): Promise<HealthReport> {
  const ttlMs = opts?.ttlMs ?? HEALTH_CACHE_TTL_MS
  const now = Date.now()
  const { cache, inFlight } = store()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) {
    return { ...hit.report, cached: true }
  }
  const pending = inFlight.get(key)
  if (pending) return pending
  const p = probe()
    .then((report) => {
      // checkedAt stays the REAL probe time — staleness is visible, not hidden.
      cache.set(key, { report, expiresAt: Date.now() + ttlMs })
      return report
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}
