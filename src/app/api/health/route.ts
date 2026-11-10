import { handle, ok } from '@/lib/api/errors'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { hostedVideoAdapter } from '@/lib/adapters/hosted-video'
import { localLaxiiAdapter } from '@/lib/laxii/local-adapter'
import { diffusersWorkerAdapter } from '@/lib/laxii/diffusers-adapter'
import { lastHealthyAtFor, HEALTH_CACHE_TTL_MS } from '@/lib/adapters/health-cache'
import type { HealthReport } from '@/lib/adapters/types'
import { safeProbe } from '@/lib/adapters/safe-probe'
import { lastRealAttempt, recentUpstreamFailure, type AttemptTask } from '@/lib/adapters/last-attempts'
import { persistedAttempt } from '@/lib/adapters/persisted-attempts'
import { probeResearchHealth } from '@/lib/research/provider'
import { probeSandboxHealth } from '@/lib/sandbox/runner'
import { getBackendsForProduct } from '@/lib/registry/backends'
import { productStatus, type ProductHealthEntry, type ProductStatus } from '@/lib/registry/status'
import {
  generationCapability,
  editingCapability,
  unverifiedCapability,
  probeCapability,
  LAXII_EDIT_CONTRACT_BLOCKER,
  type CapabilityHealth,
} from '@/lib/registry/capabilities'
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
 *  - jazmii                      -> real reachability probe + video-class
 *                                   breaker state.
 *
 * GO-LIVE FINALIZATION (2026-11-05): every product also carries
 * `capabilities[]` — per-capability measured states (operational / degraded
 * / blocked / unavailable / not-configured) with evidence source, checkedAt
 * timestamps and the most recent real attempt. The product badge aggregates
 * the status-affecting rows, so an advertised capability being blocked or
 * unverified (LAXII conversational editing, JAZMII image-to-video) renders
 * as Degraded instead of a fully-Operational badge. The `generation` slot
 * is now derived ONLY from real success / real failure / breaker evidence —
 * the previous fallback rendered a FAILED attempt as available:true.
 *
 * Circuit-breaker interaction: while a class's 429 cooldown breaker is open,
 * that class's probe is DEFERRED (zero network traffic) and reports
 * latencyMs: null with the real cause — the health endpoint itself never
 * fails because of the breaker, and never misrepresents a skipped probe as
 * a measured one. Breaker expiry is verified by the next real probe call.
 *
 * QUOTA-FREE PROBES (CHAT-RECOVERY, 2026-11-10): the LLM and research
 * probes no longer fire any metered upstream request — the LLM health is a
 * free reachability GET + breaker state + REAL-attempt evidence (recorded
 * by actual traffic, in-memory + persisted), and the research probe is the
 * same pattern for the functions class. Measured defect this closes: the
 * previous fan-out (2 completions + 1 web_search per fresh poll, one
 * Promise.all every 45s from the dashboard) tripped the provider's
 * authoritative 2-QPS limit on refresh, 429'd its own probes, re-opened
 * the chat breaker every poll, and burned ~240 inference requests/hour
 * against the 300/day account budget — health monitoring was sustaining
 * the "chat rate-limited" state it reported (docs/reports/
 * RIISHE-CHAT-RECOVERY.md). With zero metered calls in this fan-out, the
 * burst concern is structurally gone; the parallel Promise.all stays.
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
  capabilities?: CapabilityHealth[]
  [key: string]: unknown
}

/**
 * GO-LIVE FIX (2026-11-05): the status-affecting generation slot, derived
 * from the evidence chain that can NEVER render a failed attempt as
 * availability: fresh own upstream failure > own class breaker > real
 * success > labeled shared throttle > absent (probe-driven fallback).
 * The previous fallback rendered `available: true` from the raw last-attempt
 * record without checking `.ok` — measured consequence: LAXII's failed
 * 429 attempt (01:38:04Z) and JAZMII's failed 429 attempt (01:29:24Z) were
 * presented as `generation.available: true` carrying the failure's own
 * timestamp, and both products badged Operational on that fabricated
 * availability. This function is the single fixed definition.
 */
