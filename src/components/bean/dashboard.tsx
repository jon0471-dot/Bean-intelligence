'use client'

/**
 * BEAN Intelligence — dashboard: four flagship products + live availability.
 *
 * MEASURED CHANGE (2026-11-04 connectivity audit) — availability information
 * only; the card design, colors, typography and grid are unchanged:
 *  - the health data is REFRESHED periodically (45s) and on tab focus, and a
 *    manual refresh control exists — availability used to be fetched ONCE on
 *    mount and then presented as current forever, however old it got;
 *  - a 'checking' state shows while a probe round-trip is in flight;
 *  - failures show their MEASURED category + HTTP status (from the health
 *    payload's structured failureCategory/httpStatus fields) instead of a
 *    bare red badge with no reason;
 *  - 'not configured' (no backend deployed — JAZMII) is now distinguished
 *    from 'unavailable' (a deployed backend failed its probe);
 *  - probe durations render ONLY for probes that actually completed
 *    (latencyMs != null); a deferred probe (429 breaker open) or a product
 *    with nothing to probe shows no duration;
 *  - every card shows how old its evidence is ("checked Ns ago" from the
 *    real probe's checkedAt) and a refresh failure is announced instead of
 *    silently presenting stale data as current.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Image as ImageIcon, Video, Code2, RefreshCw, Sparkles } from 'lucide-react'
import { beanFetch, GoldBadge, StatusDot, type BeanProductPublic } from './shared'
import { RiisheIcon } from '@/components/riishe/RiisheIcon'
import { productStatus, type ProductHealthEntry, type ProductStatus } from '@/lib/registry/status'
import { Skeleton } from '@/components/ui/skeleton'
import type { ViewId } from './shell'

const ICONS: Record<string, React.ElementType> = {
  // RIISHE carries the custom robot-head emblem; the other products keep
  // their existing Lucide glyphs.
  riishe: RiisheIcon,
  laxii: ImageIcon,
  jazmii: Video,
  'code-giftz': Code2,
}

/** Refresh cadence: slower than the server's 20s probe cache TTL window
 *  (each refresh therefore carries a REAL re-probe, not a cache replay),
 *  fast enough that the 45s-old data never looks current. */
const HEALTH_REFRESH_INTERVAL_MS = 45_000
/** Client-side bound for the health request itself (connection timeouts and
 *  failure handling — a hung request must resolve into an honest error). */
const HEALTH_FETCH_TIMEOUT_MS = 15_000
/** Minimum gap between automatic refreshes (tab-focus storms). */
const MIN_REFRESH_GAP_MS = 10_000

interface ProbeInfo {
  detail: string
  latencyMs: number | null
  checkedAt?: string
  httpStatus?: number | null
  failureCategory?: string | null
  cached?: boolean
}

/** GO-LIVE FINALIZATION (2026-11-05): per-capability measured health row
 *  served by /api/health. The badge aggregates status-affecting rows; the
 *  card footer names the failing capabilities with their evidence age. */
interface CapabilityRow {
  id?: string
  label?: string
  core?: boolean
  state: 'operational' | 'degraded' | 'blocked' | 'unavailable' | 'not-configured'
  statusAffecting: boolean
  evidence?: {
    checkedAt?: string | null
    source?: string
    failureCategory?: string | null
    httpStatus?: number | null
    note?: string
  }
}

function capLabel(c: CapabilityRow): string {
  return c.label ?? c.id ?? 'capability'
}

interface HealthData {
  products: Record<
    string,
    ProductHealthEntry & {
      status?: ProductStatus
      probe?: ProbeInfo
      lastHealthyAt?: string | null
      lastGenerationAttempt?: {
        at: string
        ok: boolean
        failureCategory?: string | null
        httpStatus?: number | null
      } | null
      research?: { available: boolean; probe?: ProbeInfo }
      sandbox?: { available: boolean; probe?: ProbeInfo }
      capabilities?: CapabilityRow[]
    }
  >
}

/** Human labels for the measured failure categories (never raw details).
 *  Compact by design: the card footer must stay a single line so all four
 *  cards can share one height (the 2026-11-04 card-uniformity change). */
const FAILURE_LABELS: Record<string, string> = {
  'rate-limited': 'rate-limited',
  auth: 'credentials rejected',
  billing: 'account restricted',
  timeout: 'timed out',
  network: 'connection lost',
  unreachable: 'unreachable',
  misconfigured: 'misconfigured',
  redirected: 'redirected probe',
  'not-configured': 'backend not deployed',
  'backend-error': 'backend error',
}

function failureLabel(category?: string | null, httpStatus?: number | null): string {
  if (!category) return ''
  const base = FAILURE_LABELS[category] ?? 'backend error'
  return httpStatus != null ? `${base} (HTTP ${httpStatus})` : base
}

