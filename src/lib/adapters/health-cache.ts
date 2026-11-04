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
  /** Key -> checkedAt of the last probe that ACTUALLY succeeded (fresh run,
   *  not a cached replay). Survives cache-TTL expiry; resets on process
   *  restart (an honest unknown rather than a fabricated timestamp). */
  lastHealthyAt: Map<string, string>
}

function store(): HealthCacheStore {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[STORE_KEY]) g[STORE_KEY] = { cache: new Map(), inFlight: new Map(), lastHealthyAt: new Map() }
  const s = g[STORE_KEY] as HealthCacheStore
  // Shape backfill: a store object created by an older module instance (dev
  // hot-reload or route-bundle duplication — the exact fragmentation this
  // globalThis keying exists for) may predate a newer field. MEASURED live
  // 2026-11-04: lastHealthyAtFor crashed with "Cannot read properties of
  // undefined (reading 'get')" against a store created before the field
  // existed. Backfill instead of trusting the shape.
  if (!s.lastHealthyAt) s.lastHealthyAt = new Map()
  return s
}

export function clearHealthCacheForTests(): void {
  const s = store()
  s.cache.clear()
  s.inFlight.clear()
  s.lastHealthyAt.clear()
}

/**
 * MEASURED CHANGE (2026-11-04 connectivity audit): expose WHEN a backend
 * last passed its real probe. The dashboard renders this as "last successful
 * check" so a consumer can always tell how old the evidence behind a status
 * is — a cached report keeps its original checkedAt, and this tracker keeps
 * the last success even after the cache entry itself has expired.
 */
export function lastHealthyAtFor(key: string): string | null {
  return store().lastHealthyAt.get(key) ?? null
}

export async function cachedHealth(
  key: string,
  probe: () => Promise<HealthReport>,
  opts?: { ttlMs?: number },
): Promise<HealthReport> {
  const ttlMs = opts?.ttlMs ?? HEALTH_CACHE_TTL_MS
  const now = Date.now()
  const { cache, inFlight, lastHealthyAt } = store()
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
      // A fresh SUCCESS records the last-healthy timestamp (a cached replay
      // never touches this — only real probe outcomes do).
      if (report.healthy) lastHealthyAt.set(key, report.checkedAt)
      return report
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}
