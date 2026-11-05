/**
 * BEAN Intelligence — capability-level health model (server-derived).
 *
 * GO-LIVE FINALIZATION (2026-11-05): the product-level badge previously
 * collapsed everything into one boolean, which could render a product
 * "Operational" while an ADVERTISED capability was measurably blocked
 * (measured live: LAXII's conversational editing is rejected by an
 * undocumented provider contract; JAZMII's image-to-video has never
 * completed a real run). This module derives per-capability states from
 * MEASURED evidence only — probes, real attempts, breaker telemetry and
 * recorded contract blockers — never from configuration optimism.
 *
 * MEASURED BUG FIXED ALONGSIDE (2026-11-05): the /api/health route rendered
 * `generation.available: true` from the most recent REAL ATTEMPT RECORD
 * WITHOUT CHECKING `attempt.ok` — a failed generation (measured: LAXII 429
 * at 2026-11-05T01:38:04Z, JAZMII 429 at 01:29:24Z) was presented as
 * availability evidence carrying the failure's own timestamp. The evidence
 * chain below never synthesizes availability from a failed attempt.
 *
 * States (capability-level):
 *  - 'operational'    -> measured evidence says the capability works now
 *                        (fresh real success, or probe-clean with no
 *                        contrary evidence);
 *  - 'degraded'       -> the backend answers but THIS capability is failing
 *                        (fresh upstream failure, open class breaker, or the
 *                        LABELED shared-account throttle inference);
 *  - 'blocked'        -> a MEASURED external blocker stands between the
 *                        product and the capability (provider contract
 *                        rejection, capability never completed a real run);
 *                        distinct from a runtime outage — retrying cannot
 *                        fix it until the blocker is resolved;
 *  - 'unavailable'    -> the capability's backend dependency failed its
 *                        probe;
 *  - 'not-configured' -> no backend/engine is deployed for it.
 *
 * `statusAffecting` separates display-honesty from badge aggregation: a row
 * can honestly show a degraded/last-failed state WITHOUT holding the product
 * badge hostage when the failure class is request-specific (the pinned
 * real-attempt semantics: a content/user-specific rejection is not
 * product-health evidence). Contract blockers and unverified advertised
 * capabilities ARE status-affecting: a product whose advertised core
 * functionality is blocked must never badge as fully Operational.
 */

import type { HealthFailureCategory, HealthReport } from '../adapters/types'

export type CapabilityState = 'operational' | 'degraded' | 'blocked' | 'unavailable' | 'not-configured'

export interface AttemptEvidence {
  at: string
  ok: boolean
  failureCategory: HealthFailureCategory | null
  httpStatus: number | null
}

export interface CapabilityEvidence {
  /** When the governing evidence was measured (ISO); null = none yet. */
  checkedAt: string | null
  source: 'probe' | 'real-attempt' | 'breaker' | 'shared-throttle' | 'contract' | 'registry'
  failureCategory?: HealthFailureCategory | null
  httpStatus?: number | null
  /** Honest note — labeled inference, contract blocker, unverified state. */
  note?: string
  /** The most recent real attempt behind this capability (when one exists). */
  lastAttempt?: AttemptEvidence | null
}

export interface CapabilityHealth {
  id: string
  label: string
  /** Advertised functionality of the product (visible to users). */
  core: boolean
  state: CapabilityState
  /** Whether this row can affect the product-level badge. */
  statusAffecting: boolean
  evidence: CapabilityEvidence
}

/** Shape the health route passes for one real attempt (from last-attempts). */
export interface AttemptRecordLike {
  at: string
  ok: boolean
  failureCategory: HealthFailureCategory | null
  httpStatus: number | null
}