function ageSeconds(checkedAt: string | undefined, now: number): number | null {
  if (!checkedAt) return null
  const t = Date.parse(checkedAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 1000))
}

/** Capability-probe failure fields (research / sandbox secondary probes). */
function capInfo(p?: ProbeInfo): { category?: string | null; httpStatus?: number | null } {
  return { category: p?.failureCategory ?? null, httpStatus: p?.httpStatus ?? null }
}

function formatAge(age: number | null): string {
  if (age == null) return ''
  if (age < 5) return 'just now'
  if (age < 90) return `${age}s ago`
  return `${Math.floor(age / 60)}m ago`
}

export function Dashboard({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [products, setProducts] = useState<BeanProductPublic[] | null>(null)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastRefreshAtRef = useRef(0)

  const refreshHealth = useCallback(async () => {
    // Avoid excessive health-check requests: skip if a refresh is already in
    // flight or one completed less than the minimum gap ago.
    if (Date.now() - lastRefreshAtRef.current < MIN_REFRESH_GAP_MS) return
    lastRefreshAtRef.current = Date.now()
    setRefreshing(true)
    try {
      const h = await beanFetch<HealthData>('/api/health', { timeoutMs: HEALTH_FETCH_TIMEOUT_MS })
      setHealth(h)
      setRefreshError(null)
    } catch (e) {
      // Keep the last measured status visible, but SAY the refresh failed —
      // stale information must never pass itself off as current.
      setRefreshError(
        e instanceof Error && e.name === 'AbortError'
          ? `refresh timed out after ${HEALTH_FETCH_TIMEOUT_MS / 1000}s`
          : 'refresh failed',
      )
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [p] = await Promise.all([
          beanFetch<{ products: BeanProductPublic[] }>('/api/products', { timeoutMs: HEALTH_FETCH_TIMEOUT_MS }),
          refreshHealth(),
        ])
        setProducts(p.products)
      } catch {
        setProducts([])
        setRefreshError('could not reach the availability service')
      }
    })()

    // Periodic refresh without a full page reload + refresh when the tab
    // becomes visible again (returning to a stale tab updates it first).
    const interval = setInterval(() => void refreshHealth(), HEALTH_REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshHealth()
    }
    document.addEventListener('visibilitychange', onVisible)
    // Lightweight ticker so "checked Ns ago" stays truthful between refreshes.
    const tick = setInterval(() => setNow(Date.now()), 10_000)
    return () => {
      clearInterval(interval)
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshHealth])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to <span className="bean-gold-text">BEAN Intelligence</span>
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          Four flagship products, one private routing layer. Availability below reflects measured backend probes — never assumptions.
        </p>
      </div>

      {/* sm:auto-rows-fr: both grid rows share one resolved height, so all
          four product cards are exactly the same size at every 2-column
          viewport (card-uniformity requirement). Above ~1200px both rows
          already rest on the shared 207px min-height floor, so nothing
          changes there; below it, the row height follows the tallest card's
          wrapped text instead of clipping it (no text may be truncated).
          Base (mobile, single column) keeps per-content row heights. */}
      <div className="grid gap-4 sm:auto-rows-fr sm:grid-cols-2">
        {(products ?? Array.from({ length: 4 }, () => null)).map((p, i) => {
          if (!p) return <Skeleton key={i} className="h-44 rounded-xl bg-white/5" />
          const Icon = ICONS[p.id] ?? Sparkles
          const probe = health?.products?.[p.id]
          const status = productStatus(p.available, probe)
          const checking = refreshing && health !== null
          const latency = probe?.probe?.latencyMs
          const coreFailed = status === 'unavailable'
          // GO-LIVE (2026-11-05): the failing-capability line is derived from
          // the measured capability rows (with a fallback to the legacy
          // slots when a payload predates them). Only status-affecting rows
          // are named — display-only rows stay in the payload.
          const failingCapabilities: CapabilityRow[] =
            probe?.capabilities?.filter((c) => c.statusAffecting && c.state !== 'operational') ??
            (status === 'degraded'
              ? ([
                  p.id === 'riishe'
                    ? { id: 'research', label: 'research', core: false, state: 'unavailable' as const, statusAffecting: true, evidence: capInfo(probe?.research?.probe) }
                    : p.id === 'code-giftz'
                      ? { id: 'sandbox', label: 'sandbox', core: false, state: 'unavailable' as const, statusAffecting: true, evidence: capInfo(probe?.sandbox?.probe) }
                      : { id: 'generation', label: 'generation', core: true, state: 'unavailable' as const, statusAffecting: true, evidence: { failureCategory: probe?.generation?.failureCategory ?? null, httpStatus: probe?.generation?.httpStatus ?? null } },
                ] as CapabilityRow[])
              : [])
          const failureText =
            coreFailed || status === 'not-configured'
              ? failureLabel(probe?.probe?.failureCategory, probe?.probe?.httpStatus)
              : failingCapabilities.length > 0
                ? failingCapabilities
                    .map((c) => `${capLabel(c)}: ${failureLabel(c.evidence?.failureCategory, c.evidence?.httpStatus) || c.state}`)
                    .join(' · ')
                : ''
          const capabilityTitle = failingCapabilities
            .map((c) => {
              const at = c.evidence?.checkedAt ? new Date(c.evidence.checkedAt).toLocaleString() : 'no timestamp'
              const note = c.evidence?.note ? ` — ${c.evidence.note}` : ''
              return `${capLabel(c)} (${c.state}, via ${c.evidence?.source ?? 'probe'}, checked ${at})${note}`
            })
            .join('\n')
          return (
            <button
              key={p.id}
              onClick={() => onNavigate(p.id as ViewId)}
              className="bean-glass bean-glass-hover group min-w-0 overflow-hidden rounded-xl p-5 text-left sm:min-h-[207px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.07)]">
                    <Icon className="h-5 w-5 text-[#d4af37]" />
                  </div>
                  <div className="min-w-0">
                    <div className="break-words text-[15px] font-semibold tracking-wide">{p.name}</div>
                    <div className="break-words text-xs text-white/45">{p.tagline}</div>
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap">
                  {checking ? (
                    /* Probe round-trip in flight — the honest transient state.
                       Existing badge atom, existing tones: no new styles. */
                    <GoldBadge tone="gold">Checking…</GoldBadge>
                  ) : !health ? (
                    <GoldBadge tone="gold">Status unknown</GoldBadge>
                  ) : status === 'operational' ? (
                    <GoldBadge tone="green"><span className="mr-1 inline-flex items-center gap-1.5"><StatusDot ok pulse={false} />Operational</span></GoldBadge>
                  ) : status === 'degraded' ? (
                    /* Gold badge, deliberately without a status dot: the existing
                       StatusDot only encodes ok/not-ok (green/red), and a degraded
                       product is neither — the text carries the state. */
                    <GoldBadge tone="gold">Degraded</GoldBadge>
                  ) : status === 'not-configured' ? (
                    /* Missing configuration is a DIFFERENT situation from a
                       failed connection (external providers without credentials). */
                    <GoldBadge tone="gold">Not configured</GoldBadge>
                  ) : (
                    <GoldBadge tone="red"><span className="mr-1 inline-flex items-center gap-1.5"><StatusDot ok={false} />Unavailable</span></GoldBadge>
                  )}
                </span>
              </div>
              <p className="mt-3 min-h-[40px] break-words text-[13px] leading-relaxed text-white/55">{p.description}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span
                  className="min-w-0 break-words text-[11px] text-white/35"
                  title={
                    capabilityTitle
                      ? capabilityTitle
                      : probe?.probe?.detail
                        ? `${probe.probe.detail}${probe.probe.checkedAt ? ` (checked ${new Date(probe.probe.checkedAt).toLocaleString()})` : ''}`
                        : undefined
                  }
                >
                  {/* Duration ONLY for a probe that actually completed. The
                      per-probe checkedAt lives in the payload and the hover
                      tooltip; the visible age indicator is global (next to
                      Refresh) because all cards share one fetch cycle. */}
                  {health
                    ? latency != null
                      ? `probe ${latency}ms`
                      : status === 'not-configured'
                        ? 'not probed'
                        : 'probe deferred'
                    : ''}
                  {failureText ? ` · ${failureText}` : ''}
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-[#f0c75e] opacity-70 transition-opacity group-hover:opacity-100">
                  Open workspace <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Brand-owned products</div>
          <p className="text-xs leading-relaxed text-white/45">
            You select BEAN products. Upstream model selection stays private and is enforced server-side.
          </p>
        </div>
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Real status only</div>
          <p className="text-xs leading-relaxed text-white/45">
            Jobs are marked complete only when real output exists. Unavailable products say so.
          </p>
        </div>
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Metered &amp; guarded</div>
          <p className="text-xs leading-relaxed text-white/45">
            Per-product quotas, rate limits and concurrency are enforced in the API, not the UI.
          </p>
        </div>
      </div>

      {/* Manual refresh — availability information only, existing styling.
          The global "last checked" age keeps stale data from posing as
          current without lengthening any card footer. */}
      <div className="mt-3 flex items-center justify-end gap-3">
        {health ? (
          <span className="text-[11px] text-white/35">
            {refreshError
              ? `refresh failed (${refreshError}) — showing the last measured status`
              : `availability checked ${formatAge(ageSeconds(health.products?.riishe?.probe?.checkedAt, now))}`}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void refreshHealth()}
          disabled={refreshing || products === null}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f0c75e] opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Checking availability…' : 'Refresh availability'}
        </button>
      </div>
    </div>
  )
}
