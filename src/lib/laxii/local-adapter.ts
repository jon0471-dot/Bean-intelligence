/**
 * LAXII — local deterministic engine adapter (bean-image-local-sharp).
 *
 * health() EXECUTES a real Sharp decode → resize → raw round-trip and
 * reports the measured outcome — the deterministic engine's availability is
 * proven by running it, never asserted (mirrors localPreflight() in
 * models.ts, which uses the same probe). It runs NO generative model: the
 * generative layer is the separate Diffusers worker adapter, probed and
 * reported as its own /api/health sub-state (see diffusers-adapter.ts).
 *
 * This adapter deliberately implements health() only. Enhancement jobs are
 * executed through the job queue (src/lib/laxii/jobs.ts) while the router's
 * preflight holds the registry concurrency slot, and the backend's registry
 * entry is generative:false — so there is no generateImage here.
 */
import type { HealthReport, TaskAdapter } from '@/lib/adapters/types'

export const localLaxiiAdapter: TaskAdapter = {
  backendId: 'bean-image-local-sharp',

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    const checkedAt = new Date().toISOString()
    try {
      const sharp = (await import('sharp')).default
      const probe = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8//8/AzGAiShVowoJAgCCTQMDzCTELAAAAABJRU5ErkJggg==',
        'base64',
      )
      // removeAlpha() makes the round-trip deterministic: the probe PNG is
      // RGBA, so a bare .raw() yields 4 channels (64 B) and a 3-channel
      // length check would false-negative a perfectly working engine
      // (measured 2026-11-01, sharp 0.34.5 — same defect fixed in
      // models.ts localPreflight).
      const out = await sharp(probe).resize(4, 4).removeAlpha().raw().toBuffer()
      if (out.length !== 4 * 4 * 3) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: Date.now() - t0,
          detail: `Sharp engine probe produced ${out.length} bytes where a 4x4 RGB raw buffer requires ${4 * 4 * 3} — the deterministic engine's output cannot be trusted on this host. Enhancement is unavailable.`,
        }
      }
      return {
        healthy: true,
        checkedAt,
        latencyMs: Date.now() - t0,
        detail: `Sharp engine EXECUTED a real decode → resize → raw round-trip in ${Date.now() - t0}ms (8x8 PNG in, 4x4 RGB verified). Deterministic enhancement is operational on this host. This probe runs NO generative model — generative editing is the separately probed Diffusers worker.`,
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - t0,
        detail: `Sharp engine probe FAILED: ${e instanceof Error ? e.message : String(e)}. Deterministic enhancement is unavailable on this host.`,
      }
    }
  },
}