/**
 * MEASURED contract blocker — LAXII hosted conversational editing.
 *
 * Evidence (scripts/probe-image-edit-out/, docs/reports/LAXII-LIVE-ACCEPTANCE.md §3):
 *  - 10 request shapes measured 2026-11-04/05 against the real endpoint:
 *    every array form and every string form (public URL, raw base64, data
 *    URL, even a provider-issued CDN URL captured from a raw T2I response)
 *    is rejected with HTTP 400 code 1210 ("API 调用参数有误" / "image_to_image
 *    task must provide images" named checks);
 *  - the SDK surface (z-ai-web-dev-sdk 0.0.18, the latest published version,
 *    verified 2026-11-05) serializes `POST {baseUrl}/images/generations/edit`
 *    with the body passed through verbatim; its own CLI canonical shape is
 *    `{ prompt, image: <data URL>, size }` — the ONE officially-documented
 *    shape the 10-probe matrix had not covered;
 *  - that canonical shape was measured 2026-11-05T03:15Z during the account
 *    throttle window and received HTTP 429 — a rate-limit verdict, NOT a
 *    contract verdict, so the contract question remains externally
 *    unresolved until the provider lets a request through validation;
 *  - public provider documentation describes NO edit endpoint for this
 *    account/endpoint; metadata doc routes (/openapi.json, /docs) do not
 *    exist on the gateway.
 * The capability stays BLOCKED with this evidence until a real edit
 * succeeds (which flips it operational — see editingCapability).
 */
export const LAXII_EDIT_CONTRACT_BLOCKER = {
  measuredAt: '2026-11-05T03:15:00Z',
  note:
    'Provider request contract for image editing is externally unresolved: 10 measured request shapes ' +
    'rejected (HTTP 400 code 1210, 2026-11-04/05); SDK 0.0.18 canonical shape (image=data URL) reached ' +
    'only the rate-limit layer (HTTP 429, 2026-11-05) so no contract verdict is possible yet; public ' +
    'provider docs describe no edit endpoint. No further blind shapes will be tried — awaiting the ' +
    'documented contract from the provider.',
} as const

/** Inputs for a generation capability (text-to-image / text-to-video). */
export interface GenerationCapabilityInput {
  probe: HealthReport
  /** recentUpstreamFailure(task) — fresh upstream-class failure or null. */
  freshUpstreamFailure: AttemptRecordLike | null
  /** lastRealAttempt(task) — the most recent attempt of ANY outcome. */
  lastAttempt: AttemptRecordLike | null
  /** This endpoint class's own breaker state. */
  ownBreaker: { coolingDown: boolean; last429At: string | null }
  /** LABELED shared-account throttle evidence, or null when none is fresh. */
  sharedThrottle: { last429At: string | null; note: string } | null
}

/**
 * Derive a generation capability from the evidence chain. Order matters —
 * the strongest OWN-CLASS evidence wins, the labeled cross-class inference
 * only fills the gap when nothing own-class is known:
 *   1. backend probe failed            -> unavailable
 *   2. fresh own upstream failure      -> degraded   (real-attempt)
 *   3. own class breaker open          -> degraded   (breaker)
 *   4. last real attempt SUCCEEDED     -> operational (real-attempt)
 *   5. labeled shared throttle (fresh) -> degraded   (shared-throttle)
 *   6. last attempt failed (non-fresh /
 *      request-specific)               -> degraded, display-only
 *   7. no attempts at all              -> operational (probe-driven; the
 *      cheap-probe contract: reaching the gateway is NOT proof a generation
 *      was tested, and the payload says so in the probe detail)
 * A failed attempt can NEVER produce state 'operational' or an
 * `available: true` claim.
 */
