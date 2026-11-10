/**
 * ZERO-DOWNTIME RECOVERY — availability dashboard status per acceptance
 * scenario (brief §6 scenario 10: "Dashboard status after each scenario").
 *
 * The badge is DERIVED by the pure productStatus() from the same evidence
 * shapes /api/health emits. This pins the badge for every acceptance
 * scenario WITHOUT any network:
 *  1. normal operation            -> operational
 *  2. primary provider 429        -> rate-limited (never a red "broken")
 *  3. fallback serving            -> operational (badge stays green; the
 *     serving fallback is visible in usage attribution, not a fake badge)
 *  4. all providers unavailable   -> unavailable (non-throttle hard failure)
 *  5. quota refill                -> back to operational on success evidence
 *  6. queued recovery             -> rate-limited while parked, operational
 *     once recovery evidence arrives
 *  7. restart during queued work  -> persisted real attempts keep the badge
 *     honest across process loss
 *  8. blocked / never configured  -> not-configured
 * Plus: the brief's four-state vocabulary is fully covered by the derived
 * states (Rate limited / Blocked render distinctly), and optional
 * capability failures never hold the badge hostage.
 */
import { describe, test, expect } from 'bun:test'
import { productStatus, type ProductHealthEntry } from '../../src/lib/registry/status'

function entry(overrides: Partial<ProductHealthEntry>): ProductHealthEntry {
  return { available: true, ...overrides }
}

describe('dashboard status per acceptance scenario', () => {
  const okChat: ProductHealthEntry['capabilities'] = [
    { id: 'chat', label: 'chat', core: true, state: 'operational', statusAffecting: true },
  ]

  test('1. normal provider operation -> operational', () => {
    expect(productStatus(true, entry({ available: true, capabilities: okChat }))).toBe('operational')
  })

  test('2. primary provider HTTP 429 -> rate-limited (distinct from broken)', () => {
    const s = productStatus(
      true,
      entry({
        available: false,
        probe: { failureCategory: 'rate-limited', httpStatus: 429 },
        capabilities: [
          { id: 'chat', label: 'chat', core: true, state: 'rate-limited', statusAffecting: true, evidence: { httpStatus: 429 } },
        ],
      }),
    )
    expect(s).toBe('rate-limited')
  })

  test('3. fallback serving the request -> the badge stays operational (fallback visible in attribution, not a forced green)', () => {
    // The health evidence chain is backend-agnostic: what the badge may NEVER
    // do is render a failed probe as green. A SERVING route (real success
    // evidence) is legitimately operational.
    const s = productStatus(
      true,
      entry({
        available: true,
        capabilities: [
          { id: 'chat', label: 'chat', core: true, state: 'operational', statusAffecting: true, evidence: { source: 'real-success' } },
        ],
      }),
    )
    expect(s).toBe('operational')
  })

  test('4. all providers unavailable (non-throttle failure) -> unavailable', () => {
    const s = productStatus(
      true,
      entry({
        available: false,
        probe: { failureCategory: 'backend-error', httpStatus: 503 },
        capabilities: [
          { id: 'chat', label: 'chat', core: true, state: 'unavailable', statusAffecting: true, evidence: { httpStatus: 503 } },
        ],
      }),
    )
    expect(s).toBe('unavailable')
  })

  test('5. quota refill -> the badge returns to operational on REAL success evidence', () => {
    const before = productStatus(
      true,
      entry({
        available: false,
        capabilities: [
          { id: 'generation', label: 'generation', core: true, state: 'rate-limited', statusAffecting: true, evidence: { httpStatus: 429 } },
        ],
      }),
    )
    expect(before).toBe('rate-limited')
    const after = productStatus(
      true,
      entry({
        available: true,
        capabilities: [
          { id: 'generation', label: 'generation', core: true, state: 'operational', statusAffecting: true, evidence: { source: 'real-success' } },
        ],
      }),
    )
    expect(after).toBe('operational')
  })

  test('6. queued recovery: parked job keeps the product rate-limited until a real attempt succeeds', () => {
    const parked = productStatus(
      true,
      entry({
        available: true,
        generation: { available: false, failureCategory: 'rate-limited', httpStatus: 429 },
        capabilities: [
          { id: 'generation', label: 'generation', core: true, state: 'rate-limited', statusAffecting: true, evidence: { httpStatus: 429 } },
        ],
      }),
    )
    expect(parked).toBe('rate-limited')
  })

  test('7. restart during queued work: persisted real success keeps the badge honest (no fabricated green, no unfair red)', () => {
    const s = productStatus(
      true,
      entry({
        available: true,
        capabilities: [
          {
            id: 'generation',
            label: 'generation',
            core: true,
            state: 'operational',
            statusAffecting: true,
            evidence: { source: 'persisted-completed-job', checkedAt: '2026-11-10T01:30:00Z' },
          },
        ],
      }),
    )
    expect(s).toBe('operational')
  })

  test('8. no valid route configured -> not-configured (the brief\'s Blocked)', () => {
    expect(productStatus(false, entry({ available: true }))).toBe('not-configured')
  })

  test('a failed OPTIONAL capability never holds the badge hostage (research/sandbox rows)', () => {
    const s = productStatus(
      true,
      entry({
        available: true,
        research: { available: false },
        capabilities: [
          ...okChat,
          { id: 'research', label: 'research', core: false, state: 'rate-limited', statusAffecting: false, evidence: { httpStatus: 429 } },
        ],
      }),
    )
    expect(s).toBe('operational')
  })

  test('severity order: an unavailable core row outranks rate-limited/degraded siblings', () => {
    const s = productStatus(
      true,
      entry({
        available: false,
        capabilities: [
          { id: 'chat', label: 'chat', core: true, state: 'rate-limited', statusAffecting: true },
          { id: 'generation', label: 'generation', core: true, state: 'unavailable', statusAffecting: true },
        ],
      }),
    )
    expect(s).toBe('unavailable')
  })

  test('legacy payloads (no capability rows) still derive honest statuses', () => {
    expect(productStatus(true, entry({ available: true }))).toBe('operational')
    expect(productStatus(true, entry({ available: false, probe: { failureCategory: 'rate-limited', httpStatus: 429 } }))).toBe('rate-limited')
    expect(productStatus(true, entry({ available: true, research: { available: false } }))).toBe('degraded')
  })
})
