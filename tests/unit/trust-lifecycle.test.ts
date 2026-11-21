/**
 * TRUST ENGINE — lifecycle contract tests.
 *
 * Pinned behavior (February 2027 brief §5, "Truthful task lifecycle"):
 *  - the 8-state lifecycle table is enforced; illegal jumps are rejected;
 *  - a completed-family outcome REQUIRES a verification summary — a task is
 *    never marked completed merely because a model returned a response;
 *  - failure and cancellation require truthful notes;
 *  - terminal rows are immutable;
 *  - the RIISHE states → outcome mapping NEVER upgrades an unverified answer
 *    to a plain "completed".
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const {
  canTransitionTask,
  isTerminalTaskStatus,
  mapRiisheStatesToOutcome,
  TRUST_TASK_STATUSES,
} = await import('../../src/lib/trust/types')
const {
  createTrustTask,
  startTrustTask,
  planTrustSteps,
  updateTrustStepStatus,
  finalizeTrustTask,
  failTrustTask,
  cancelTrustTask,
  getTrustTaskForOwner,
} = await import('../../src/lib/trust/tasks')

beforeEach(() => {
  fake.reset()
})

describe('trust lifecycle — transition table (pure)', () => {
  test('the full truthful lifecycle vocabulary exists', () => {
    expect([...TRUST_TASK_STATUSES]).toEqual([
      'planned',
      'waiting_for_approval',
      'running',
      'completed',
      'completed_with_limitations',
      'partially_completed',
      'failed',
      'cancelled',
    ])
  })

  test('planned → running → waiting_for_approval → running are legal', () => {
    expect(canTransitionTask('planned', 'running')).toBe(true)
    expect(canTransitionTask('running', 'waiting_for_approval')).toBe(true)
    expect(canTransitionTask('waiting_for_approval', 'running')).toBe(true)
  })

  test('a waiting task can never jump straight to completed', () => {
    expect(canTransitionTask('waiting_for_approval', 'completed')).toBe(false)
    expect(canTransitionTask('planned', 'completed')).toBe(false)
  })

  test('terminal states have no outgoing edges', () => {
    for (const terminal of ['completed', 'completed_with_limitations', 'partially_completed', 'failed', 'cancelled']) {
      expect(isTerminalTaskStatus(terminal)).toBe(true)
      for (const to of TRUST_TASK_STATUSES) {
        expect(canTransitionTask(terminal as never, to as never)).toBe(false)
      }
    }
  })
})

describe('trust lifecycle — RIISHE states → honest outcome (pure)', () => {
  test('no persisted answer is a failure, never a completion', () => {
    expect(mapRiisheStatesToOutcome(['VERIFIED_FROM_SOURCES'], false).outcome).toBe('failed')
    expect(mapRiisheStatesToOutcome([], false).outcome).toBe('failed')
  })

  test('UNVERIFIED never completes — downgrade to completed_with_limitations', () => {
    const m = mapRiisheStatesToOutcome(['UNVERIFIED'], true)
    expect(m.outcome).toBe('completed_with_limitations')
  })

  test('TOOL_UNAVAILABLE completes only with limitations', () => {
    expect(mapRiisheStatesToOutcome(['TOOL_UNAVAILABLE'], true).outcome).toBe('completed_with_limitations')
  })

  test('PARTIALLY_VERIFIED completes only with limitations', () => {
    expect(mapRiisheStatesToOutcome(['PARTIALLY_VERIFIED'], true).outcome).toBe('completed_with_limitations')
  })

  test('even with a passing state present, UNVERIFIED wins (never upgrade)', () => {
    const m = mapRiisheStatesToOutcome(['VERIFIED_FROM_SOURCES', 'UNVERIFIED'], true)
    expect(m.outcome).toBe('completed_with_limitations')
  })

  test('verified states map to completed', () => {
    for (const s of ['VERIFIED_FROM_SOURCES', 'COMPUTATION_VERIFIED', 'EXECUTION_VERIFIED']) {
      expect(mapRiisheStatesToOutcome([s], true).outcome).toBe('completed')
    }
  })

  test('empty states are honest limitations, not silent success', () => {
    expect(mapRiisheStatesToOutcome([], true).outcome).toBe('completed_with_limitations')
  })
})

describe('trust lifecycle — database-backed settles', () => {
  test('finalize REQUIRES a verification summary — the never-pretend rule', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await expect(
      finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'done', verificationSummary: '' }),
    ).rejects.toThrow(/verification summary/i)
    const settled = await finalizeTrustTask(t.id, {
      outcome: 'completed',
      outcomeSummary: 'Answer produced.',
      verificationSummary: 'Claim audit passed; citations resolved.',
    })
    expect(settled.status).toBe('completed')
  })

  test('failure without a truthful note is rejected', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await expect(failTrustTask(t.id, { failureNote: '' })).rejects.toThrow(/truthful failure note/i)
    const failed = await failTrustTask(t.id, { failureNote: 'BACKEND_TIMEOUT: the backend timed out.' })
    expect(failed.status).toBe('failed')
  })

  test('cancellation without a note is rejected; terminal rows are immutable', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await expect(cancelTrustTask(t.id, '')).rejects.toThrow(/cancellation requires/i)
    await cancelTrustTask(t.id, 'Owner cancelled the task.')
    await expect(cancelTrustTask(t.id, 'again')).rejects.toThrow(/already settled/i)
    await expect(
      finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' }),
    ).rejects.toThrow()
  })

  test('completed_with_limitations persists honest limitations', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await finalizeTrustTask(t.id, {
      outcome: 'completed_with_limitations',
      outcomeSummary: 'Answer produced; part unverified.',
      verificationSummary: 'Partial verification: 2 of 5 claims unsupported.',
      limitations: ['Research unavailable for one source.'],
    })
    const view = await getTrustTaskForOwner(t.id, 'u1')
    expect(view?.status).toBe('completed_with_limitations')
    expect(JSON.parse(view?.limitationsJson ?? '[]')).toEqual(['Research unavailable for one source.'])
  })

  test('step ledger never rewinds: done → running is rejected', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await planTrustSteps(t.id, [{ kind: 'retrieval', title: 'Research and retrieval' }])
    await updateTrustStepStatus(t.id, 1, 'running')
    await updateTrustStepStatus(t.id, 1, 'done')
    await expect(updateTrustStepStatus(t.id, 1, 'running')).rejects.toThrow(/cannot move/i)
  })

  test('steps cannot be mutated after the task is settled', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    await startTrustTask(t.id)
    await planTrustSteps(t.id, [{ kind: 'generation', title: 'Answer generation' }])
    await finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    await expect(updateTrustStepStatus(t.id, 1, 'running')).rejects.toThrow(/settled/i)
  })

  test('owner scoping: another user sees nothing (IDOR-safe)', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Turn' })
    expect(await getTrustTaskForOwner(t.id, 'other-user')).toBeNull()
    expect((await getTrustTaskForOwner(t.id, 'u1'))?.id).toBe(t.id)
  })
})
