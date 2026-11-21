/**
 * TRUST ENGINE — executor checkpoint resume tests.
 *
 * Pinned behavior (Phase 1 Priority 1, "Executor checkpoint resume"):
 *  - resume works ONLY from a valid persisted checkpoint (never invented);
 *  - only registered task kinds are resumable; the registry starts empty;
 *  - the step ledger is the authority — a checkpoint claiming steps the
 *    ledger does not show `done` is stale/corrupt and is rejected;
 *  - the checkpoint is consumed exactly once (atomic supersede) — a second
 *    resume is refused, so recovery can never replay twice;
 *  - an interrupted `running` step is never blindly re-run unless the kind
 *    explicitly declares retryRunningStep;
 *  - a pending approval is never bypassed and terminal rows are immutable;
 *  - the recovery is recorded in the append-only ledger and appears in the
 *    composed receipt;
 *  - ownership is enforced (a foreign user can neither plan nor resume).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const {
  registerResumableKind,
  describeResumeSupport,
  isKindResumable,
  writeResumeCheckpoint,
  planTrustResume,
  resumeTrustTask,
  TRUST_RESUME_CONTRACT,
} = await import('../../src/lib/trust/resume')
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
const { writeTrustCheckpoint, supersedeTrustCheckpoint } = await import('../../src/lib/trust/checkpoints')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
const { TrustStateError } = await import('../../src/lib/trust/types')

beforeEach(() => {
  fake.reset()
  registerResumableKind('resume-kind', { retryRunningStep: false })
  registerResumableKind('resume-idempotent-kind', { retryRunningStep: true })
})

const OWNER = 'user-owner'
const FOREIGN = 'user-foreign'

interface SetupOptions {
  kind?: string
  status?: 'planned' | 'running' | 'waiting_for_approval'
  steps?: number
  doneSteps?: number
  runningStep?: number
  checkpointThrough?: number
  checkpointNote?: string
}

async function setup(opts: SetupOptions = {}) {
  const kind = opts.kind ?? 'resume-kind'
  const stepCount = opts.steps ?? 4
  const task = await createTrustTask({
    userId: OWNER,
    product: 'riishe',
    kind,
    title: 'resume test task',
    requestPreview: 'request',
  })
  if (opts.status !== 'planned') {
    await startTrustTask(task.id)
    await planTrustSteps(task.id, Array.from({ length: stepCount }, (_, i) => ({
      kind: 'tool',
      title: `step ${i + 1}`,
    })))
    for (let i = 1; i <= (opts.doneSteps ?? 0); i++) {
      await updateTrustStepStatus(task.id, i, 'done')
    }
    if (opts.runningStep) await updateTrustStepStatus(task.id, opts.runningStep, 'running')
    if (opts.checkpointThrough !== undefined) {
      await writeResumeCheckpoint(task.id, {
        completedThroughSeq: opts.checkpointThrough,
        ...(opts.checkpointNote ? { note: opts.checkpointNote } : {}),
      })
    }
  }
  return task
}

describe('resume support registry — honesty from the start', () => {
  test('the registry only contains kinds that registered themselves', () => {
    const kinds = describeResumeSupport().map((k) => k.kind)
    expect(kinds).toContain('resume-kind')
    expect(kinds).toContain('resume-idempotent-kind')
    expect(isKindResumable('resume-kind')).toBe(true)
    expect(isKindResumable('image-generation')).toBe(false)
    expect(isKindResumable('coding-task')).toBe(false)
  })

  test('writing a checkpoint for an unregistered kind is refused', async () => {
    const task = await setup({ kind: 'video-generation', status: 'running', steps: 2, doneSteps: 1 })
    await expect(writeResumeCheckpoint(task.id, { completedThroughSeq: 1 })).rejects.toThrow(TrustStateError)
  })

  test('the checkpoint payload carries the contract, kind and seq — nothing else', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1, checkpointNote: 'after retrieval' })
    const rows = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id)
    const payload = JSON.parse(rows[0].payloadJson as string) as Record<string, unknown>
    expect(payload.contract).toBe(TRUST_RESUME_CONTRACT)
    expect(payload.resumableKind).toBe('resume-kind')
    expect(payload.completedThroughSeq).toBe(1)
    expect(payload.note).toBe('after retrieval')
    expect(Object.keys(payload).sort()).toEqual(['completedThroughSeq', 'contract', 'note', 'resumableKind'])
  })
})

describe('planTrustResume — read-only eligibility', () => {
  test('reports the plan without mutating anything', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    const plan = await planTrustResume(task.id, OWNER)
    expect(plan.taskId).toBe(task.id)
    expect(plan.completedThroughSeq).toBe(2)
    expect(plan.retryRunningStep).toBe(false)
    expect(plan.interruptedStepSeqs).toEqual([3])
    expect(plan.nextSeq).toBe(4) // hypothetical recovery step is 5; step 3 stays failed; 4 is first planned
    // nothing mutated: checkpoint still valid
    const valid = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id && r.status === 'valid')
    expect(valid.length).toBe(1)
    const running = fake.trustStep.rows.filter((r) => r.taskId === task.id && r.status === 'running')
    expect(running.length).toBe(1)
  })

  test('foreign user gets not_found (IDOR-safe)', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    await expect(planTrustResume(task.id, FOREIGN)).rejects.toMatchObject({ reason: 'not_found' })
  })

  test('terminal tasks are refused', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    await updateTrustStepStatus(task.id, 3, 'failed')
    await failTrustTask(task.id, { failureNote: 'boom' })
    await expect(planTrustResume(task.id, OWNER)).rejects.toMatchObject({ reason: 'already_settled' })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'already_settled' })
  })

  test('cancelled tasks are refused', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    await cancelTrustTask(task.id, 'user cancelled')
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'already_settled' })
  })

  test('a pending approval is never bypassed', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    const row = await dblike().trustTask.findUnique({ where: { id: task.id } })
    row!.status = 'waiting_for_approval'
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'waiting_for_approval' })
  })

  test('planned (never started) tasks are refused', async () => {
    const task = await setup({ status: 'planned' })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'not_started' })
  })

  test('unregistered kinds are honestly refused', async () => {
    const task = await setup({ kind: 'image-generation', doneSteps: 1 })
    // the checkpoint write for an unregistered kind is refused by design, so
    // a raw checkpoint row is injected to prove the RESUME path also refuses
    await writeTrustCheckpoint(task.id, {
      label: 'resume@step-1',
      payload: { contract: TRUST_RESUME_CONTRACT, resumableKind: 'image-generation', completedThroughSeq: 1 },
    })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'kind_not_resumable' })
    // nothing consumed
    const valid = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id && r.status === 'valid')
    expect(valid.length).toBe(1)
  })
})

// small helper to reach the mocked fake db (module idiom mirrors other tests)
import { db } from '../../src/lib/db'
function dblike() {
  return db as unknown as ReturnType<typeof createTrustFakeDb>['fakeDb']
}

describe('resumeTrustTask — validation before any mutation', () => {
  test('no checkpoint → refused, nothing recorded', async () => {
    const task = await setup({ doneSteps: 1, runningStep: 2 })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'no_valid_checkpoint' })
    const recovery = fake.trustStep.rows.filter((r) => r.taskId === task.id && r.kind === 'recovery')
    expect(recovery.length).toBe(0)
    const failed = fake.trustStep.rows.filter((r) => r.taskId === task.id && r.status === 'failed')
    expect(failed.length).toBe(0)
  })

  test('malformed payload → invalid_checkpoint', async () => {
    const task = await setup({ doneSteps: 1 })
    await writeTrustCheckpoint(task.id, { label: 'resume@step-1', payload: { hello: 'world' } })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'invalid_checkpoint' })
  })

  test('wrong contract → invalid_checkpoint', async () => {
    const task = await setup({ doneSteps: 1 })
    await writeTrustCheckpoint(task.id, {
      label: 'resume@step-1',
      payload: { contract: 'other-contract-v9', resumableKind: 'resume-kind', completedThroughSeq: 1 },
    })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'invalid_checkpoint' })
  })

  test('checkpoint written for another kind → invalid_checkpoint', async () => {
    const task = await setup({ doneSteps: 1 })
    await writeTrustCheckpoint(task.id, {
      label: 'resume@step-1',
      payload: { contract: TRUST_RESUME_CONTRACT, resumableKind: 'resume-idempotent-kind', completedThroughSeq: 1 },
    })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'invalid_checkpoint' })
  })

  test('out-of-bounds completedThroughSeq → invalid_checkpoint', async () => {
    const task = await setup({ doneSteps: 1 })
    await writeTrustCheckpoint(task.id, {
      label: 'resume@step-99999',
      payload: { contract: TRUST_RESUME_CONTRACT, resumableKind: 'resume-kind', completedThroughSeq: 99999 },
    })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'invalid_checkpoint' })
  })

  test('stale checkpoint claiming an un-done step → checkpoint_ledger_mismatch', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 2 }) // step 2 is planned, not done
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'checkpoint_ledger_mismatch' })
    // nothing consumed
    const valid = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id && r.status === 'valid')
    expect(valid.length).toBe(1)
  })

  test('corrupted payload JSON → invalid_checkpoint', async () => {
    const task = await setup({ doneSteps: 1 })
    await writeTrustCheckpoint(task.id, { label: 'resume@step-1', payload: { contract: TRUST_RESUME_CONTRACT, resumableKind: 'resume-kind', completedThroughSeq: 1 } })
    const row = fake.trustCheckpoint.rows.find((r) => r.taskId === task.id)!
    row.payloadJson = '{not json'
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'invalid_checkpoint' })
  })
})

describe('resumeTrustTask — the happy recovery path', () => {
  test('interrupted running step is failed, recovery recorded, plan returned', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    const plan = await resumeTrustTask(task.id, OWNER, { note: 'worker restart' })
    expect(plan.taskId).toBe(task.id)
    expect(plan.recoveryStepSeq).toBe(5) // after the 4 planned steps
    expect(plan.completedThroughSeq).toBe(2)
    expect(plan.nextSeq).toBe(4) // step 3 failed truthfully; 4 is the next planned
    expect(plan.interruptedStepSeqs).toEqual([3])
    expect(plan.retryRunningStep).toBe(false)
    expect(plan.checkpointSeq).toBe(1)

    // interrupted step truthfully failed with the honest note
    const step3 = fake.trustStep.rows.find((r) => r.taskId === task.id && r.seq === 3)!
    expect(step3.status).toBe('failed')
    expect(String(step3.errorNote)).toContain('did not re-run it')

    // recovery step recorded in the append-only ledger
    const rec = fake.trustStep.rows.find((r) => r.taskId === task.id && r.kind === 'recovery')!
    expect(rec.seq).toBe(5)
    expect(rec.status).toBe('done')
    const detail = JSON.parse(rec.detailJson as string) as Record<string, unknown>
    expect(detail.checkpointSeq).toBe(1)
    expect(detail.completedThroughSeq).toBe(2)
    expect(detail.interruptedStepSeqs).toEqual([3])
    expect(detail.retryRunningStep).toBe(false)
    expect(detail.note).toBe('worker restart')

    // checkpoint consumed exactly once
    const valid = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id && r.status === 'valid')
    expect(valid.length).toBe(0)
  })

  test('ledger-ahead-of-checkpoint is accepted (ledger is authority)', async () => {
    const task = await setup({ doneSteps: 3, checkpointThrough: 2 })
    const plan = await resumeTrustTask(task.id, OWNER)
    expect(plan.completedThroughSeq).toBe(3)
    expect(plan.nextSeq).toBe(4)
  })

  test('retryRunningStep kinds keep the interrupted step running', async () => {
    const task = await setup({ kind: 'resume-idempotent-kind', doneSteps: 1, runningStep: 2, checkpointThrough: 1 })
    const plan = await resumeTrustTask(task.id, OWNER)
    expect(plan.retryRunningStep).toBe(true)
    expect(plan.nextSeq).toBe(2)
    expect(plan.interruptedStepSeqs).toEqual([2])
    const step2 = fake.trustStep.rows.find((r) => r.taskId === task.id && r.seq === 2)!
    expect(step2.status).toBe('running') // executor re-runs it; idempotency declared
  })

  test('double resume is refused — recovery can never replay twice', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    await resumeTrustTask(task.id, OWNER)
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'no_valid_checkpoint' })
    const recoveries = fake.trustStep.rows.filter((r) => r.taskId === task.id && r.kind === 'recovery')
    expect(recoveries.length).toBe(1)
  })

  test('a pre-superseded checkpoint is refused (no valid row left)', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    const row = fake.trustCheckpoint.rows.find((r) => r.taskId === task.id)!
    await supersedeTrustCheckpoint(task.id, row.seq as number)
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'no_valid_checkpoint' })
  })

  test('a newer valid checkpoint wins (newest = resume point)', async () => {
    const task = await setup({ doneSteps: 2, checkpointThrough: 1 })
    await writeResumeCheckpoint(task.id, { completedThroughSeq: 2 })
    const plan = await resumeTrustTask(task.id, OWNER)
    expect(plan.checkpointSeq).toBe(2)
    expect(plan.completedThroughSeq).toBe(2)
  })

  test('resume then settle produces a receipt with the recovery step', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    const plan = await resumeTrustTask(task.id, OWNER)
    // executor continues: step 4 done, step 3 stays failed → honest partial
    await updateTrustStepStatus(task.id, 4, 'done')
    await finalizeTrustTask(task.id, {
      outcome: 'completed_with_limitations',
      outcomeSummary: 'Recovered from checkpoint #1; the interrupted step was not re-run.',
      verificationSummary: 'Steps 1-2 verified pre-interruption; step 3 failed interrupted and was not re-run; step 4 completed and verified after recovery.',
      limitations: ['Step 3 was interrupted and skipped; its work is missing from the result.'],
    })
    const receipt = await composeTrustReceipt(task.id, OWNER)
    expect(receipt).not.toBeNull()
    expect(receipt!.task.status).toBe('completed_with_limitations')
    const rec = receipt!.steps.find((s) => s.kind === 'recovery')
    expect(rec).toBeDefined()
    expect(rec!.status).toBe('done')
    expect((rec!.detail as Record<string, unknown>).checkpointSeq).toBe(1)
    const failed = receipt!.steps.find((s) => s.seq === 3)
    expect(failed!.status).toBe('failed')
    // checkpoints appear with their consumed status
    expect(receipt!.checkpoints.length).toBe(1)
    expect(receipt!.checkpoints[0].status).toBe('superseded')
  })

  test('foreign user cannot resume (ownership)', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    await expect(resumeTrustTask(task.id, FOREIGN)).rejects.toMatchObject({ reason: 'not_found' })
    const valid = fake.trustCheckpoint.rows.filter((r) => r.taskId === task.id && r.status === 'valid')
    expect(valid.length).toBe(1)
  })

  test('task that settled after the checkpoint (failed before resume) is refused', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    await failTrustTask(task.id, { failureNote: 'unrelated crash' })
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'already_settled' })
  })
})

describe('resume + waiting_for_approval interplay', () => {
  test('resume does not consume or alter approvals', async () => {
    const task = await setup({ doneSteps: 1, checkpointThrough: 1 })
    await db.trustApproval.create({
      data: {
        taskId: task.id,
        actionDigest: 'a'.repeat(64),
        actionJson: JSON.stringify({ type: 'external-action' }),
        summary: 'proposed action',
        status: 'requested',
      },
    })
    const row = await dblike().trustTask.findUnique({ where: { id: task.id } })
    row!.status = 'waiting_for_approval'
    await expect(resumeTrustTask(task.id, OWNER)).rejects.toMatchObject({ reason: 'waiting_for_approval' })
    const approvals = fake.trustApproval.rows.filter((r) => r.taskId === task.id)
    expect(approvals.length).toBe(1)
    expect(approvals[0].status).toBe('requested')
  })
})

describe('getTrustTaskForOwner exposes the resume material', () => {
  test('checkpoints and the recovery step are owner-visible', async () => {
    const task = await setup({ doneSteps: 2, runningStep: 3, checkpointThrough: 2 })
    await resumeTrustTask(task.id, OWNER)
    const view = await getTrustTaskForOwner(task.id, OWNER)
    expect(view).not.toBeNull()
    expect(view!.checkpoints.length).toBe(1)
    expect(view!.checkpoints[0].status).toBe('superseded')
    expect(view!.steps.some((s) => s.kind === 'recovery')).toBe(true)
  })
})