export function generationCapability(
  id: string,
  label: string,
  core: boolean,
  input: GenerationCapabilityInput,
): CapabilityHealth {
  const { probe, freshUpstreamFailure, lastAttempt, ownBreaker, sharedThrottle } = input
  const lastAttemptEvidence: CapabilityEvidence['lastAttempt'] = lastAttempt
    ? { at: lastAttempt.at, ok: lastAttempt.ok, failureCategory: lastAttempt.failureCategory, httpStatus: lastAttempt.httpStatus }
    : null

  if (!probe.healthy) {
    return {
      id,
      label,
      core,
      state: 'unavailable',
      statusAffecting: true,
      evidence: {
        checkedAt: probe.checkedAt,
        source: 'probe',
        failureCategory: probe.failureCategory,
        httpStatus: probe.httpStatus,
        note: 'backend dependency failed its probe',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (freshUpstreamFailure) {
    return {
      id,
      label,
      core,
      state: 'degraded',
      statusAffecting: true,
      evidence: {
        checkedAt: freshUpstreamFailure.at,
        source: 'real-attempt',
        failureCategory: freshUpstreamFailure.failureCategory,
        httpStatus: freshUpstreamFailure.httpStatus,
        note: 'the most recent real generation attempt failed upstream',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (ownBreaker.coolingDown && ownBreaker.last429At) {
    return {
      id,
      label,
      core,
      state: 'degraded',
      statusAffecting: true,
      evidence: {
        checkedAt: ownBreaker.last429At,
        source: 'breaker',
        failureCategory: 'rate-limited',
        httpStatus: 429,
        note: 'endpoint-class breaker is open after an observed 429; submissions fail fast until it clears',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (lastAttempt?.ok) {
    return {
      id,
      label,
      core,
      state: 'operational',
      statusAffecting: false,
      evidence: {
        checkedAt: lastAttempt.at,
        source: 'real-attempt',
        failureCategory: null,
        httpStatus: null,
        note: 'the most recent real generation attempt succeeded',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (sharedThrottle) {
    return {
      id,
      label,
      core,
      state: 'degraded',
      statusAffecting: true,
      evidence: {
        checkedAt: sharedThrottle.last429At,
        source: 'shared-throttle',
        failureCategory: 'rate-limited',
        httpStatus: 429,
        note: sharedThrottle.note,
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (lastAttempt && !lastAttempt.ok) {
    // Non-fresh or request-specific failure: not product-down evidence
    // (pinned real-attempt semantics), but the row says what actually
    // happened on the last exercise instead of claiming availability.
    return {
      id,
      label,
      core,
      state: 'degraded',
      statusAffecting: false,
      evidence: {
        checkedAt: lastAttempt.at,
        source: 'real-attempt',
        failureCategory: lastAttempt.failureCategory,
        httpStatus: lastAttempt.httpStatus,
        note: 'the most recent real attempt failed; reachability is OK — awaiting a fresh attempt',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  return {
    id,
    label,
    core,
    state: 'operational',
    statusAffecting: false,
    evidence: {
      checkedAt: probe.checkedAt,
      source: 'probe',
      failureCategory: null,
      httpStatus: null,
      note: 'reachability probe passed; no generation has been attempted yet (the health probe never runs a generation)',
      lastAttempt: lastAttemptEvidence,
    },
  }
}

/** Inputs for a capability governed by a measured external contract blocker. */
export interface EditingCapabilityInput {
  probe: HealthReport
  /** lastRealAttempt('image-editing') — flips the blocker on a real success. */
  lastAttempt: AttemptRecordLike | null
  /** The measured contract blocker (evidence-backed), or null. */
  contractBlocker: { measuredAt: string; note: string } | null
}

/**
 * Conversational editing: BLOCKED while the measured provider contract
 * blocker stands (10-shape probe evidence; the SDK's own canonical shape is
 * the only officially-documented one and is measured too). A REAL successful
 * edit flips the capability to operational — the blocker claim is
 * evidence-driven in both directions and is re-verified by every attempt.
 */
export function editingCapability(
  id: string,
  label: string,
  core: boolean,
  input: EditingCapabilityInput,
): CapabilityHealth {
  const { probe, lastAttempt, contractBlocker } = input
  const lastAttemptEvidence: CapabilityEvidence['lastAttempt'] = lastAttempt
    ? { at: lastAttempt.at, ok: lastAttempt.ok, failureCategory: lastAttempt.failureCategory, httpStatus: lastAttempt.httpStatus }
    : null

  if (!probe.healthy) {
    return {
      id,
      label,
      core,
      state: 'unavailable',
      statusAffecting: true,
      evidence: {
        checkedAt: probe.checkedAt,
        source: 'probe',
        failureCategory: probe.failureCategory,
        httpStatus: probe.httpStatus,
        note: 'backend dependency failed its probe',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (lastAttempt?.ok) {
    return {
      id,
      label,
      core,
      state: 'operational',
      statusAffecting: false,
      evidence: {
        checkedAt: lastAttempt.at,
        source: 'real-attempt',
        failureCategory: null,
        httpStatus: null,
        note: 'a real edit completed successfully — the recorded blocker is lifted',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (contractBlocker) {
    return {
      id,
      label,
      core,
      state: 'blocked',
      statusAffecting: true,
      evidence: {
        checkedAt: lastAttempt?.at ?? contractBlocker.measuredAt,
        source: 'contract',
        failureCategory: lastAttempt?.failureCategory ?? null,
        httpStatus: lastAttempt?.httpStatus ?? null,
        note: contractBlocker.note,
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  return {
    id,
    label,
    core,
    state: 'operational',
    statusAffecting: false,
    evidence: {
      checkedAt: probe.checkedAt,
      source: 'probe',
      note: 'no measured blocker and no attempt on record yet',
      lastAttempt: lastAttemptEvidence,
    },
  }
}

/**
 * Image-to-video (or any wired-but-unproven capability): a REAL completed
 * run makes it operational; real attempts that never completed (measured:
 * the 2026-11-05T01:28Z i2v submission accepted, the provider call rejected
 * by the account throttle) keep it BLOCKED — never advertised as available
 * without a real successful test; never exercised at all -> also blocked
 * with the unverified note (the adapter being wired is not evidence).
 */
export function unverifiedCapability(
  id: string,
  label: string,
  core: boolean,
  input: {
    probe: HealthReport
    lastAttempt: AttemptRecordLike | null
  },
): CapabilityHealth {
  const { probe, lastAttempt } = input
  const lastAttemptEvidence: CapabilityEvidence['lastAttempt'] = lastAttempt
    ? { at: lastAttempt.at, ok: lastAttempt.ok, failureCategory: lastAttempt.failureCategory, httpStatus: lastAttempt.httpStatus }
    : null

  if (!probe.healthy) {
    return {
      id,
      label,
      core,
      state: 'unavailable',
      statusAffecting: true,
      evidence: {
        checkedAt: probe.checkedAt,
        source: 'probe',
        failureCategory: probe.failureCategory,
        httpStatus: probe.httpStatus,
        note: 'backend dependency failed its probe',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  if (lastAttempt?.ok) {
    return {
      id,
      label,
      core,
      state: 'operational',
      statusAffecting: false,
      evidence: {
        checkedAt: lastAttempt.at,
        source: 'real-attempt',
        failureCategory: null,
        httpStatus: null,
        note: 'a real run completed successfully',
        lastAttempt: lastAttemptEvidence,
      },
    }
  }
  return {
    id,
    label,
    core,
    state: 'blocked',
    statusAffecting: true,
    evidence: {
      checkedAt: lastAttempt?.at ?? probe.checkedAt,
      source: lastAttempt ? 'real-attempt' : 'probe',
      failureCategory: lastAttempt?.failureCategory ?? null,
      httpStatus: lastAttempt?.httpStatus ?? null,
      note: lastAttempt
        ? 'attempted live but never completed a real run — the capability is not available until one succeeds'
        : 'wired but unverified: no completed real run on record — the capability is not advertised as available',
      lastAttempt: lastAttemptEvidence,
    },
  }
}

/** Probe-driven capability (chat, research, sandbox, local engines). */
export function probeCapability(
  id: string,
  label: string,
  core: boolean,
  input: {
    probe: HealthReport
    /** Registry-gated engines flip to not-configured when absent. */
    registryEnabled?: boolean
    statusAffecting?: boolean
    note?: string
  },
): CapabilityHealth {
  const { probe, registryEnabled = true, statusAffecting = true, note } = input
  if (!registryEnabled) {
    return {
      id,
      label,
      core,
      state: 'not-configured',
      statusAffecting: false,
      evidence: {
        checkedAt: probe.checkedAt,
        source: 'registry',
        note: note ?? 'no engine/backend is deployed for this capability',
      },
    }
  }
  return {
    id,
    label,
    core,
    state: probe.healthy ? 'operational' : 'unavailable',
    statusAffecting: statusAffecting || core,
    evidence: {
      checkedAt: probe.checkedAt,
      source: 'probe',
      failureCategory: probe.healthy ? null : probe.failureCategory,
      httpStatus: probe.healthy ? null : probe.httpStatus,
      note: probe.healthy ? (note ?? 'probe passed') : 'probe failed',
    },
  }
}

/**
 * Product-badge aggregation: any status-affecting capability that is not
 * operational degrades the product (the honest middle state). Core-runtime
 * failures keep rendering 'unavailable' through the existing probe rules —
 * this function only adds the capability-level degradations.
 */
export function capabilitySecondaryFailures(
  capabilities: CapabilityHealth[] | undefined,
): boolean {
  return (capabilities ?? []).some((c) => c.statusAffecting && c.state !== 'operational')
}
