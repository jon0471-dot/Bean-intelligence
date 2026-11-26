/**
 * M42.5 — race-loser rejection hygiene (regression: measured live during
 * the M42.5 acceptance run — a gateway 504 that LOST a withTimeout race
 * rejected ~seconds later as an UNHANDLED rejection and crashed the whole
 * process after the caller had already recorded its results).
 *
 * bun fails a test on any unhandled rejection, so a clean pass here IS the
 * regression pin: the exported timeout wrappers must sink their losers.
 */
import { describe, test, expect } from 'bun:test'

function laterReject<T>(ms: number, value: T): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(`late loser rejection (${String(value)}) after ${ms}ms`)), ms)
  })
}

function laterResolve<T>(ms: number, value: T): Promise<T> {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

describe('M42.5 race-loser rejection hygiene', () => {
  test('provider withTimeout: the loser rejects late — the process must stay clean (no unhandled rejection)', async () => {
    const { withTimeout } = await import('../../src/lib/research/provider')
    const loser = laterReject(80, 'page_reader')
    const raced = withTimeout(loser, 20, 'page_reader')
    await expect(raced).rejects.toThrow('page_reader timed out after 20ms')
    // Outlive the late loser rejection (80ms) — an unsunk loser would crash
    // bun with an unhandled rejection before this resolves.
    await new Promise((r) => setTimeout(r, 160))
  })

  test('direct withBudget: the loser rejects late — the process must stay clean', async () => {
    const { withBudget } = await import('../../src/lib/research/direct')
    const loser = laterReject(80, 'lane')
    const raced = withBudget(loser, 20)
    await expect(raced).rejects.toThrow('independent retrieval timed out after 20ms budget')
    await new Promise((r) => setTimeout(r, 160))
  })

  test('the sink never changes the winner path — a tool promise that settles first still passes its value through', async () => {
    const { withTimeout } = await import('../../src/lib/research/provider')
    const winner = laterResolve(10, 'real-page')
    const raced = withTimeout(winner, 500, 'page_reader')
    await expect(raced).resolves.toBe('real-page')
    await new Promise((r) => setTimeout(r, 30))
  })

  test('the sink never swallows a first-settling rejection — the race still surfaces it', async () => {
    const { withBudget } = await import('../../src/lib/research/direct')
    const firstFailure = laterReject(10, 'lane')
    const raced = withBudget(firstFailure, 500)
    await expect(raced).rejects.toThrow('late loser rejection (lane) after 10ms')
    await new Promise((r) => setTimeout(r, 30))
  })
})
