import { handle, ok } from '@/lib/api/errors'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { hostedVideoAdapter } from '@/lib/adapters/hosted-video'
import { localLaxiiAdapter } from '@/lib/laxii/local-adapter'
import { diffusersWorkerAdapter } from '@/lib/laxii/diffusers-adapter'
import { lastHealthyAtFor, HEALTH_CACHE_TTL_MS } from '@/lib/adapters/health-cache'
import type { HealthReport } from '@/lib/adapters/types'
import { safeProbe } from '@/lib/adapters/safe-probe'
import { lastRealAttempt, recentUpstreamFailure } from '@/lib/adapters/last-attempts'
import { probeResearchHealth } from '@/lib/research/provider'
import { probeSandboxHealth } from '@/lib/sandbox/runner'
import { getBackendsForProduct } from '@/lib/registry/backends'
import { productStatus, type ProductStatus } from '@/lib/registry/status'
import {
  upstreamBreakerState,
  UPSTREAM_429_COOLDOWN_MS,
  UPSTREAM_429_COOLDOWN_MAX_MS,
  type UpstreamEndpointClass,
} from '@/lib/upstream/gateway'

/**
 * Liveness (this process) + readiness (real backend/capability probes).
 * Readiness results are MEASURED, never assumed — a backend whose probe
 * fails reports unhealthy here and the admin UI shows the same evidence.
 * Probes are deduplicated and cached for 20s (health-cache.ts): identical
 * concurrent requests share one real probe, cached reports keep the
 * original checkedAt and carry cached:true — a cached result is the last
 * REAL probe outcome, never a fabricated fresh success.
 *
 * MEASURED CHANGE (2026-11-04 connectivity audit):
 *  1. INDEPENDENT PRODUCT PROBES — RIISHE and CODE GIFTZ previously shared
 *     ONE cached probe result, so the dashboard showed the identical probe
 *     duration for both (the observed "RIISHE 307ms / CODE GIFTZ 307ms"
 *     artifact). Each product now probes its own backend descriptor under
 *     its own cache key: independent measured evidence, independent
 *     latency, independent failure classes. Both still honor the same
 *     chat-class 429 breaker (same upstream endpoint class — honest
 *     fail-fast with zero network traffic while it is open), so the extra
 *     probe never turns into a throttle-deepening retry storm.
 *  2. FAILURE ISOLATION — every probe runs through safeProbe(): a probe
 *     that THROWS (unexpected implementation error) becomes an honest
 *     failed HealthReport instead of rejecting the Promise.all and 500-ing
 *     the whole endpoint. One broken probe can no longer take the status of
 *     the other three products down with it.
 *  3. DERIVED STATUS — each product carries a server-derived status
 *     (operational / degraded / unavailable / not-configured) from the same
 *     pure function the dashboard uses, plus lastHealthyAt (when the
 *     backend last PASSED a real probe) so consumers can tell how old the
 *     evidence behind a status is.
 *
 * Payload layers (unchanged semantics, now with structured categories):
 *  - riishe.available            -> chat completion class (conversational core)
 *  - riishe.research.available   -> functions class (current-web research:
 *                                   web_search / page_reader)
 *  - laxii.available             -> image backend reachable + configured.
 *                                   Reaching the gateway is NOT treated as
 *                                   proof of generation (see hosted-image).
 *  - laxii.deterministic/generative -> local Sharp engine / Diffusers worker
 *  - code-giftz.available        -> its OWN chat-class probe (see above)
 *  - code-giftz.sandbox.available-> local sandbox runtime capability
 *  - jazmii                      -> 'not-configured': no video backend is
 *                                   deployed; latencyMs stays null (no probe
 *                                   runs — there is nothing to probe).
 *
 * Circuit-breaker interaction: while a class's 429 cooldown breaker is open,
 * that class's probe is DEFERRED (zero network traffic) and reports
 * latencyMs: null with the real cause — the health endpoint itself never
 * fails because of the breaker, and never misrepresents a skipped probe as
 * a measured one. Breaker expiry is verified by the next real probe call.
 */

/** Registry truth: does the product have ANY enabled backend right now? */
function registryEnabled(productId: 'riishe' | 'laxii' | 'jazmii' | 'code-giftz'): boolean {
  return getBackendsForProduct(productId).some((b) => b.enabled)
}

interface ProductEntry {
  status: ProductStatus
  available: boolean
  probe: HealthReport
  lastHealthyAt: string | null
  [key: string]: unknown
}

