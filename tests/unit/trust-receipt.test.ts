/**
 * TRUST ENGINE — receipt composition tests.
 *
 * Pinned behavior (February 2027 brief §5, "Execution receipts"):
 *  - the receipt composes the REAL ledger (task + steps + evidence + approvals
 *    + checkpoints) — nothing is copied, so it cannot drift;
 *  - the sha-256 receiptDigest is deterministic for the same ledger state and
 *    changes when the ledger changes;
 *  - evidence separates extracted facts from model interpretation;
 *  - receipts are owner-scoped (IDOR-safe).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const { createTrustTask, startTrustTask, planTrustSteps, updateTrustStepStatus, addTrustEvidence, finalizeTrustTask } =
  await import('../../src/lib/trust/tasks')
const { requestTaskApproval, decideTaskApproval, resumeTaskAfterApprovals } = await import('../../src/lib/trust/approvals')
const { writeTrustCheckpoint } = await import('../../src/lib/trust/checkpoints')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')

beforeEach(() => {
  fake.reset()
})

async function seededTask() {
  const t = await createTrustTask({
    userId: 'u1',
    product: 'riishe',
    kind: 'chat',
    title: 'Research turn',
    requestPreview: 'What changed in the release?',
    requestChars: 31,
    jobId: 'job_1',
    conversationId: 'conv_1',
  })
  await startTrustTask(t.id)
  await planTrustSteps(t.id, [
    { kind: 'retrieval', title: 'Research and retrieval' },
    { kind: 'generation', title: 'Answer generation' },
  ])
  await updateTrustStepStatus(t.id, 1, 'running')
  await updateTrustStepStatus(t.id, 1, 'done')
  await addTrustEvidence(t.id, {
    kind: 'source',
    ref: 'https://example.com/release-notes',
    title: 'Release notes',
    note: 'snippet only',
    origin: 'extracted',
  })
  await addTrustEvidence(t.id, {
    kind: 'measurement',
    ref: 'token estimate',
    note: 'estimated from response length',
    origin: 'model_interpretation',
  })
  return t
}

describe('receipts — composition and digest', () => {
  test('a full task composes every ledger surface', async () => {
    const t = await seededTask()
    await updateTrustStepStatus(t.id, 2, 'running')
    await updateTrustStepStatus(t.id, 2, 'done')
    await finalizeTrustTask(t.id, {
      outcome: 'completed',
      outcomeSummary: 'Answer produced.',
      verificationSummary: 'Claim audit passed.',
    })
    const receipt = await composeTrustReceipt(t.id, 'u1')
    expect(receipt).not.toBeNull()
    expect(receipt?.task.status).toBe('completed')
    expect(receipt?.task.verificationSummary).toContain('Claim audit passed')
    expect(receipt?.task.requestPreview).toBe('What changed in the release?')
    expect(receipt?.counts).toEqual({ steps: 2, evidence: 2, approvals: 0, checkpoints: 0 })
    expect(receipt?.steps.map((s) => s.status)).toEqual(['done', 'done'])
    expect(receipt?.receiptDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('the digest is deterministic for the same ledger state', async () => {
    const t = await seededTask()
    await finalizeTrustTask(t.id, {
      outcome: 'completed',
      outcomeSummary: 'Answer produced.',
      verificationSummary: 'Claim audit passed.',
    })
    const r1 = await composeTrustReceipt(t.id, 'u1')
    const r2 = await composeTrustReceipt(t.id, 'u1')
    expect(r1?.receiptDigest).toBe(r2?.receiptDigest)
  })

  test('the digest covers evidence: a different ledger yields a different digest', async () => {
    const a = await seededTask()
    await finalizeTrustTask(a.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    const rA = await composeTrustReceipt(a.id, 'u1')

    const b = await seededTask()
    await addTrustEvidence(b.id, { kind: 'source', ref: 'https://example.com/other', origin: 'extracted' })
    await finalizeTrustTask(b.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    const rB = await composeTrustReceipt(b.id, 'u1')
    expect(rA?.receiptDigest).not.toBe(rB?.receiptDigest)
  })

  test('approvals and checkpoints appear with their decision state', async () => {
    const t = await seededTask()
    const approval = await requestTaskApproval(t.id, {
      action: { kind: 'file.delete', path: 'x' },
      summary: 'Delete x',
    })
    await decideTaskApproval(t.id, approval.id, 'grant')
    await writeTrustCheckpoint(t.id, { label: 'pre-delete', payload: { step: 2 } })
    await resumeTaskAfterApprovals(t.id)
    await finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    const receipt = await composeTrustReceipt(t.id, 'u1')
    expect(receipt?.approvals.length).toBe(1)
    expect(receipt?.approvals[0]?.status).toBe('granted')
    expect(receipt?.approvals[0]?.actionDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt?.checkpoints.length).toBe(1)
    expect(receipt?.checkpoints[0]?.label).toBe('pre-delete')
  })

  test('evidence origin stays separated: extracted vs model_interpretation', async () => {
    const t = await seededTask()
    await finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    const receipt = await composeTrustReceipt(t.id, 'u1')
    const origins = receipt?.evidence.map((e) => e.origin).sort()
    expect(origins).toEqual(['extracted', 'model_interpretation'])
  })

  test('receipts are owner-scoped (IDOR-safe)', async () => {
    const t = await seededTask()
    expect(await composeTrustReceipt(t.id, 'someone-else')).toBeNull()
    expect(await composeTrustReceipt(t.id, 'u1')).not.toBeNull()
  })

  test('receipt views expose only bounded, known fields (no free-form secret surface)', async () => {
    const t = await seededTask()
    await finalizeTrustTask(t.id, { outcome: 'completed', outcomeSummary: 'x', verificationSummary: 'y' })
    const receipt = await composeTrustReceipt(t.id, 'u1')
    const stepKeys = Object.keys(receipt?.steps[0] ?? {}).sort()
    expect(stepKeys).toEqual([
      'detail',
      'errorNote',
      'finishedAt',
      'kind',
      'seq',
      'startedAt',
      'status',
      'title',
    ])
  })
})

describe('receipts — checkpoints', () => {
  test('the newest valid checkpoint is the resume point; older ones are superseded', async () => {
    const t = await seededTask()
    await writeTrustCheckpoint(t.id, { label: 'cp1', payload: { at: 'stage1' } })
    await writeTrustCheckpoint(t.id, { label: 'cp2', payload: { at: 'stage2' } })
    const rows = await fake.trustCheckpoint.findMany({ where: { taskId: t.id }, orderBy: { seq: 'asc' } })
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'valid'])
    expect(rows.map((r) => r.seq)).toEqual([1, 2])
  })
})
