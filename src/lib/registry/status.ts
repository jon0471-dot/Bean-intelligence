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
 * States, derived ONLY from measured probe results + registry configuration:
 *  - 'operational'    -> core available and every reported capability
 *                        available (or no capability evidence exists yet);
 *  - 'degraded'       -> core available but a measured secondary capability
 *                        is unavailable (partial availability — the honest
 *                        middle state between green and red);
 *  - 'unavailable'    -> the core dependency FAILED its probe (connection,
 *                        health check, throttle, auth — a measured failure
 *                        of a backend that IS configured);
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
 */

export type ProductStatus = 'operational' | 'degraded' | 'unavailable' | 'not-configured'

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
   *  that is throttling generations is Degraded, not Operational. */
  generation?: {
    available: boolean
    failureCategory?: string | null
    httpStatus?: number | null
    checkedAt?: string
    /** Set when the evidence is cross-class shared-account inference. */
    note?: string
  }
}

export function productStatus(
  registryAvailable: boolean,
  probe?: ProductHealthEntry,
): ProductStatus {
  // A product with no enabled backend is not-configured regardless of probes.
  if (!registryAvailable) return 'not-configured'
  if (!probe) return 'operational' // no health evidence yet — registry decides
  if (!probe.available) return 'unavailable'
  // Measured secondary-capability failures: research (RIISHE), sandbox
  // (CODE GIFTZ), and — since the 2026-11-04 connectivity audit — LAXII's
  // hosted generation as evidenced by the most recent REAL attempt. Any of
  // these failing while the core backend answers = degraded (partial
  // availability, never "fully operational while a measured capability
  // fails").
  const secondaryFailures = [
    probe.research,
    probe.sandbox,
    probe.generation,
  ].filter((cap) => cap && !cap.available)
  if (secondaryFailures.length > 0) return 'degraded'
  return 'operational'
}
