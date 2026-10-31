import { handle, ok } from '@/lib/api/errors'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { localLaxiiAdapter } from '@/lib/laxii/local-adapter'
import { diffusersWorkerAdapter } from '@/lib/laxii/diffusers-adapter'
import { cachedHealth } from '@/lib/adapters/health-cache'
import { probeResearchHealth } from '@/lib/research/provider'
import { probeSandboxHealth } from '@/lib/sandbox/runner'
import { getBackendsForProduct } from '@/lib/registry/backends'

/**
 * Liveness (this process) + readiness (real backend/capability probes).
 * Readiness results are MEASURED, never assumed — a backend whose probe
 * fails reports unhealthy here and the admin UI shows the same evidence.
 * Probes are deduplicated and cached for 20s (health-cache.ts): identical
 * concurrent requests share one real probe, cached reports keep the
 * original checkedAt and carry cached:true — a cached result is the last
 * REAL probe outcome, never a fabricated fresh success.
 *
 * MEASURED CHANGE (2026-10-29 product-availability audit) — the payload now
 * distinguishes the layers a product depends on, because the upstream
 * gateway rate-limits them SEPARATELY:
 *  - riishe.available            -> chat completion class (conversational core)
 *  - riishe.research.available   -> functions class (current-web research:
 *                                   web_search / page_reader). Reported
 *                                   separately so a research-specific 429
 *                                   can never masquerade as a fully
 *                                   operational product; the dashboard
 *                                   maps this to a Degraded state.
 *  - laxii.available             -> image backend reachable + configured.
 *                                   Reaching the gateway is NOT treated as
 *                                   proof of generation (see hosted-image).
 *  - code-giftz.available        -> chat class (code generation LLM)
 *  - code-giftz.sandbox.available-> local sandbox runtime capability
 *  - jazmii.available            -> constant false until a real video
 *                                   backend is deployed (truthful NO_BACKEND).
 *
 * Circuit-breaker interaction: while a class's 429 cooldown breaker is open,
 * that class's probe is DEFERRED (zero network traffic) and reports
 * latencyMs: null with the real cause — the health endpoint itself never
 * fails because of the breaker, and never misrepresents a skipped probe as
 * a measured one. Breaker expiry is verified by the next real probe call.
 */
export async function GET() {
  return handle(async () => {
    const [llm, image, research, sandbox, laxiiLocal, laxiiWorker] = await Promise.all([
      cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health()),
      cachedHealth('image-hosted-primary', () => hostedImageAdapter.health()),
      cachedHealth('research-functions-primary', () => probeResearchHealth()),
      cachedHealth('sandbox-runtime-primary', () => probeSandboxHealth()),
      // LAXII preservation engine sub-states (2026-10-31):
      //  deterministic -> real local Sharp capability (executed, not claimed)
      //  generative    -> local Diffusers worker preflight (truthful on any
      //                   host; registry-gated for traffic)
      cachedHealth('laxii-local-sharp', () => localLaxiiAdapter.health()),
      cachedHealth('laxii-diffusers-worker', () => diffusersWorkerAdapter.health()),
    ])

    const videoBackend = getBackendsForProduct('jazmii')[0]

    return ok({
      service: 'bean-intelligence',
      version: '1.0.0',
      live: true,
      time: new Date().toISOString(),
      products: {
        riishe: {
          available: llm.healthy,
          probe: llm,
          research: { available: research.healthy, probe: research },
        },
        laxii: {
          available: image.healthy,
          probe: image,
          deterministic: { available: laxiiLocal.healthy, probe: laxiiLocal },
          generative: { available: laxiiWorker.healthy, probe: laxiiWorker },
        },
        jazmii: {
          available: false,
          probe: {
            healthy: false,
            checkedAt: new Date().toISOString(),
            latencyMs: null,
            detail: videoBackend?.unavailableReason ?? 'No backend configured.',
          },
        },
        'code-giftz': {
          available: llm.healthy,
          probe: llm,
          sandbox: { available: sandbox.healthy, probe: sandbox },
        },
      },
    })
  })
}