export async function GET() {
  return handle(async () => {
    const [riishe, giftz, image, research, sandbox, laxiiLocal, laxiiWorker, video] = await Promise.all([
      safeProbe('llm-hosted-primary', () => hostedLlmAdapter.health()),
      // CODE GIFTZ probes its own backend descriptor independently (the
      // registry separates bean-llm-hosted-primary from
      // bean-code-llm-hosted-primary); the measured evidence is no longer
      // one shared result rendered twice.
      safeProbe('code-giftz-chat-primary', () => hostedLlmAdapter.health()),
      safeProbe('image-hosted-primary', () => hostedImageAdapter.health()),
      safeProbe('research-functions-primary', () => probeResearchHealth()),
      safeProbe('sandbox-runtime-primary', () => probeSandboxHealth()),
      // LAXII preservation engine sub-states (2026-10-31):
      //  deterministic -> real local Sharp capability (executed, not claimed)
      //  generative    -> local Diffusers worker preflight (truthful on any
      //                   host; registry-gated for traffic)
      safeProbe('laxii-local-sharp', () => localLaxiiAdapter.health()),
      safeProbe('laxii-diffusers-worker', () => diffusersWorkerAdapter.health()),
      // JAZMII (2026-11-04): real reachability probe of the hosted video
      // backend + video-class breaker state — NEVER a synthetic generation.
      safeProbe('video-hosted-primary', () => hostedVideoAdapter.health()),
    ])

    const videoBackend = getBackendsForProduct('jazmii')[0]
    const jazmiiEnabled = registryEnabled('jazmii')

    const riisheEntry: ProductEntry = {
      status: productStatus(registryEnabled('riishe'), {
        available: riishe.healthy,
        research: { available: research.healthy },
      }),
      available: riishe.healthy,
      probe: riishe,
      lastHealthyAt: lastHealthyAtFor('llm-hosted-primary'),
      research: { available: research.healthy, probe: research },
    }

    // LAXII hosted-generation evidence (2026-11-04 connectivity audit): the
    // reachability probe cannot see a gateway that answers but throttles
    // generations (measured live: a real generation failed with upstream
    // HTTP 429 while the probe passed). The most recent REAL attempt
    // (recorded by the queue worker, never synthetic) is the capability
    // evidence: a recent upstream-class failure makes LAXII Degraded, a
    // success clears it, and after the freshness window the always-on probe
    // decides again.
    const generationFailure = recentUpstreamFailure('image-generation')
    const generationAttempt = lastRealAttempt('image-generation')
    const generationEvidence = generationFailure
      ? {
          available: false,
          failureCategory: generationFailure.failureCategory,
          httpStatus: generationFailure.httpStatus,
          checkedAt: generationFailure.at,
        }
      : generationAttempt
        ? { available: true, failureCategory: null, httpStatus: null, checkedAt: generationAttempt.at }
        : undefined

    const laxiiEntry: ProductEntry = {
      status: productStatus(registryEnabled('laxii'), {
        available: image.healthy,
        ...(generationEvidence ? { generation: generationEvidence } : {}),
      }),
      available: image.healthy,
      probe: image,
      lastHealthyAt: lastHealthyAtFor('image-hosted-primary'),
      ...(generationEvidence
        ? {
            generation: generationEvidence,
            lastGenerationAttempt: generationAttempt,
          }
        : {}),
      deterministic: { available: laxiiLocal.healthy, probe: laxiiLocal },
      generative: { available: laxiiWorker.healthy, probe: laxiiWorker },
    }

    const giftzEntry: ProductEntry = {
      status: productStatus(registryEnabled('code-giftz'), {
        available: giftz.healthy,
        sandbox: { available: sandbox.healthy },
      }),
      available: giftz.healthy,
      probe: giftz,
      lastHealthyAt: lastHealthyAtFor('code-giftz-chat-primary'),
      sandbox: { available: sandbox.healthy, probe: sandbox },
    }

    // JAZMII (2026-11-04): the hosted video backend is registry-enabled, so
    // the product entry uses the real reachability probe + the video-class
    // breaker. Capability evidence follows the same real-attempt contract as
    // LAXII: a recent upstream-class failure on a REAL job degrades the
    // status; a completed real job is the generation proof. With the backend
    // absent/disabled the honest 'not-configured' state returns.
    const videoFailure = recentUpstreamFailure('video-generation')
    const videoAttempt = lastRealAttempt('video-generation')
    const videoEvidence = videoFailure
      ? {
          available: false,
          failureCategory: videoFailure.failureCategory,
          httpStatus: videoFailure.httpStatus,
          checkedAt: videoFailure.at,
        }
      : videoAttempt
        ? { available: true, failureCategory: null, httpStatus: null, checkedAt: videoAttempt.at }
        : undefined

    const jazmiiEntry: ProductEntry = {
      status: productStatus(jazmiiEnabled, {
        available: video.healthy,
        ...(videoEvidence ? { generation: videoEvidence } : {}),
      }),
      available: video.healthy,
      probe: video,
      lastHealthyAt: lastHealthyAtFor('video-hosted-primary'),
      ...(videoEvidence ? { generation: videoEvidence, lastGenerationAttempt: videoAttempt } : {}),
    }

    return ok({
      service: 'bean-intelligence',
      version: '1.0.0',
      live: true,
      time: new Date().toISOString(),
      probeCacheTtlMs: HEALTH_CACHE_TTL_MS,
      // PHASE 1 gateway recovery (2026-11-04): operator-visible breaker state
      // per upstream endpoint class — bounded escalating backoff evidence
      // (base window, cap, consecutive-429 streak, remaining cooldown) so a
      // throttled account is DIAGNOSABLE from the health payload alone.
      // Contains no credentials, no model identities and no endpoints.
      gateway: {
        breaker: {
          baseCooldownMs: UPSTREAM_429_COOLDOWN_MS,
          maxCooldownMs: UPSTREAM_429_COOLDOWN_MAX_MS,
          classes: (
            ['chat', 'functions', 'images', 'video', 'audio'] as UpstreamEndpointClass[]
          ).map((cls) => ({ class: cls, ...upstreamBreakerState(cls) })),
        },
      },
      products: {
        riishe: riisheEntry,
        laxii: laxiiEntry,
        jazmii: jazmiiEntry,
        'code-giftz': giftzEntry,
      },
    })
  })
}
