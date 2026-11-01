/**
 * BEAN Intelligence — LAXII local deterministic engine adapter tests.
 *
 * Context: src/lib/laxii/local-adapter.ts was imported by the health route
 * and the router but had never been created (module-not-found build error).
 * It is implemented as the real capability probe for bean-image-local-sharp.
 *
 * What is pinned here, against REAL production code (no mocks — Sharp is a
 * real dependency and the probe is real executed work):
 *  1. health() reports healthy ONLY after a real Sharp decode → resize → raw
 *     round-trip verified by byte length (executed, not claimed).
 *  2. The healthy detail NEVER claims generative capability — the generative
 *     layer is the separately probed Diffusers worker (honesty boundary,
 *     mirrors hosted-image.ts's "reachable ≠ generation proof" rule).
 *  3. The report shape is the adapter contract (HealthReport): ISO checkedAt,
 *     measured latencyMs, no cached flag (a real probe, not a cache entry).
 *  4. The adapter identity matches the registry entry bean-image-local-sharp,
 *     which stays enabled + generative:false.
 */
import { describe, test, expect } from 'bun:test'

import { localLaxiiAdapter } from '../../src/lib/laxii/local-adapter'
import { localPreflight } from '../../src/lib/laxii/models'
import { getBackend } from '../../src/lib/registry/backends'

describe('localLaxiiAdapter.health(): real executed Sharp capability', () => {
  test('executes a real round-trip and reports healthy with measured evidence', async () => {
    const report = await localLaxiiAdapter.health()
    expect(report.healthy).toBe(true)
    expect(typeof report.latencyMs).toBe('number')
    expect(report.latencyMs as number).toBeGreaterThanOrEqual(0)
    // checkedAt is a real timestamp, not a placeholder
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false)
    // Measured evidence of the executed round-trip, not a bare assertion
    expect(report.detail).toContain('EXECUTED')
    expect(report.detail).toContain('round-trip')
    // Honesty boundary: the deterministic probe never claims generative scope
    expect(report.detail).toContain('NO generative model')
    // A real probe — never served from the health cache
    expect(report.cached).toBeUndefined()
  })

  test('adapter identity matches the registry entry and stays non-generative', () => {
    expect(localLaxiiAdapter.backendId).toBe('bean-image-local-sharp')
    const backend = getBackend('bean-image-local-sharp')
    expect(backend?.enabled).toBe(true)
    expect(backend?.limits.generative).toBe(false)
  })

  test('adapter satisfies the TaskAdapter contract the router maps it into', () => {
    // The router's ADAPTERS record requires backendId + health(); optional
    // methods (chat/generateImage/codeTask) must stay absent here because the
    // local engine is deterministic-only by registry contract.
    expect(typeof localLaxiiAdapter.health).toBe('function')
    expect(localLaxiiAdapter.generateImage).toBeUndefined()
    expect(localLaxiiAdapter.chat).toBeUndefined()
    expect(localLaxiiAdapter.codeTask).toBeUndefined()
  })
})

describe('localPreflight(): the shared probe must not false-negative a working engine', () => {
  test('deterministic enhancement is measured available on a host where Sharp executes', async () => {
    // Regression pin: the probe PNG is RGBA, and the old bare .raw() check
    // (48-byte expectation on 4-channel output) reported the engine
    // unavailable everywhere — a measured false negative, fixed with
    // removeAlpha(). Note: this calls the REAL preflight; the generative
    // worker part runs its own preflight separately and is not asserted here.
    const pre = await localPreflight()
    expect(pre.localEngine.available).toBe(true)
    expect(pre.localEngine.detail).toContain('completed')
    expect(pre.canRun.deterministicEnhancement).toBe(true)
  })
})
