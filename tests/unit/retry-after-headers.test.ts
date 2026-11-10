/**
 * ZERO-DOWNTIME RECOVERY — provider retry-hint parsing + breaker honoring.
 *
 * Pinned behavior (brief §2: "Respect provider reset headers and
 * Retry-After when present"):
 *  - parseRetryAfterHeaders honors `retry-after` (delta-seconds AND
 *    HTTP-date) then `x-ratelimit-reset` (epoch seconds or ms);
 *  - absent/garbage headers -> null (BEAN keeps its own conservative
 *    backoff — a hint is NEVER invented);
 *  - noteUpstream429 uses the provider hint when supplied, clamped to
 *    [5s, 10min] so an absurd value can neither spam the provider nor wedge
 *    a product; without a hint the existing escalating schedule is unchanged.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  parseRetryAfterHeaders,
  clampProviderRetryAfterMs,
  noteUpstream429,
  noteUpstreamSuccess,
  upstreamBreakerState,
  upstreamCooldownRemainingMs,
  UPSTREAM_429_COOLDOWN_MS,
  UPSTREAM_429_COOLDOWN_MAX_MS,
  PROVIDER_RETRY_AFTER_MIN_MS,
  PROVIDER_RETRY_AFTER_MAX_MS,
  _resetUpstreamCooldownForTests,
} from '../../src/lib/upstream/gateway'

function headersOf(h: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

beforeEach(() => {
  _resetUpstreamCooldownForTests()
})

describe('parseRetryAfterHeaders', () => {
  const now = Date.parse('2026-11-11T00:00:00Z')

  test('delta-seconds retry-after', () => {
    expect(parseRetryAfterHeaders(headersOf({ 'Retry-After': '30' }), now)).toBe(30_000)
  })

  test('HTTP-date retry-after (future)', () => {
    const at = parseRetryAfterHeaders(headersOf({ 'Retry-After': 'Wed, 11 Nov 2026 00:01:00 GMT' }), now)
    expect(at).toBe(60_000)
  })

  test('HTTP-date in the past clamps to 0 (window already over)', () => {
    expect(parseRetryAfterHeaders(headersOf({ 'Retry-After': 'Tue, 10 Nov 2026 00:00:00 GMT' }), now)).toBe(0)
  })

  test('x-ratelimit-reset in epoch seconds and milliseconds', () => {
    expect(parseRetryAfterHeaders(headersOf({ 'x-ratelimit-reset': String(Math.floor(now / 1000) + 120) }), now)).toBe(120_000)
    expect(parseRetryAfterHeaders(headersOf({ 'x-ratelimit-reset': String(now + 45_000) }), now)).toBe(45_000)
  })

  test('retry-after wins over x-ratelimit-reset', () => {
    const h = headersOf({ 'Retry-After': '10', 'x-ratelimit-reset': String(now / 1000 + 999) })
    expect(parseRetryAfterHeaders(h, now)).toBe(10_000)
  })

  test('absent or unparseable headers NEVER invent a hint', () => {
    expect(parseRetryAfterHeaders(headersOf({}), now)).toBeNull()
    expect(parseRetryAfterHeaders(headersOf({ 'Retry-After': 'soon' }), now)).toBeNull()
    expect(parseRetryAfterHeaders(headersOf({ 'x-ratelimit-reset': 'later' }), now)).toBeNull()
  })
})

describe('clampProviderRetryAfterMs', () => {
  test('clamps into [5s, 10min]; null/garbage/nonpositive -> null', () => {
    expect(clampProviderRetryAfterMs(1_000)).toBe(PROVIDER_RETRY_AFTER_MIN_MS)
    expect(clampProviderRetryAfterMs(30_000)).toBe(30_000)
    expect(clampProviderRetryAfterMs(999 * 60_000)).toBe(PROVIDER_RETRY_AFTER_MAX_MS)
    expect(clampProviderRetryAfterMs(null)).toBeNull()
    expect(clampProviderRetryAfterMs(0)).toBeNull()
    expect(clampProviderRetryAfterMs(Number.NaN)).toBeNull()
    expect(PROVIDER_RETRY_AFTER_MAX_MS).toBe(UPSTREAM_429_COOLDOWN_MAX_MS)
  })
})

describe('noteUpstream429 honors the provider hint', () => {
  test('a hinted 429 sets the cooldown to the (clamped) provider value', () => {
    const now = Date.now()
    noteUpstream429('chat', now, 120_000)
    const st = upstreamBreakerState('chat', now)
    expect(st.coolingDown).toBe(true)
    expect(st.currentCooldownMs).toBe(120_000)
    expect(upstreamCooldownRemainingMs('chat', now + 119_000)).toBe(1_000)
  })

  test('a sub-minimum hint is clamped UP to 5s (never spams the provider)', () => {
    const now = Date.now()
    noteUpstream429('images', now, 10)
    expect(upstreamBreakerState('images', now).currentCooldownMs).toBe(5_000)
  })

  test('an over-long hint is clamped DOWN to 10min (never wedges a product)', () => {
    const now = Date.now()
    noteUpstream429('video', now, 24 * 60 * 60_000)
    expect(upstreamBreakerState('video', now).currentCooldownMs).toBe(600_000)
  })

  test('without a hint the escalating schedule is unchanged (60s base)', () => {
    const now = Date.now()
    noteUpstream429('chat', now)
    expect(upstreamBreakerState('chat', now).currentCooldownMs).toBe(UPSTREAM_429_COOLDOWN_MS)
  })

  test('streak still escalates when a later 429 has no hint', () => {
    const now = Date.now()
    noteUpstream429('chat', now, 90_000)
    noteUpstream429('chat', now + 1)
    expect(upstreamBreakerState('chat', now + 1).currentCooldownMs).toBe(120_000)
    noteUpstreamSuccess('chat')
    noteUpstream429('chat', now + 2)
    expect(upstreamBreakerState('chat', now + 2).currentCooldownMs).toBe(UPSTREAM_429_COOLDOWN_MS)
  })
})
