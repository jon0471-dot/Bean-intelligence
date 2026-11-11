/**
 * GO-LIVE FINALIZATION (2026-11-05) — capability-level health model.
 *
 * Pins the measured evidence chain that replaced the buggy fallback:
 * the /api/health route previously rendered `generation.available: true`
 * from the raw last-attempt record WITHOUT checking `.ok` — a failed
 * generation (measured: LAXII 429 2026-11-05T01:38:04Z, JAZMII 429
 * 01:29:24Z) was presented as availability evidence carrying the failure's
 * own timestamp. These tests pin: a failed attempt can NEVER produce an
 * operational state or an available:true claim; contract blockers hold
 * capability rows at 'blocked' until a REAL success flips them; advertised
 * capabilities that are blocked degrade the product badge.
 */
import { describe, expect, test } from 'bun:test'

const {
  generationCapability,
  editingCapability,
  unverifiedCapability,
  probeCapability,
  capabilitySecondaryFailures,
  LAXII_EDIT_CONTRACT_BLOCKER,
} = await import('../../src/lib/registry/capabilities')
const { productStatus } = await import('../../src/lib/registry/status')
import type { HealthReport } from '../../src/lib/adapters/types'

function probe(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    healthy: true,
    checkedAt: '2026-11-05T03:10:00.000Z',
    latencyMs: 20,
    httpStatus: null,
    failureCategory: null,
    detail: 'probe passed',
    ...overrides,
  }
}

const attempt = (over: Partial<{ at: string; ok: boolean; failureCategory: any; httpStatus: number | null }> = {}) => ({
  at: over.at ?? '2026-11-05T01:38:04.401Z',
  ok: over.ok ?? false,
  failureCategory: over.failureCategory ?? ('rate-limited' as const),
  httpStatus: over.httpStatus ?? 429,
})

describe('generationCapability: the evidence chain can never fake availability', () => {
  test('MEASURED BUG PIN: a failed last attempt NEVER yields operational', () => {
    // The exact measured shape: LAXII's 01:38:04Z 429 failure, breaker since
    // expired, probe healthy. The old route rendered available:true here.
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: attempt({ ok: false }),
      ownBreaker: { coolingDown: false, last429At: '2026-11-05T01:38:04.401Z' },
      sharedThrottle: null,
    })
    expect(cap.state).not.toBe('operational')
    expect(cap.state).toBe('degraded')
    // display-only: a stale/request-specific failure does not hold the badge
    expect(cap.statusAffecting).toBe(false)
    expect(cap.evidence.lastAttempt?.ok).toBe(false)
    expect(cap.evidence.checkedAt).toBe('2026-11-05T01:38:04.401Z')
  })

  test('a FRESH rate-limited upstream failure is RATE-LIMITED evidence (not Degraded)', () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: attempt({ at, ok: false }),
      lastAttempt: attempt({ at, ok: false }),
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    // FINAL CAPABILITY FIX (2026-11-07): throttling is its own state —
    // the capability is not malfunctioning, the provider refuses volume.
    expect(cap.state).toBe('rate-limited')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.source).toBe('real-attempt')
    expect(cap.evidence.note).toContain('rate-limited upstream')
  })

  test('a FRESH NON-throttle upstream failure stays Degraded evidence', () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: attempt({ at, ok: false, failureCategory: 'backend-error', httpStatus: 500 }),
      lastAttempt: attempt({ at, ok: false, failureCategory: 'backend-error', httpStatus: 500 }),
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('degraded')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.note).toContain('failed upstream')
  })

  test('an open own-class breaker is RATE-LIMITED evidence with the 429 timestamp', () => {
    const cap = generationCapability('text-to-video', 'Text-to-video', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: null,
      ownBreaker: { coolingDown: true, last429At: '2026-11-05T03:08:04.000Z' },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('rate-limited')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.source).toBe('breaker')
    expect(cap.evidence.httpStatus).toBe(429)
  })

  test('a real success IS availability evidence (with its timestamp)', () => {
    const at = '2026-11-04T16:29:27.613Z'
    const cap = generationCapability('text-to-video', 'Text-to-video', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: attempt({ at, ok: true, failureCategory: null, httpStatus: null }),
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('operational')
    expect(cap.statusAffecting).toBe(false)
    expect(cap.evidence.checkedAt).toBe(at)
  })

  test('the labeled shared-throttle inference only fills the evidence gap', () => {
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: null,
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: { last429At: '2026-11-05T03:08:04.000Z', note: 'Shared-account throttle observed on other gateway endpoint classes.' },
    })
    // FINAL CAPABILITY FIX (2026-11-07): labeled cross-class throttling is
    // Rate limited evidence — never Degraded, never Unavailable.
    expect(cap.state).toBe('rate-limited')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.source).toBe('shared-throttle')
    // own-class success outranks the cross-class inference (user's example:
    // LAXII text-to-image Operational while chat is throttled)
    const cap2 = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: attempt({ at: '2026-11-05T01:38:04.401Z', ok: true, failureCategory: null, httpStatus: null }),
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: { last429At: '2026-11-05T03:08:04.000Z', note: 'throttle' },
    })
    expect(cap2.state).toBe('operational')
  })

  test('a failed backend probe makes the capability unavailable', () => {
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe({ healthy: false, failureCategory: 'network', detail: 'connection lost' }),
      freshUpstreamFailure: null,
      lastAttempt: null,
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('unavailable')
    expect(cap.statusAffecting).toBe(true)
  })

  test('a probe that failed ON throttling (observed 429) is Rate limited, not Unavailable', () => {
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe({ healthy: false, failureCategory: 'rate-limited', httpStatus: 429, detail: 'gateway throttling' }),
      freshUpstreamFailure: null,
      lastAttempt: null,
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('rate-limited')
    expect(cap.statusAffecting).toBe(true)
  })

  test('a DEFERRED probe (open breaker, zero network) is Rate limited, not Unavailable', () => {
    // probeResearchHealth / hosted-video health report exactly this shape
    // when the class breaker is open: healthy:false, rate-limited, no status.
    const cap = probeCapability('research', 'Current-web research', false, {
      probe: probe({ healthy: false, latencyMs: null, failureCategory: 'rate-limited', httpStatus: null }),
      statusAffecting: false,
    })
    expect(cap.state).toBe('rate-limited')
    expect(cap.evidence.note).toContain('throttling')
  })

  test('never-attempted + clean probe stays probe-driven with the honest note', () => {
    const cap = generationCapability('text-to-image', 'Text-to-image', true, {
      probe: probe(),
      freshUpstreamFailure: null,
      lastAttempt: null,
      ownBreaker: { coolingDown: false, last429At: null },
      sharedThrottle: null,
    })
    expect(cap.state).toBe('operational')
    expect(cap.evidence.note).toContain('no generation has been attempted')
  })
})

