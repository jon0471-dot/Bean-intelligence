/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO availability snapshot mapping
 * (SERVER ONLY — the Studio-facing bridge over the REAL, existing capability
 * health model).
 *
 * CONTRACT (M50.1 §9 / M50.3 Phase 9):
 *  - the BROWSER can never submit a trusted availability claim: the
 *    validate/preview API routes never read an availability field from the
 *    request; the ONLY path into the Studio snapshot is THIS server-side
 *    mapping from real, existing BEAN health artifacts;
 *  - the mapping consumes the client-safe product payload shape the
 *    /api/health route already emits (ProductStatus +
 *    ProductHealthEntry.capabilities[] rows from
 *    src/lib/registry/{status,capabilities}.ts) — no new probe system is
 *    created here and no environment variable is ever read;
 *  - every real distinction is preserved: available / degraded /
 *    rate-limited / blocked / unavailable / not-configured; a product with
 *    NO entry maps to ABSENT — which the M50.2 pure core treats as
 *    'unknown' (honest silence, never a claim);
 *  - 'blocked' (the measured contract-blocker state in the capability
 *    vocabulary) is preserved EXPLICITLY instead of being collapsed into
 *    'degraded': the two have different remedies and the customer-safe
 *    diagnostics differ;
 *  - M50.3 routes do NOT attach a live snapshot by default: obtaining one
 *    requires the /api/health probe pass, and the validate/preview
 *    endpoints are cheap read-only calls. Absence of evidence is reported
 *    honestly (no diagnostics) rather than inventing a more precise
 *    status. Actual execution-time preflight remains authoritative in
 *    M50.5, which will call this mapping explicitly with a fresh,
 *    measured snapshot before creating any mission.
 *
 * PURE mapping — no I/O, no probes, no env reads, no time.
 */

import type { BeanProductId } from '@/lib/registry/products'
import type { ProductHealthEntry } from '@/lib/registry/status'
import type { AvailabilitySnapshot, StudioAvailabilityState } from './types'

/** The per-product shape M50.3 maps from — exactly what /api/health emits
 *  (a measured product entry, or nothing when there is no evidence). */
export type MeasuredProductHealth = Partial<Record<BeanProductId, ProductHealthEntry>>

/**
 * Map one product's measured health payload to the single Studio
 * availability state for its capability surface. Ordered most-specific
 * first:
 *  1. an explicit status-affecting capability row carrying 'blocked' wins —
 *     a measured contract blocker is not generic degradation;
 *  2. otherwise the product-level status is mapped verbatim
 *     (operational→available, degraded→degraded, rate-limited→rate-limited,
 *     unavailable→unavailable, not-configured→not-configured);
 *  3. a product whose row says capabilities are healthy but the core probe
 *     hard-failed maps to 'unavailable' (the payload's own truth);
 *  4. no entry / no evidence → undefined (ABSENT — the Studio core then
 *    treats it as 'unknown': no claim either way).
 */
export function mapProductHealthToStudioState(entry: ProductHealthEntry | undefined): StudioAvailabilityState | undefined {
  if (!entry) return undefined
  const blockingCap = entry.capabilities?.find((c) => c.statusAffecting && c.state === 'blocked')
  if (blockingCap) return 'blocked'
  switch (entry.status) {
    case 'operational':
      return 'available'
    case 'degraded':
      return 'degraded'
    case 'rate-limited':
      return 'rate-limited'
    case 'unavailable':
      return 'unavailable'
    case 'not-configured':
      return 'not-configured'
    default:
      // Unknown vocabulary or a payload without a status: fall back to the
      // boolean available flag ONLY when it truthfully reports a failure
      // (never synthesize availability from a bare true).
      return entry.available === false ? 'unavailable' : undefined
  }
}

/**
 * Build the Studio AvailabilitySnapshot from the measured per-product
 * health payload. Surfaces without real evidence stay absent (honest
 * silence). 'platform' is never part of the snapshot — inline platform
 * lanes are not availability-gated by snapshots (M50.2 pinned).
 */
export function studioAvailabilityFromHealth(measured: MeasuredProductHealth | undefined): AvailabilitySnapshot {
  const snapshot: AvailabilitySnapshot = {}
  if (!measured) return snapshot
  for (const product of Object.keys(measured) as BeanProductId[]) {
    const state = mapProductHealthToStudioState(measured[product])
    if (state) snapshot[product] = state
  }
  return snapshot
}
