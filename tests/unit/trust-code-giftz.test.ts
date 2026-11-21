/**
 * TRUST ENGINE — CODE GIFTZ adapter tests.
 *
 * Pinned behavior (Phase 1 Priority 2, "CODE GIFTZ adapter"):
 *  - every confirmed file operation produces an inspectable receipt with the
 *    plan, the actually-applied mutations, the executor's own verification
 *    result and the version/diff reference;
 *  - a task is NEVER settled as completed merely because files were written:
 *    the settlement carries the executor's actual verification result and an
 *    explicit "build/tests not run" limitation;
 *  - a replayed result says so (honest idempotent replay, not a new claim);
 *  - typed failures (STALE/CONFLICT/NOT_FOUND) state that the workspace was
 *    left unchanged;
 *  - verification failures settle as completed_with_limitations, never plain
 *    completed;
 *  - recording is best-effort and ownership comes from the caller's session.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const { createCodeGiftzFileOpRecorder } = await import('../../src/lib/trust/adapters/code-giftz')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
const { getTrustTaskForOwner } = await import('../../src/lib/trust/tasks')

beforeEach(() => {
  fake.reset()
})

const OWNER = 'user-owner'

function recorder(overrides: Partial<Parameters<typeof createCodeGiftzFileOpRecorder>[0]> = {}) {
  return createCodeGiftzFileOpRecorder({
    userId: OWNER,
    projectId: 'proj-1',
    projectName: 'Demo Project',
    opId: 'op-123',
    planHash: 'p'.repeat(64),
    kind: 'repair',
    requestPreview: 'Confirmed repair operation over 2 target(s) in the project workspace.',
    ...overrides,
  })
}

const GOOD_RESULT = {
  opId: 'op-123',
  kind: 'repair',
  applied: [
    { path: 'src/a.ts', action: 'repaired' },
    { path: 'src/b.ts', action: 'repaired' },
  ],
  failed: [],
  versionSeq: 7,
  verification: {
    contentsPreserved: true,
    remainingReferences: 0,
    detail: '2 repaired reference(s) now resolve to the moved file.',
  },
  replayed: false,
}

describe('code-giftz recorder — happy path', () => {
  test('executed result produces a full receipt with honest verification', async () => {
    const trust = recorder()
    await trust.begin()
    expect(trust.taskId).not.toBeNull()
    await trust.executed(GOOD_RESULT)

    const receipt = await composeTrustReceipt(trust.taskId!, OWNER)
    expect(receipt).not.toBeNull()
    expect(receipt!.task.product).toBe('code-giftz')
    expect(receipt!.task.kind).toBe('coding-task')
    expect(receipt!.task.projectId).toBe('proj-1')
    expect(receipt!.task.status).toBe('completed')
    expect(receipt!.task.verificationSummary).toContain('2 applied mutation(s)')
    expect(receipt!.task.verificationSummary).toContain('contentsPreserved=true')

    // planned vs attempted: all three steps attempted and done
    expect(receipt!.steps.map((s) => s.status)).toEqual(['done', 'done', 'done'])

    // evidence: applied files + the version/diff reference + the plan binding
    const refs = receipt!.evidence.map((e) => e.ref)
    expect(refs).toContain('code-file:src/a.ts')
    expect(refs).toContain('code-file:src/b.ts')
    expect(refs).toContain('code-project-version:proj-1#7')
    expect(refs).toContain('code-file-op:op-123')

    // the explicit "what was NOT verified" limitation is always present
    expect(receipt!.task.limitations.some((l) => l.includes('build and tests were not run'))).toBe(true)
    expect(receipt!.task.limitations.some((l) => l.includes('replayed'))).toBe(false)
  })

  test('failed mutations and broken verification settle with limitations — never plain completed', async () => {
    const trust = recorder()
    await trust.begin()
    await trust.executed({
      ...GOOD_RESULT,
      applied: [{ path: 'src/a.ts', action: 'repaired' }],
      failed: [{ path: 'src/missing.ts', message: 'no longer exists' }],
      verification: { contentsPreserved: false, remainingReferences: 1, detail: '1 reference still dangles.' },
    })
    const receipt = await composeTrustReceipt(trust.taskId!, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.steps[2].status).toBe('failed')
    expect(receipt!.task.limitations.some((l) => l.includes('Not applied: src/missing.ts'))).toBe(true)
    expect(receipt!.task.limitations.some((l) => l.includes('1 reference still dangles'))).toBe(true)
  })

  test('a replayed result is honestly labeled and settles with the replay limitation', async () => {
    const trust = recorder()
    await trust.begin()
    await trust.executed({ ...GOOD_RESULT, replayed: true })
    const receipt = await composeTrustReceipt(trust.taskId!, OWNER)
    expect(receipt!.task.verificationSummary).toContain('Replayed recorded result')
    expect(receipt!.task.limitations.some((l) => l.includes('replayed from the recorded operation ledger'))).toBe(true)
    expect(receipt!.task.outcomeSummary).toContain('replayed its recorded result; no new mutation was applied')
  })
})

describe('code-giftz recorder — truthful failures', () => {
  test('STALE refusal states the workspace was left unchanged', async () => {
    const trust = recorder()
    await trust.begin()
    await trust.failed({ code: 'STALE', message: 'src/a.ts changed since the repair was prepared — the plan was NOT applied.' })
    const receipt = await composeTrustReceipt(trust.taskId!, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('STALE')
    expect(receipt!.task.failureNote).toContain('the workspace was left unchanged')
    expect(receipt!.task.limitations.some((l) => l.includes('The workspace was not modified'))).toBe(true)
    // the modification step never ran
    expect(receipt!.steps[1].status).toBe('planned')
  })

  test('cancelled operations are settled as cancelled with the truthful note', async () => {
    const trust = recorder()
    await trust.begin()
    await trust.cancelled('Cancelled before execution by the user.')
    const receipt = await composeTrustReceipt(trust.taskId!, OWNER)
    expect(receipt!.task.status).toBe('cancelled')
    expect(receipt!.task.failureNote).toContain('Cancelled before execution')
  })

  test('begin is best-effort: executed/failed after a failed begin are no-ops, never throw', async () => {
    // simulate a db failure on task creation
    const original = fake.trustTask.create.bind(fake.trustTask)
    fake.trustTask.create = async (args: never) => {
      throw new Error('db down')
    }
    const trust = recorder()
    await trust.begin() // must not throw
    expect(trust.taskId).toBeNull()
    await trust.executed(GOOD_RESULT) // no-op, must not throw
    await trust.failed({ code: 'STALE', message: 'x' })
    fake.trustTask.create = original
  })
})

describe('code-giftz recorder — ledger shape', () => {
  test('the plan step carries the operation binding (opId + planHash)', async () => {
    const trust = recorder()
    await trust.begin()
    const view = await getTrustTaskForOwner(trust.taskId!, OWNER)
    const planStep = view!.steps.find((s) => s.seq === 1)!
    const detail = JSON.parse(planStep.detailJson as string) as Record<string, unknown>
    expect(detail.opId).toBe('op-123')
    expect(detail.planHash).toBe('p'.repeat(64))
    // no file content, no secrets in the ledger
    const allJson = JSON.stringify(view)
    expect(allJson).not.toContain('import ')
  })
})