function generationSlot(
  task: AttemptTask,
  cls: UpstreamEndpointClass,
  shared: NonNullable<ProductHealthEntry['generation']> | undefined,
): NonNullable<ProductHealthEntry['generation']> | undefined {
  const fresh = recentUpstreamFailure(task)
  if (fresh) {
    return {
      available: false,
      failureCategory: fresh.failureCategory,
      httpStatus: fresh.httpStatus,
      checkedAt: fresh.at,
      note: 'the most recent real attempt failed upstream',
    }
  }
  const br = upstreamBreakerState(cls)
  if (br.coolingDown && br.last429At) {
    return {
      available: false,
      failureCategory: 'rate-limited',
      httpStatus: 429,
      checkedAt: br.last429At,
      note: 'endpoint-class breaker is open after an observed 429; submissions fail fast until it clears',
    }
  }
  const attempt = lastRealAttempt(task)
  if (attempt?.ok) {
    return { available: true, failureCategory: null, httpStatus: null, checkedAt: attempt.at }
  }
  if (shared) return shared
  return undefined
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

    // Shared-account throttle evidence (LABELED inference, 2026-11-04): all
    // gateway endpoint classes ride ONE provider account, and the measured
    // pattern today is account-wide 429s. When ANY class carries a fresh
    // breaker (a 429 within its cooldown window, max 10 min), a generation
    // class whose reachability probe still passes is honestly Degraded —
    // reachability alone would repeat the "HTTP 200 ≠ operational" trap
    // while submissions would be rejected at the provider edge. The payload
    // states the evidence is cross-class, never passes it off as a probe of
    // the product's own endpoint.
    const throttleClasses = (['chat', 'functions', 'images', 'video', 'audio'] as UpstreamEndpointClass[])
      .map((cls) => ({ cls, ...upstreamBreakerState(cls) }))
      .filter((b) => b.coolingDown && b.last429At !== null)
    const accountThrottled = throttleClasses.length > 0
    const throttleCheckedAt = throttleClasses
      .map((b) => b.last429At as string)
      .sort()
      .pop() ?? null
    const sharedThrottleEvidence: NonNullable<ProductHealthEntry['generation']> | undefined = accountThrottled
      ? {
          available: false,
          failureCategory: 'rate-limited',
          httpStatus: 429,
          ...(throttleCheckedAt ? { checkedAt: throttleCheckedAt } : {}),
          note: 'Shared-account throttle observed on other gateway endpoint classes; submissions would be rejected until the breaker clears.',
        }
      : undefined

    // Capability-level rows (GO-LIVE FINALIZATION, 2026-11-05). Every
    // advertised capability of every product carries its own measured
    // state, evidence source and timestamp; the product badge aggregates
    // them (status-affecting non-operational rows degrade the product).
    const riisheCapabilities: CapabilityHealth[] = [
      probeCapability('chat', 'Conversational chat', true, { probe: riishe, note: 'core conversational completion' }),
      // FINAL CAPABILITY FIX (2026-11-07): research is an OPTIONAL capability
      // on a SEPARATELY rate-limited endpoint class (functions). Its failure
      // — throttling included — must never imply the core chat capability is
      // unavailable, so the row is display-only: it renders in the
      // per-capability list with its own measured state and never moves the
      // product badge. "Research operational" still requires a REAL
      // web_search probe to succeed (probeResearchHealth does exactly that).
      probeCapability('research', 'Current-web research', false, {
        probe: research,
        statusAffecting: false,
        note: 'functions endpoint class (web_search / page_reader)',
      }),
    ]
    const giftzCapabilities: CapabilityHealth[] = [
      probeCapability('coding-chat', 'Coding chat', true, { probe: giftz, note: 'core coding completion' }),
      // FINAL CAPABILITY FIX (2026-11-07): sandbox execution is local and
      // independent of the coding-chat backend — its failure must not imply
      // the core chat capability is unavailable (display-only row).
      probeCapability('sandbox-execution', 'Sandbox execution', false, {
        probe: sandbox,
        statusAffecting: false,
        note: 'local sandbox runtime',
      }),
    ]
    const laxiiCapabilities: CapabilityHealth[] = [
      generationCapability('text-to-image', 'Text-to-image', true, {
        probe: image,
        freshUpstreamFailure: recentUpstreamFailure('image-generation'),
        // FINAL CAPABILITY FIX (2026-11-07): when this process has no
        // in-memory attempt record yet (restart), the PERSISTED completed
        // job still proves the capability — the real T2I evidence survives
        // a restart instead of downgrading to unverified.
        lastAttempt: lastRealAttempt('image-generation') ?? (await persistedAttempt('image-generation')),
        ownBreaker: upstreamBreakerState('images'),
        sharedThrottle: sharedThrottleEvidence
          ? { last429At: sharedThrottleEvidence.checkedAt ?? null, note: sharedThrottleEvidence.note! }
          : null,
      }),
      editingCapability('conversational-editing', 'Conversational editing', true, {
        probe: image,
        lastAttempt: lastRealAttempt('image-editing') ?? (await persistedAttempt('image-editing')),
        contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
      }),
      probeCapability('image-enhancement', 'Deterministic enhancement', false, {
        probe: laxiiLocal,
        statusAffecting: false,
        note: 'local Sharp preservation engine (executed, not claimed)',
      }),
      probeCapability('generative-worker', 'Local Diffusers worker', false, {
        probe: laxiiWorker,
        registryEnabled: getBackendsForProduct('laxii').some((b) => b.endpointType === 'gpu-worker' && b.enabled),
        statusAffecting: false,
        note: 'local Diffusers worker (registry-gated smart edit / object removal)',
      }),
    ]
    const jazmiiCapabilities: CapabilityHealth[] = [
      generationCapability('text-to-video', 'Text-to-video', true, {
        probe: video,
        freshUpstreamFailure: recentUpstreamFailure('video-generation-t2v'),
        // FINAL CAPABILITY FIX (2026-11-07): persisted real completions
        // (T2V and I2V alike) stay the capability evidence across restarts.
        lastAttempt: lastRealAttempt('video-generation-t2v') ?? (await persistedAttempt('video-generation-t2v')),
        ownBreaker: upstreamBreakerState('video'),
        sharedThrottle: sharedThrottleEvidence
          ? { last429At: sharedThrottleEvidence.checkedAt ?? null, note: sharedThrottleEvidence.note! }
          : null,
      }),
      unverifiedCapability('image-to-video', 'Image-to-video', false, {
        probe: video,
        lastAttempt: lastRealAttempt('video-generation-i2v') ?? (await persistedAttempt('video-generation-i2v')),
      }),
    ]

    const riisheEntry: ProductEntry = {
      status: productStatus(registryEnabled('riishe'), {
        available: riishe.healthy,
        research: { available: research.healthy },
        capabilities: riisheCapabilities,
      }),
      available: riishe.healthy,
      probe: riishe,
      lastHealthyAt: lastHealthyAtFor('llm-hosted-primary'),
      research: { available: research.healthy, probe: research },
      capabilities: riisheCapabilities,
    }

    // LAXII hosted-generation evidence (2026-11-04 connectivity audit): the
    // reachability probe cannot see a gateway that answers but throttles
    // generations (measured live: a real generation failed with upstream
    // HTTP 429 while the probe passed). The most recent REAL attempt
    // (recorded by the queue worker, never synthetic) is the capability
    // evidence — GO-LIVE FIX (2026-11-05): via generationSlot(), which never
    // renders a FAILED attempt as available:true (the previous fallback did
    // exactly that with LAXII's 01:38:04Z 429 failure).
    const laxiiGeneration = generationSlot('image-generation', 'images', sharedThrottleEvidence)

    const laxiiEntry: ProductEntry = {
      status: productStatus(registryEnabled('laxii'), {
        available: image.healthy,
        ...(laxiiGeneration ? { generation: laxiiGeneration } : {}),
        capabilities: laxiiCapabilities,
      }),
      available: image.healthy,
      probe: image,
      lastHealthyAt: lastHealthyAtFor('image-hosted-primary'),
      ...(laxiiGeneration
        ? {
            generation: laxiiGeneration,
            lastGenerationAttempt: lastRealAttempt('image-generation'),
          }
        : {}),
      deterministic: { available: laxiiLocal.healthy, probe: laxiiLocal },
      generative: { available: laxiiWorker.healthy, probe: laxiiWorker },
      capabilities: laxiiCapabilities,
    }

    const giftzEntry: ProductEntry = {
      status: productStatus(registryEnabled('code-giftz'), {
        available: giftz.healthy,
        sandbox: { available: sandbox.healthy },
        capabilities: giftzCapabilities,
      }),
      available: giftz.healthy,
      probe: giftz,
      lastHealthyAt: lastHealthyAtFor('code-giftz-chat-primary'),
      sandbox: { available: sandbox.healthy, probe: sandbox },
      capabilities: giftzCapabilities,
    }

    // JAZMII (2026-11-04): the hosted video backend is registry-enabled, so
    // the product entry uses the real reachability probe + the video-class
    // breaker. Capability evidence follows the same real-attempt contract as
    // LAXII — GO-LIVE FIX (2026-11-05): via generationSlot(), which never
    // renders a FAILED attempt as available:true (measured: JAZMII's
    // 01:29:24Z 429 failure was previously presented as availability).
    const videoGeneration = generationSlot('video-generation', 'video', sharedThrottleEvidence)

    const jazmiiEntry: ProductEntry = {
      status: productStatus(jazmiiEnabled, {
        available: video.healthy,
        ...(videoGeneration ? { generation: videoGeneration } : {}),
        capabilities: jazmiiCapabilities,
      }),
      available: video.healthy,
      probe: video,
      lastHealthyAt: lastHealthyAtFor('video-hosted-primary'),
      ...(videoGeneration ? { generation: videoGeneration, lastGenerationAttempt: lastRealAttempt('video-generation') } : {}),
      capabilities: jazmiiCapabilities,
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