describe('editingCapability: the measured contract blocker holds until a real success', () => {
  test('a fresh 400 failure with the blocker record renders BLOCKED (status-affecting)', () => {
    const cap = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-04T16:19:23.352Z', ok: false, failureCategory: 'backend-error', httpStatus: 400 }),
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(cap.state).toBe('blocked')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.source).toBe('contract')
    expect(cap.evidence.checkedAt).toBe('2026-11-04T16:19:23.352Z')
    // The surfaced note is the RESOLVED-blocker record: it names the fresh
    // failure path and carries the full measured history (the blocker itself
    // was lifted 2026-11-08 by a real completed edit — see the next test).
    expect(cap.evidence.note).toContain('most recent real edit attempt failed again')
    expect(cap.evidence.note).toContain('RESOLVED 2026-11-08')
  })

  test('a real successful edit flips the capability to operational', () => {
    const cap = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-05T05:00:00.000Z', ok: true, failureCategory: null, httpStatus: null }),
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(cap.state).toBe('operational')
    expect(cap.evidence.note).toContain('blocker is lifted')
  })

  test('the blocker record carries the measured contract-resolution evidence', () => {
    expect(LAXII_EDIT_CONTRACT_BLOCKER.note).toContain('SDK 0.0.18')
    expect(LAXII_EDIT_CONTRACT_BLOCKER.note).toContain('images:[{url}]')
    expect(LAXII_EDIT_CONTRACT_BLOCKER.note).toContain('RESOLVED 2026-11-08')
    expect(LAXII_EDIT_CONTRACT_BLOCKER.note).toContain('code 1210')
  })
})

describe('unverifiedCapability: image-to-video is never advertised without a real completed run', () => {
  test('the measured 01:28Z throttled i2v attempt keeps the capability BLOCKED', () => {
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-05T01:28:17.570Z', ok: false }),
    })
    expect(cap.state).toBe('blocked')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.note).toContain('never completed a real run')
  })

  test('wired but never exercised is blocked with the unverified note', () => {
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: null,
    })
    expect(cap.state).toBe('blocked')
    expect(cap.evidence.note).toContain('unverified')
  })

  test('a real completed i2v run makes the capability operational', () => {
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-05T05:30:00.000Z', ok: true, failureCategory: null, httpStatus: null }),
    })
    expect(cap.state).toBe('operational')
  })

  test('EVIDENCE PARITY (2026-11-11): a fresh credential rejection degrades I2V even with an old success', () => {
    // Measured 2026-11-11 01:14Z: the shared gateway account 401'd every
    // submission while image-to-video kept reading "operational" from a
    // 4-day-old persisted completion. Fresh upstream evidence must outrank
    // an old success — both video capabilities ride the same credentials.
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-07T02:21:35.717Z', ok: true, failureCategory: null, httpStatus: null }),
      freshUpstreamFailure: attempt({ at: new Date().toISOString(), ok: false, failureCategory: 'auth', httpStatus: 401 }),
    })
    expect(cap.state).toBe('degraded')
    expect(cap.statusAffecting).toBe(true)
    expect(cap.evidence.failureCategory).toBe('auth')
    expect(cap.evidence.note).toContain('credentials/account')
  })

  test('EVIDENCE PARITY: a fresh 429 renders I2V rate-limited (not broken)', () => {
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-07T02:21:35.717Z', ok: true, failureCategory: null, httpStatus: null }),
      freshUpstreamFailure: attempt({ at: new Date().toISOString(), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }),
    })
    expect(cap.state).toBe('rate-limited')
    expect(cap.evidence.note).toContain('429')
  })

  test('EVIDENCE PARITY: an open video-class breaker is rate-limited evidence', () => {
    const cap = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: probe(),
      lastAttempt: attempt({ at: '2026-11-07T02:21:35.717Z', ok: true, failureCategory: null, httpStatus: null }),
      ownBreaker: { coolingDown: true, last429At: new Date().toISOString() },
    })
    expect(cap.state).toBe('rate-limited')
    expect(cap.evidence.source).toBe('breaker')
  })
})

