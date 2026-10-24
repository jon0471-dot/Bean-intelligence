/**
 * BEAN Intelligence — video adapter (JAZMII).
 *
 * TRUTH POLICY: no video-generation backend is deployed in this environment.
 * There is no adapter implementation to fake — only a health report that
 * says so. The router reads `enabled=false` from the registry and refuses
 * requests with NO_BACKEND before this adapter is ever consulted.
 *
 * When a real GPU worker is deployed (see docs/models/MODEL-EVALUATION-
 * REPORT.md candidates), implement TaskAdapter here and flip the registry
 * entry to enabled:true.
 */
import type { HealthReport, TaskAdapter } from './types'

const BACKEND_ID = 'bean-video-selfhosted-candidate'

export const videoAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    return {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      detail:
        'No video-generation worker is deployed: no GPU capacity and no authorized hosted video endpoint is configured for this environment.',
    }
  },
}
