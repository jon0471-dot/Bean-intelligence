/**
 * ZERO-DOWNTIME RECOVERY — bounded jitter on retry backoff + staggered
 * remote health probes.
 *
 * Pinned behavior:
 *  - jitteredRetryBackoffMs: always within [0.8 × base, 1.2 × base], never
 *    below 1s; deterministic under an injected rand; two cohorts of jobs
 *    retrying at the same instant get DIFFERENT schedules (retry-storm
 *    prevention);
 *  - remoteProbeDelayMs / staggeredRemoteProbes: remote probes run one at a
 *    time (max 1 in flight) with a fixed gap — the anti-burst guarantee for
 *    the same-host health fan-out; results keep factory order.
 */
import { describe, test, expect } from 'bun:test'
import { jitteredRetryBackoffMs, RETRY_JITTER_FRACTION } from '../../src/lib/ai-engine/config'
import {
  remoteProbeDelayMs,
  staggeredRemoteProbes,
  REMOTE_PROBE_STAGGER_MS,
} from '../../src/lib/adapters/probe-stagger'

describe('jittered retry backoff', () => {
  test('deterministic bounds: rand=0 -> 0.8×base, rand=1 -> 1.2×base', () => {
    const base = 60_000
    expect(jitteredRetryBackoffMs(base, () => 0)).toBe(Math.round(base * (1 - RETRY_JITTER_FRACTION)))
    expect(jitteredRetryBackoffMs(base, () => 1)).toBe(Math.round(base * (1 + RETRY_JITTER_FRACTION)))
  })

  test('a thousand draws always stay inside [0.8, 1.2] × base and spread out', () => {
    const base = 15_000
    const lo = base * (1 - RETRY_JITTER_FRACTION)
    const hi = base * (1 + RETRY_JITTER_FRACTION)
    const draws = new Set<number>()
    for (let i = 0; i < 1000; i += 1) {
      const v = jitteredRetryBackoffMs(base)
      expect(v).toBeGreaterThanOrEqual(Math.floor(lo))
      expect(v).toBeLessThanOrEqual(Math.ceil(hi))
      draws.add(v)
    }
    // Real spread, not a constant in disguise.
    expect(draws.size).toBeGreaterThan(100)
  })

  test('tiny backoffs never go below 1s', () => {
    expect(jitteredRetryBackoffMs(0, () => 0)).toBe(1_000)
    expect(jitteredRetryBackoffMs(500, () => 0)).toBe(1_000)
  })

  test('two jobs failing at the same instant usually get different schedules', () => {
    const base = 15_000
    let same = 0
    for (let i = 0; i < 200; i += 1) {
      if (jitteredRetryBackoffMs(base) === jitteredRetryBackoffMs(base)) same += 1
    }
    expect(same).toBeLessThan(40) // <20% — a synchronized cohort is broken up
  })
})

describe('staggered remote probes', () => {
  test('delay schedule is linear in the probe index', () => {
    expect(remoteProbeDelayMs(0)).toBe(0)
    expect(remoteProbeDelayMs(1)).toBe(REMOTE_PROBE_STAGGER_MS)
    expect(remoteProbeDelayMs(4)).toBe(4 * REMOTE_PROBE_STAGGER_MS)
    expect(remoteProbeDelayMs(-2)).toBe(0)
  })

  test('results keep factory order', async () => {
    const out = await staggeredRemoteProbes(
      [async () => 'a', async () => 'b', async () => 'c'],
      1,
    )
    expect(out).toEqual(['a', 'b', 'c'])
  })

  test('AT MOST ONE remote probe in flight (serialized, gap applied between probes)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const probe = async (label: string): Promise<string> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 15))
      inFlight -= 1
      return label
    }
    const t0 = Date.now()
    const out = await staggeredRemoteProbes([() => probe('1'), () => probe('2'), () => probe('3')], 30)
    const elapsed = Date.now() - t0
    expect(out).toEqual(['1', '2', '3'])
    expect(maxInFlight).toBe(1)
    // 3 probes × 15ms work + 2 gaps × 30ms >= 90ms — the gaps really ran.
    expect(elapsed).toBeGreaterThanOrEqual(85)
  })
})
