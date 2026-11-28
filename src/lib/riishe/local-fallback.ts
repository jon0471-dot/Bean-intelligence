/**
 * BEAN Intelligence — P0 R3 consented browser-local fallback policy.
 *
 * When the hosted inference lane fails BEFORE producing any text, and the
 * visitor has ALREADY consented to on-device inference AND a supported local
 * model is already installed and ready, the existing browser-local model may
 * answer the failed turn as a safe fallback — so a temporary hosted outage
 * does not leave a consented user with no answer at all.
 *
 * Hard rules (mirroring the owner mandate):
 *  - NEVER a silent model download: consent + a READY model are checked
 *    fresh from the device capability manager at fallback time; an
 *    un-consented or unloaded device yields NO fallback attempt (the honest
 *    retry UX stays).
 *  - NEVER for turns already streaming (a partial answer belongs to the
 *    recovery path, not a restart).
 *  - NEVER for turns with attachments (documents need the server's
 *    extraction/analysis lane).
 *  - NEVER user-stopped turns ('aborted' is an explicit decision).
 *  - Only INFERENCE-CLASS failures qualify: transport death (network /
 *    timeout / protocol) or gateway-class HTTP statuses (429, 5xx). Auth
 *    failures (401/403) mean the session itself is gone — no fallback.
 *  - Provenance stays honest: a local answer is labeled as answered on the
 *    device, with no sources, no retrieval claims and no server persistence.
 */

export type FailureKind = 'aborted' | 'network' | 'timeout' | 'http' | 'protocol'

export interface LocalFallbackEligibility {
  /** Failure classification from the SSE client (or the pre-stream catch). */
  failureKind: FailureKind
  /** HTTP status when the failure is 'http', otherwise null. */
  failureStatus: number | null
  /** True when any model text already streamed for this turn. */
  streamedAny: boolean
  /** Number of attached documents on the turn. */
  attachmentCount: number
  /** Fresh device-capability-manager facts: the user granted on-device
   *  inference consent at some point (never implied). */
  consentGranted: boolean
  /** Fresh device-capability-manager facts: a supported local chat model is
   *  already installed and loaded (never a pending download). */
  localModelReady: boolean
}

const FALLBACK_HTTP_STATUSES = new Set([429, 500, 502, 503, 504])

export function isEligibleForLocalFallback(input: LocalFallbackEligibility): boolean {
  if (input.failureKind === 'aborted') return false
  if (input.streamedAny) return false
  if (input.attachmentCount > 0) return false
  if (!input.consentGranted || !input.localModelReady) return false
  if (input.failureKind === 'network' || input.failureKind === 'timeout' || input.failureKind === 'protocol') {
    return true
  }
  return input.failureKind === 'http' && input.failureStatus !== null && FALLBACK_HTTP_STATUSES.has(input.failureStatus)
}

/** Subtle, honest provenance shown with every fallback answer (meta note). */
export const LOCAL_FALLBACK_DISCLOSURE =
  'Answered on your device — the cloud service was unavailable, so this reply came from your browser\u2019s local model (no live sources).'
