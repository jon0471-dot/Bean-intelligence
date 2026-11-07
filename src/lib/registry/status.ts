/**
 * BEAN Intelligence — product status derivation (pure, client-safe).
 *
 * MEASURED CHANGE (2026-10-29 product-availability audit): the dashboard
 * previously collapsed every product into Operational/Unavailable from a
 * single boolean, which could report a product fully Operational while one
 * of its REAL, separately rate-limited capabilities (current-web research
 * for RIISHE, sandbox execution for CODE GIFTZ) was failing upstream.
 *
 * MEASURED CHANGE (2026-11-04 connectivity audit): the no-backend state is
 * now its own honest status — 'not-configured' — instead of being conflated
 * with a FAILED CONNECTION ('unavailable'). A product whose registry entry
 * has no enabled backend (JAZMII today: no video worker is deployed) is in
 * a DIFFERENT situation from a product whose deployed backend just failed
 * its probe; the dashboard must never show the same red badge for both.
 *
 * FINAL CAPABILITY FIX (2026-11-07) — the badge model the dashboard truth fix
 * requires. Two measured defects drove this change:
 *  1. A provider 429 window rendered as red "Unavailable" (or gold
 *     "Degraded") even when the ONLY problem was upstream throttling — a
 *     CODE GIFTZ chat probe that fails with HTTP 429 is a RATE-LIMITED
 *     product, not a broken one; and an LAXII t2i failure that is a 429 is
 *     not a generation defect.
 *  2. A failed OPTIONAL capability held the whole badge hostage: RIISHE's
 *     current-web research (functions class, separately throttled) turned
 *     the whole product Degraded while conversational chat was fully
 *     operational — implying every core capability was unavailable when it
 *     was not. Optional capabilities now render as their own capability rows
 *     and never move the badge.
 *
 * Product states, derived ONLY from measured probe results + registry
 * configuration:
 *  - 'operational'    -> every status-affecting capability is available;
 *  - 'rate-limited'   -> the only status-affecting problem is upstream
 *                        throttling (an observed 429 / an open class
 *                        breaker / the labeled shared-throttle inference);
 *                        external and transient — never rendered as a
 *                        product defect;
 *  - 'degraded'       -> at least one status-affecting capability is
 *                        blocked/degraded (a real functional gap beyond
 *                        throttling), core otherwise fine;
 *  - 'unavailable'    -> a core dependency hard-failed its probe for a
 *                        NON-throttle reason (connection, auth, timeout,
 *                        backend error);
 *  - 'not-configured' -> the registry has no enabled backend for the
 *                        product at all (missing deployment/configuration,
 *                        NOT a runtime failure).
 * ('checking' is a client-side transient while a probe is in flight; the
 *  server never reports it — a server report is always a measured result.)
 *
 * Honesty rules:
 *  - this function never upgrades a failure and never invents evidence;
 *  - with no health probe at all, the registry's enabled-backend flag
 *    decides (unchanged pre-audit behavior);
 *  - a probe result always outranks the registry flag for the core
 *    dependency (measured beats configured), but a disabled registry entry
 *    still forces 'not-configured' — a product with no enabled backend is
 *    not operational even if some probe happens to pass.
 *
 * FINAL CAPABILITY FIX (2026-11-07) — the badge model the dashboard truth fix
 * requires. Two measured defects drove this change:
 *  1. A provider 429 window rendered as red "Unavailable" (or gold
 *     "Degraded") even when the ONLY problem was upstream throttling — a
 *     CODE GIFTZ chat probe that fails with HTTP 429 is a RATE-LIMITED
 *     product, not a broken one; and an LAXII t2i failure that is a 429 is
 *     not a generation defect.
 *  2. A failed OPTIONAL capability held the whole badge hostage: RIISHE's
 *     current-web research (functions class, separately throttled) turned
 *     the whole product Degraded while conversational chat was fully
 *     operational — implying every core capability was unavailable when it
 *     was not. Optional capabilities now render as their own capability rows
 *     and never move the badge.
 *
 * Product states:
 *  - 'operational'    -> every status-affecting capability is available;
 *  - 'rate-limited'   -> the only status-affecting problem is upstream
 *                        throttling (an observed 429 / an open class
 *                        breaker / the labeled shared-throttle inference);
 *                        external and transient — never rendered as a
 *                        product defect;
 *  - 'degraded'       -> at least one status-affecting capability is
 *                        blocked/degraded (a real functional gap beyond
 *                        throttling), core otherwise fine;
 *  - 'unavailable'    -> a core dependency hard-failed its probe for a
 *                        NON-throttle reason (connection, auth, timeout,
 *                        backend error);
 *  - 'not-configured' -> the registry has no enabled backend for the
 *                        product at all (missing deployment/configuration,
 *                        NOT a runtime failure).
 * ('checking' is a client-side transient while a probe is in flight; the
 *  server never reports it — a server report is always a measured result.)
 *
 * Honesty rules (unchanged):
 *  - this function never upgrades a failure and never invents evidence;
 *  - with no health probe at all, the registry's enabled-backend flag
 *    decides (unchanged pre-audit behavior);
 *  - a probe result always outranks the registry flag for the core
 *    dependency (measured beats configured), but a disabled registry entry
 *    still forces 'not-configured' — a product with no enabled backend is
 *    not operational even if some probe happens to pass.
 */

