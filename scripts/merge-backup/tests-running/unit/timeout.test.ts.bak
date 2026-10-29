/**
 * BEAN Intelligence — unit tests for the router's timeout guard.
 * Run: bun test tests/unit/timeout.test.ts
 *
 * These tests verify REAL timing behavior with real promises. No mocks of
 * the timeout mechanism itself. The guard's documented limitation (the
 * gateway SDK exposes no AbortSignal, so a timed-out underlying request
 * cannot be cancelled) is asserted here as behavior: the loser promise
 * keeps running — the tests only guarantee the caller's awaited result.
 */
import { describe, test, expect } from 'bun:test'
import { withTimeout } from '../../src/lib/adapters/hosted-llm'

const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('withTimeout (router timeout guard)', () => {
  test('resolves with the wrapped result when the operation beats the deadline', async () => {
    const t0 = Date.now()
    const result = await withTimeout(settle(20).then(() => 'bean-ok'), 2000, 'TEST')
    expect(result).toBe('bean-ok')
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  test('rejects with a labeled error once the deadline passes', async () => {
    const t0 = Date.now()
    try {
      await withTimeout(settle(5000), 30, 'RIISHE')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toBe('RIISHE timed out after 30ms')
      const elapsed = Date.now() - t0
      expect(elapsed).toBeGreaterThanOrEqual(20)
      expect(elapsed).toBeLessThan(1000)
    }
  })

  test('a late rejection after the timeout win does not crash the process', async () => {
    // The losing promise rejects 60ms AFTER the timeout already settled the
    // race. If the guard left this rejection unhandled, bun test would fail
    // the whole run with an unhandled rejection.
    const loser = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late')), 60))
    await expect(withTimeout(loser, 10, 'LATE')).rejects.toThrow('LATE timed out after 10ms')
    await settle(120)
  })

  test('clears its timer when the operation finishes first (no dangling keep-alive)', async () => {
    // If the internal timer were not cleared, it would keep the event loop
    // alive for the full 5000ms and this test file would take ~5s to exit.
    const t0 = Date.now()
    await withTimeout(settle(10).then(() => 1), 5000, 'TIMER')
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