describe('probeCapability and product-badge aggregation', () => {
  test('registry-gated engines render not-configured (display-only)', () => {
    const cap = probeCapability('generative-worker', 'Local Diffusers worker', false, {
      probe: probe(),
      registryEnabled: false,
      statusAffecting: false,
    })
    expect(cap.state).toBe('not-configured')
    expect(cap.statusAffecting).toBe(false)
  })

  test('a status-affecting blocked capability degrades the product badge', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'operational', statusAffecting: false },
        { state: 'blocked', statusAffecting: true },
      ],
    })
    expect(status).toBe('degraded')
  })

  test('display-only degraded rows never move the badge (pinned semantics)', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [{ state: 'degraded', statusAffecting: false }],
    })
    expect(status).toBe('operational')
  })

  test('LAXII scenario: t2i operational + editing blocked -> badge Degraded', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'operational', statusAffecting: false }, // text-to-image
        { state: 'blocked', statusAffecting: true }, // conversational-editing
      ],
    })
    expect(status).toBe('degraded')
  })

  test('JAZMII scenario: t2v operational + i2v blocked -> badge Degraded', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'operational', statusAffecting: false }, // text-to-video
        { state: 'blocked', statusAffecting: true }, // image-to-video
      ],
    })
    expect(status).toBe('degraded')
  })

  test('core probe failure still renders unavailable (unchanged)', () => {
    const status = productStatus(true, {
      available: false,
      capabilities: [{ state: 'unavailable', statusAffecting: true }],
    })
    expect(status).toBe('unavailable')
  })

  test('capabilitySecondaryFailures detects only status-affecting rows', () => {
    expect(capabilitySecondaryFailures([{ state: 'blocked', statusAffecting: true } as never])).toBe(true)
    expect(capabilitySecondaryFailures([{ state: 'blocked', statusAffecting: false } as never])).toBe(false)
    expect(capabilitySecondaryFailures([])).toBe(false)
    expect(capabilitySecondaryFailures(undefined)).toBe(false)
  })

  test('RIISHE truth fix: chat Available + research Rate limited (display-only) -> badge Operational', () => {
    // FINAL CAPABILITY FIX (2026-11-07): research rides the separately
    // throttled functions class; its failure must never imply the core
    // conversational capability is unavailable.
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'operational', statusAffecting: true }, // chat
        { state: 'rate-limited', statusAffecting: false }, // research (429 window)
      ],
    })
    expect(status).toBe('operational')
  })

  test('CODE GIFTZ truth fix: coding-chat Rate limited + sandbox Available -> badge Rate limited', () => {
    // A chat probe that fails with HTTP 429 is throttling, NOT a red outage.
    const status = productStatus(true, {
      available: false,
      probe: { failureCategory: 'rate-limited', httpStatus: 429 },
      capabilities: [
        { state: 'rate-limited', statusAffecting: true }, // coding-chat
        { state: 'operational', statusAffecting: false }, // sandbox-execution
      ],
    })
    expect(status).toBe('rate-limited')
  })

  test('CODE GIFTZ hard failure: coding-chat Unavailable (non-429) -> badge Unavailable', () => {
    const status = productStatus(true, {
      available: false,
      probe: { failureCategory: 'network', httpStatus: null },
      capabilities: [
        { state: 'unavailable', statusAffecting: true },
        { state: 'operational', statusAffecting: false },
      ],
    })
    expect(status).toBe('unavailable')
  })

  test('JAZMII truth fix: t2v Available + i2v Available -> badge Operational (both real runs on record)', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'operational', statusAffecting: false }, // t2v real success
        { state: 'operational', statusAffecting: false }, // i2v real success
      ],
    })
    expect(status).toBe('operational')
  })

  test('mixed severity: blocked + rate-limited -> badge Degraded (functional gap outranks throttle)', () => {
    const status = productStatus(true, {
      available: true,
      capabilities: [
        { state: 'rate-limited', statusAffecting: true }, // t2i throttled
        { state: 'blocked', statusAffecting: true }, // editing contract
      ],
    })
    expect(status).toBe('degraded')
  })

  test('legacy payload without capability rows: 429 probe failure -> Rate limited', () => {
    const status = productStatus(true, {
      available: false,
      probe: { failureCategory: 'rate-limited', httpStatus: 429 },
    })
    expect(status).toBe('rate-limited')
  })
})
