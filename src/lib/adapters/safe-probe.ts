/**
 * BEAN Intelligence — probe failure isolation.
 *
 * MEASURED CHANGE (2026-11-04 connectivity audit): every health probe in
 * /api/health and /api/v1/health runs through this wrapper. A probe that
 * THROWS (an unexpected implementation error rather than a measured backend
 * outcome) previously rejected the route's Promise.all and turned the whole
 * health endpoint into a 500 — one broken probe took the status of ALL
 * products down with it. Now the throw becomes an honest failed HealthReport
 * with a structured category, and the other products' probes are unaffected.
 * The wrapper never upgrades a failure and never fabricates a success: the
 * report it produces says exactly what happened, with no stack trace and no
 * internal detail beyond the error message (same evidence class as the
 * probes' own detail strings).
 */
import type { HealthReport } from './types'
import { cachedHealth } from './health-cache'

export async function safeProbe(key: string, probe: () => Promise<HealthReport>): Promise<HealthReport> {
  try {
    return await cachedHealth(key, probe)
  } catch (e) {
    return {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      httpStatus: null,
      failureCategory: 'backend-error',
      detail: `Probe implementation error (isolated so other products are unaffected): ${e instanceof Error ? e.message : String(e)}`.slice(0, 400),
    }
  }
}
