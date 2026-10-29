/**
 * BEAN Intelligence — product status derivation (pure, client-safe).
 *
 * MEASURED CHANGE (2026-10-29 product-availability audit): the dashboard
 * previously collapsed every product into Operational/Unavailable from a
 * single boolean, which could report a product fully Operational while one
 * of its REAL, separately rate-limited capabilities (current-web research
 * for RIISHE, sandbox execution for CODE GIFTZ) was failing upstream.
 *
 * Three states, derived ONLY from measured probe results:
 *  - 'operational'  -> core available and every reported capability available
 *                      (or no capability evidence exists yet);
 *  - 'degraded'     -> core available but a measured secondary capability is
 *                      unavailable (partial availability — the honest middle
 *                      state between green and red);
 *  - 'unavailable'  -> the core dependency is unavailable (or the registry
 *                      has no enabled backend for the product).
 *
 * Honesty rules:
 *  - this function never upgrades a failure and never invents evidence;
 *  - with no health probe at all, the registry's enabled-backend flag
 *    decides (unchanged pre-audit behavior);
 *  - a probe result always outranks the registry flag for the core
 *    dependency (measured beats configured), but a disabled registry entry
 *    still forces 'unavailable' — a product with no enabled backend is not
 *    operational even if some probe happens to pass.
 */

export type ProductStatus = 'operational' | 'degraded' | 'unavailable'

/** Shape of one product's entry in the /api/health payload (client-safe). */
export interface ProductHealthEntry {
  available: boolean
  /** RIISHE — current-web research (functions endpoint class). */
  research?: { available: boolean }
  /** CODE GIFTZ — local sandbox execution capability. */
  sandbox?: { available: boolean }
}

export function productStatus(
  registryAvailable: boolean,
  probe?: ProductHealthEntry,
): ProductStatus {
  // A product with no enabled backend is unavailable regardless of probes.
  if (!registryAvailable) return 'unavailable'
  if (!probe) return 'operational' // no health evidence yet — registry decides
  if (!probe.available) return 'unavailable'
  const secondary = probe.research ?? probe.sandbox
  if (secondary && !secondary.available) return 'degraded'
  return 'operational'
}
