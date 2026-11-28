/**
 * P0 R3 — consented browser-local fallback policy tests.
 *
 * Owner mandate: a temporary hosted inference failure must not leave a user
 * without any answer when an ALREADY authorized and ready alternative
 * exists — and the browser-local lane may answer ONLY when the user
 * explicitly consented to on-device inference AND a supported model is
 * already installed and loaded. No silent downloads, no forced local mode,
 * no fabricated capability.
 *
 * The pure eligibility contract is pinned here exhaustively; the wiring
 * (use-riishe-chat.attemptLocalFallback) re-derives consent + readiness
 * FRESH from the device capability manager at fallback time and reuses the
 * existing on-device runtime (no second local-AI framework), which is
 * covered by the device-inference suites; end-to-end behavior is verified in
 * the R5 acceptance run.
 *
 * Server-side authorized failover (credential-gated provider chain, 429
 * breaker behavior, zero-fetch-when-uncredentialed, mid-stream propagation)
 * is already pinned by tests/unit/provider-fallback.test.ts and
 * tests/unit/upstream-429.test.ts — this file complements, never replaces.
 */
import { describe, test, expect } from 'bun:test'
import {
  isEligibleForLocalFallback,
  LOCAL_FALLBACK_DISCLOSURE,
} from '../../src/lib/riishe/local-fallback'

function eligible(overrides?: Partial<Parameters<typeof isEligibleForLocalFallback>[0]>): Parameters<typeof isEligibleForLocalFallback>[0] {
  return {
    failureKind: 'network',
    failureStatus: null,
    streamedAny: false,
    attachmentCount: 0,
    consentGranted: true,
    localModelReady: true,
    ...overrides,
  }
}

describe('P0-R3 eligibility — the five mandate conditions (all required)', () => {
  test('a transport-death turn with consent + ready model + no attachments is eligible', () => {
    expect(isEligibleForLocalFallback(eligible())).toBe(true)
  })

  test('condition 1 — WITHOUT explicit on-device consent there is NO fallback', () => {
    expect(isEligibleForLocalFallback(eligible({ consentGranted: false }))).toBe(false)
  })

  test('condition 2 — without an installed/loaded local model there is NO fallback', () => {
    expect(isEligibleForLocalFallback(eligible({ localModelReady: false }))).toBe(false)
  })

  test('condition 3 — a turn that already streamed belongs to recovery, never restarts locally', () => {
    expect(isEligibleForLocalFallback(eligible({ streamedAny: true }))).toBe(false)
  })

  test('condition 4 — attachment turns keep the server lane (documents need server analysis)', () => {
    expect(isEligibleForLocalFallback(eligible({ attachmentCount: 1 }))).toBe(false)
    expect(isEligibleForLocalFallback(eligible({ attachmentCount: 3 }))).toBe(false)
  })

  test('condition 5 — a user-stopped turn (aborted) is an explicit decision: no fallback', () => {
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'aborted' }))).toBe(false)
  })

  test('auth failures mean the session is gone: 401/403 never fall back', () => {
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 401 }))).toBe(false)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 403 }))).toBe(false)
  })

  test('inference-class HTTP failures DO fall back: 429 and gateway 5xx', () => {
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 429 }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 500 }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 502 }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 503 }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 504 }))).toBe(true)
  })

  test('non-eligible HTTP statuses (404, 422) do not fall back', () => {
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 404 }))).toBe(false)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'http', failureStatus: 422 }))).toBe(false)
  })

  test('every transport-death class is eligible (network / timeout / protocol)', () => {
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'network' }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'timeout' }))).toBe(true)
    expect(isEligibleForLocalFallback(eligible({ failureKind: 'protocol' }))).toBe(true)
  })
})

describe('P0-R3 provenance honesty', () => {
  test('the disclosure states on-device processing AND the absence of live sources', () => {
    expect(LOCAL_FALLBACK_DISCLOSURE).toContain('your device')
    expect(LOCAL_FALLBACK_DISCLOSURE).toContain('no live sources')
    // It never claims research, tools or citations happened.
    expect(LOCAL_FALLBACK_DISCLOSURE.toLowerCase()).not.toContain('searched')
    expect(LOCAL_FALLBACK_DISCLOSURE.toLowerCase()).not.toContain('verified from sources')
  })
})
