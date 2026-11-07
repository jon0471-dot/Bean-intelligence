/**
 * BEAN Intelligence — unit tests for the per-product functional test suites.
 * Run: bun test tests/unit/diagnostics.test.ts
 *
 * The module under test (src/lib/diagnostics/suites.ts):
 *   - plans a named, classified test list per product (real / deterministic /
 *     simulated — never a mock presented as AI);
 *   - when the upstream breaker for the product's endpoint class is open, the
 *     provider test rows are BLOCKED without any network attempt, and
 *     dependent rows are skipped honestly;
 *   - runs are private to their owner: another user's runId is not readable;
 *   - no provider secrets or internal breaker internals leak into row output.
 *
 * ORDER MATTERS: the "closed breaker" test must run before any test injects a
 * 429 — the breaker deliberately never pre-clears an open window (a success
 * only resets the escalation streak), so there is no force-close in tests.
 */
import { describe, test, expect } from 'bun:test'
import {
  DIAG_PRODUCTS,
  PLANS,
  getRun,
  startRun,
} from '../../src/lib/diagnostics/suites'
import { noteUpstream429, upstreamBreakerState } from '../../src/lib/upstream/gateway'

const USER_A = 'user-a-1'
const USER_B = 'user-b-2'
const COOKIE = 'session=unit-test-cookie'

describe('breaker closed (must run before any 429 injection)', () => {
  test('suite starts and rows leave pending when the endpoint class is quiet', async () => {
    const run = startRun('code-giftz', USER_A, COOKIE)
    await new Promise((r) => setTimeout(r, 60))
    const codegen = run.tests.find((t) => t.id === 'codegen')!
    // The self-fetch goes to the real local API with a fake session cookie:
    // the row resolves to a failure (401) — the point is it must NOT be
    // 'blocked', because the breaker was never opened in this process.
    expect(['running', 'failed', 'passed']).toContain(codegen.state)
    expect(codegen.state).not.toBe('blocked')
  })
})

describe('diagnostics plan shape', () => {
  test('every product has a plan with classified named tests', () => {
    for (const p of DIAG_PRODUCTS) {
      const plan = PLANS[p]
      expect(plan.length).toBeGreaterThanOrEqual(3)
      for (const row of plan) {
        expect(row.name.length).toBeGreaterThan(3)
        expect(['real', 'deterministic', 'simulated']).toContain(row.classification)
        expect(row.id.length).toBeGreaterThan(0)
      }
      // Exactly one real provider test per product run (no provider fan-out).
      expect(plan.filter((r) => r.classification === 'real').length).toBe(1)
    }
  })

  test('each product plan has at least one non-provider row', () => {
    for (const p of DIAG_PRODUCTS) {
      expect(PLANS[p].some((r) => r.classification !== 'real')).toBe(true)
    }
  })
})

describe('run ownership', () => {
  test('a run is only readable by its owner', async () => {
    const run = startRun('riishe', USER_A, COOKIE)
    await new Promise((r) => setTimeout(r, 60))
    expect(getRun(USER_A, run.id)?.id).toBe(run.id)
    expect(getRun(USER_B, run.id)).toBeNull()
  })

  test('run rows never contain the session cookie', async () => {
    const run = startRun('riishe', USER_A, COOKIE)
    await new Promise((r) => setTimeout(r, 60))
    expect(JSON.stringify(run.tests)).not.toContain('unit-test-cookie')
  })
})

describe('breaker-open behavior (injects 429s — keep last)', () => {
  test('open chat breaker blocks provider row without network and skips dependents', async () => {
    noteUpstream429('chat')
    expect(upstreamBreakerState('chat').coolingDown).toBe(true)

    const run = startRun('code-giftz', USER_A, COOKIE)
    await new Promise((r) => setTimeout(r, 60))

    const codegen = run.tests.find((t) => t.id === 'codegen')!
    const sandbox = run.tests.find((t) => t.id === 'sandbox')!
    expect(codegen.state).toBe('blocked')
    expect(codegen.error).toMatch(/rate-limited/i)
    expect(codegen.error).not.toMatch(/breaker|cooldown ms|consecutive/i) // no internal detail leaks
    expect(sandbox.state).toBe('blocked')
    expect(sandbox.error).toMatch(/skipped/i)
  })

  test('open video breaker blocks jazmii provider row and dependent media rows', async () => {
    noteUpstream429('video')
    const run = startRun('jazmii', USER_A, COOKIE)
    await new Promise((r) => setTimeout(r, 60))
    const submit = run.tests.find((t) => t.id === 't2v-submit')!
    const tracking = run.tests.find((t) => t.id === 'job-tracking')!
    const mp4 = run.tests.find((t) => t.id === 'mp4-verify')!
    expect(submit.state).toBe('blocked')
    expect(tracking.state).toBe('blocked')
    expect(mp4.state).toBe('blocked')
  })
})
