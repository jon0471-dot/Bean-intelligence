/**
 * PHASE 1 — bounded escalating backoff for the upstream 429 breaker.
 *
 * Contract under test:
 *  - the FIRST observed 429 opens the base 60s cooldown (unchanged from the
 *    measured baseline behavior);
 *  - CONSECUTIVE 429s (no intervening success) double the window up to the
 *    hard 10-minute cap — 60s → 120s → 240s → 480s → 600s → 600s …;
 *  - a REAL success on the class resets the streak, so the next throttle
 *    starts again from the base window;
 *  - a success never pre-clears an open cooldown (recovery stays verified
 *    call-by-call);
 *  - escalation is strictly per endpoint class (a chat 429 must not
 *    escalate the functions breaker);
 *  - the structured breaker state exposes streak/cooldown/remaining for
 *    honest health reporting.
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  UPSTREAM_429_COOLDOWN_MS,
  UPSTREAM_429_COOLDOWN_MAX_MS,
  _resetUpstreamCooldownForTests,
  escalated429CooldownMs,
  noteUpstream429,
  noteUpstreamSuccess,
  upstreamBreakerState,
  upstreamCooldownRemainingMs,
  upstreamCoolingDown,
} from '../../src/lib/upstream/gateway'

beforeEach(() => {
  _resetUpstreamCooldownForTests()
})

describe('escalation schedule', () => {
  test('base cooldown is the measured 60s; cap is 10 minutes', () => {
    expect(UPSTREAM_429_COOLDOWN_MS).toBe(60_000)
    expect(UPSTREAM_429_COOLDOWN_MAX_MS).toBe(600_000)
  })

  test('escalation doubles per consecutive 429 and saturates at the cap', () => {
    expect(escalated429CooldownMs(1)).toBe(60_000)
    expect(escalated429CooldownMs(2)).toBe(120_000)
    expect(escalated429CooldownMs(3)).toBe(240_000)
    expect(escalated429CooldownMs(4)).toBe(480_000)
    expect(escalated429CooldownMs(5)).toBe(600_000)
    expect(escalated429CooldownMs(9)).toBe(600_000) // cap holds
    expect(escalated429CooldownMs(0)).toBe(60_000) // defensive: streak < 1 → base
  })
})

describe('breaker escalation over consecutive 429s', () => {
  test('first 429 opens the base window (baseline behavior preserved)', () => {
    noteUpstream429('chat')
    const state = upstreamBreakerState('chat')
    expect(state.coolingDown).toBe(true)
    expect(state.consecutive429s).toBe(1)
    expect(state.currentCooldownMs).toBe(UPSTREAM_429_COOLDOWN_MS)
  })

  test('consecutive 429s escalate the window up to the cap', () => {
    noteUpstream429('chat') // 1st: 60s
    noteUpstream429('chat') // 2nd: 120s
    noteUpstream429('chat') // 3rd: 240s
    const state = upstreamBreakerState('chat')
    expect(state.consecutive429s).toBe(3)
    expect(state.currentCooldownMs).toBe(240_000)
    expect(upstreamCooldownRemainingMs('chat')).toBeLessThanOrEqual(240_000)
    expect(upstreamCooldownRemainingMs('chat')).toBeGreaterThan(200_000)
  })

  test('a real success resets the streak but does not pre-clear an open window', () => {
    noteUpstream429('chat')
    noteUpstream429('chat') // streak 2, window 120s
    noteUpstreamSuccess('chat')
    const state = upstreamBreakerState('chat')
    expect(state.consecutive429s).toBe(0)
    // The still-open window stays open (recovery is verified call-by-call,
    // never assumed) — success only resets the ESCALATION counter.
    expect(state.coolingDown).toBe(true)
    // ...and the NEXT 429 starts from the base window again.
    noteUpstream429('chat')
    expect(upstreamBreakerState('chat').currentCooldownMs).toBe(UPSTREAM_429_COOLDOWN_MS)
  })

  test('escalation is strictly per endpoint class', () => {
    noteUpstream429('chat')
    noteUpstream429('chat')
    noteUpstream429('chat')
    expect(upstreamBreakerState('chat').consecutive429s).toBe(3)
    const fn = upstreamBreakerState('functions')
    expect(fn.consecutive429s).toBe(0)
    expect(fn.coolingDown).toBe(false)
  })

  test('images and video classes carry independent breakers (new capability surface)', () => {
    noteUpstream429('images')
    expect(upstreamCoolingDown('images')).toBe(true)
    expect(upstreamCoolingDown('video')).toBe(false)
    expect(upstreamCoolingDown('chat')).toBe(false)
  })

  test('breaker state reports last429At and skipped calls for honest reporting', () => {
    noteUpstream429('functions')
    const state = upstreamBreakerState('functions')
    expect(state.last429At).not.toBeNull()
    expect(Number.isNaN(Date.parse(state.last429At!))).toBe(false)
    expect(state.skippedCalls).toBe(0)
  })
})