export type ProductStatus = 'operational' | 'degraded' | 'rate-limited' | 'unavailable' | 'not-configured'

/** True when a failure category / status is upstream throttling. */
function isThrottle(category?: string | null, httpStatus?: number | null): boolean {
  return category === 'rate-limited' || httpStatus === 429
}

/** Shape of one product's entry in the /api/health payload (client-safe). */
export interface ProductHealthEntry {
  available: boolean
  /** RIISHE — current-web research (functions endpoint class). */
  research?: { available: boolean }
  /** CODE GIFTZ — local sandbox execution capability. */
  sandbox?: { available: boolean }
  /** LAXII/JAZMII — hosted generation capability, evidenced by the most
   *  recent REAL generation attempt (2026-11-04 connectivity audit) or by
   *  the LABELED shared-account throttle inference. A reachable gateway
   *  that is throttling generations is Degraded, not Operational.
   *  GO-LIVE FIX (2026-11-05): this slot is only emitted from REAL success
   *  or failure evidence — a failed attempt can never render as
   *  available:true (the previous fallback did exactly that). */
  generation?: {
    available: boolean
    failureCategory?: string | null
    httpStatus?: number | null
    checkedAt?: string
    /** Set when the evidence is cross-class shared-account inference. */
    note?: string
  }
  /** GO-LIVE FINALIZATION (2026-11-05): capability-level health rows. Any
   *  status-affecting row that is not operational degrades the product —
   *  an advertised capability being blocked (measured contract blocker,
   *  unverified capability) must never coexist with a fully-Operational
   *  badge. Pure display rows (statusAffecting:false) never move the badge.
   *  Structural (client-safe) subset of the server's CapabilityHealth. */
  capabilities?: Array<{
    id?: string
    label?: string
    core?: boolean
    state: 'operational' | 'degraded' | 'rate-limited' | 'blocked' | 'unavailable' | 'not-configured'
    statusAffecting: boolean
    evidence?: {
      checkedAt?: string | null
      source?: string
      failureCategory?: string | null
      httpStatus?: number | null
      note?: string
    }
  }>
  /** The product's own core-dependency probe (for throttle classification
   *  of a hard `available:false` in payloads that predate capability rows). */
  probe?: { failureCategory?: string | null; httpStatus?: number | null }
}

export function productStatus(
  registryAvailable: boolean,
  probe?: ProductHealthEntry,
): ProductStatus {
  // A product with no enabled backend is not-configured regardless of probes.
  if (!registryAvailable) return 'not-configured'
  if (!probe) return 'operational' // no health evidence yet — registry decides

  const caps = probe.capabilities
  const throttleOf = () =>
    isThrottle(probe.probe?.failureCategory, probe.probe?.httpStatus) ? 'rate-limited' : 'unavailable'

  // FINAL CAPABILITY FIX (2026-11-07): capability rows are authoritative
  // when present. Aggregation is severity-ordered over STATUS-AFFECTING
  // rows only; display-only rows never move the badge.
  if (caps && caps.length > 0) {
    const states = new Set(caps.filter((c) => c.statusAffecting).map((c) => c.state))
    if (states.has('unavailable')) return 'unavailable'
    if (states.has('blocked') || states.has('degraded')) return 'degraded'
    if (states.has('rate-limited')) return 'rate-limited'
    // All status-affecting rows healthy — the product-level probe is a
    // safety net against an inconsistent payload (e.g. rows stale while the
    // core dependency just died).
    if (!probe.available) return throttleOf()
    return 'operational'
  }

  // Legacy payload (predates capability rows): the pre-2026-11-07 boolean
  // rules, now throttle-aware.
  if (!probe.available) return throttleOf()
  // Measured secondary-capability failures: research (RIISHE), sandbox
  // (CODE GIFTZ), and LAXII/JAZMII hosted generation as evidenced by the
  // most recent REAL attempt — degraded (partial availability).
  const secondaryFailures = [probe.research, probe.sandbox, probe.generation].filter(
    (cap) => cap && !cap.available,
  )
  if (secondaryFailures.length > 0) return 'degraded'
  return 'operational'
}
