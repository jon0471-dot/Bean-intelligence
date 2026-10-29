/**
 * Health-probe cache honesty tests (work order 7).
 *
 * Contract: cached reports keep the ORIGINAL checkedAt of the real probe,
 * carry cached:true, never turn a failure into a success, and identical
 * concurrent probes share ONE real provider call (no probe storms).
 *
 * Run: bun test tests/unit/health-cache.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { cachedHealth, clearHealthCacheForTests } from '../../src/lib/adapters/health-cache'
import type { HealthReport } from '../../src/lib/adapters/types'

function report(healthy: boolean, detail = 'live probe'): HealthReport {
  return {
    healthy,
    checkedAt: new Date().toISOString(),
    latencyMs: 5,
    detail,
  }
}

describe('health probe cache', () => {
  test('serves TTL-fresh results from cache with cached:true and the original checkedAt', async () => {
    clearHealthCacheForTests()
    let probes = 0
    const probe = async () => {
      probes += 1
      return report(true)
    }
    const first = await cachedHealth('k1', probe)
    expect(probes).toBe(1)
    expect(first.cached).toBeFalsy()

    const second = await cachedHealth('k1', probe)
    expect(probes).toBe(1) // no second real probe within the TTL
    expect(second.cached).toBe(true)
    expect(second.checkedAt).toBe(first.checkedAt)
    expect(second.healthy).toBe(true)
  })

  test('identical concurrent probes share ONE real provider call', async () => {
    clearHealthCacheForTests()
    let probes = 0
    const probe = async () => {
      probes += 1
      await new Promise((r) => setTimeout(r, 10))
      return report(true)
    }
    const [a, b, c] = await Promise.all([
      cachedHealth('k2', probe),
      cachedHealth('k2', probe),
      cachedHealth('k2', probe),
    ])
    expect(probes).toBe(1)
    expect(a.healthy).toBe(true)
    expect(b.healthy).toBe(true)
    expect(c.healthy).toBe(true)
  })

  test('caches an UNHEALTHY probe honestly — never retried into a fake success', async () => {
    clearHealthCacheForTests()
    let probes = 0
    const detail = 'Upstream gateway rate-limited (HTTP 429) — daily quota may be exhausted.'
    const probe = async () => {
      probes += 1
      return report(false, detail)
    }
    const first = await cachedHealth('k3', probe)
    const second = await cachedHealth('k3', probe)
    expect(probes).toBe(1)
    expect(first.healthy).toBe(false)
    expect(second.healthy).toBe(false) // failure preserved, not upgraded
    expect(second.detail).toBe(detail)
    expect(second.cached).toBe(true)
  })

  test('expires after the TTL and probes for real again', async () => {
    clearHealthCacheForTests()
    let probes = 0
    const probe = async () => {
      probes += 1
      return report(probes === 1, `probe ${probes}`)
    }
    await cachedHealth('k4', probe, { ttlMs: 5 })
    await new Promise((r) => setTimeout(r, 15))
    const fresh = await cachedHealth('k4', probe, { ttlMs: 5 })
    expect(probes).toBe(2)
    expect(fresh.cached).toBeFalsy()
    expect(fresh.detail).toBe('probe 2')
  })
})
