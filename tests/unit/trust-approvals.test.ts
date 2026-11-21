/**
 * TRUST ENGINE — scoped approvals tests.
 *
 * Pinned behavior (February 2027 brief §5, "Approval system"):
 *  - the sha-256 actionDigest binds the decision to the EXACT proposed action
 *    (canonical JSON — key order can never change the identity);
 *  - requesting an approval pauses the task in waiting_for_approval;
 *  - a grant is consumed ON USE and never carries over — approval for one
 *    action is never unlimited future permission (duplicate side effects are
 *    structurally prevented);
 *  - expired grants can never be consumed;
 *  - a task resumes only when no requested approvals remain.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const { actionDigestFor, canonicalJson } = await import('../../src/lib/trust/digest')
const { createTrustTask, startTrustTask } = await import('../../src/lib/trust/tasks')
const {
  requestTaskApproval,
  decideTaskApproval,
  consumeTaskApproval,
  resumeTaskAfterApprovals,
} = await import('../../src/lib/trust/approvals')

beforeEach(() => {
  fake.reset()
})

describe('approvals — action identity (pure)', () => {
  test('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })

  test('the same action always yields the same digest; a different action never does', () => {
    const action = { kind: 'file.delete', path: 'src/a.ts', version: 3 }
    const d1 = actionDigestFor(action)
    const d2 = actionDigestFor({ version: 3, path: 'src/a.ts', kind: 'file.delete' })
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
    expect(actionDigestFor({ kind: 'file.delete', path: 'src/b.ts', version: 3 })).not.toBe(d1)
  })

  test('nested structures and undefined fields canonicalize deterministically', () => {
    const a = actionDigestFor({ op: 'batch', files: ['a', 'b'], mode: undefined })
    const b = actionDigestFor({ files: ['a', 'b'], op: 'batch' })
    expect(a).toBe(b)
  })
})

describe('approvals — request / decide / consume lifecycle', () => {
  test('requesting an approval pauses the task in waiting_for_approval', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Change plan' })
    await startTrustTask(t.id)
    const approval = await requestTaskApproval(t.id, {
      action: { kind: 'file.delete', path: 'src/a.ts' },
      summary: 'Delete src/a.ts',
    })
    expect(approval.status).toBe('requested')
    expect(approval.scope).toBe('single')
    const stored = await fake.trustTask.findUnique({ where: { id: t.id } })
    expect(stored?.status).toBe('waiting_for_approval')
  })

  test('grant → consume-once: a second consumption is refused (duplicate side effects prevented)', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Change plan' })
    await startTrustTask(t.id)
    const approval = await requestTaskApproval(t.id, {
      action: { kind: 'file.delete', path: 'src/a.ts' },
      summary: 'Delete src/a.ts',
    })
    await decideTaskApproval(t.id, approval.id, 'grant')
    const first = await consumeTaskApproval(t.id, approval.id)
    expect(first).toEqual({ ok: true })
    const second = await consumeTaskApproval(t.id, approval.id)
    expect(second).toEqual({ ok: false, reason: 'already_consumed' })
  })

  test('a requested-but-undecided approval cannot be consumed', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Change plan' })
    await startTrustTask(t.id)
    const approval = await requestTaskApproval(t.id, { action: { kind: 'publish' }, summary: 'Publish' })
    const res = await consumeTaskApproval(t.id, approval.id)
    expect(res).toEqual({ ok: false, reason: 'not_granted' })
  })

  test('an expired grant can never be consumed and is marked expired', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Change plan' })
    await startTrustTask(t.id)
    const approval = await requestTaskApproval(t.id, {
      action: { kind: 'deploy' },
      summary: 'Deploy',
      ttlMs: 60_000,
    })
    await decideTaskApproval(t.id, approval.id, 'grant')
    // Force expiry in the ledger.
    await fake.trustApproval.updateMany({
      where: { id: approval.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await consumeTaskApproval(t.id, approval.id)
    expect(res).toEqual({ ok: false, reason: 'expired' })
    const row = await fake.trustApproval.findUnique({ where: { id: approval.id } })
    expect(row?.status).toBe('expired')
  })

  test('the digest recorded at request time matches a recomputation of the action', async () => {
    const action = { kind: 'file.rename', from: 'a.ts', to: 'b.ts' }
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Rename' })
    await startTrustTask(t.id)
    const approval = await requestTaskApproval(t.id, { action, summary: 'Rename a.ts to b.ts' })
    expect(approval.actionDigest).toBe(actionDigestFor(action))
  })

  test('denial keeps the task paused while other approvals remain requested', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'code-giftz', kind: 'coding-task', title: 'Plan' })
    await startTrustTask(t.id)
    const a1 = await requestTaskApproval(t.id, { action: { kind: 'op1' }, summary: 'Op 1' })
    const a2 = await requestTaskApproval(t.id, { action: { kind: 'op2' }, summary: 'Op 2' })
    await decideTaskApproval(t.id, a1.id, 'deny')
    let stored = await fake.trustTask.findUnique({ where: { id: t.id } })
    expect(stored?.status).toBe('waiting_for_approval')
    const resumed = await resumeTaskAfterApprovals(t.id)
    expect(resumed).toBe(false) // a2 still requested
    await decideTaskApproval(t.id, a2.id, 'grant')
    stored = await fake.trustTask.findUnique({ where: { id: t.id } })
    // decideTaskApproval(grant) does not auto-resume; the executor resumes.
    expect(stored?.status).toBe('waiting_for_approval')
    expect(await resumeTaskAfterApprovals(t.id)).toBe(true)
    stored = await fake.trustTask.findUnique({ where: { id: t.id } })
    expect(stored?.status).toBe('running')
  })

  test('approvals cannot be requested for terminal tasks', async () => {
    const t = await createTrustTask({ userId: 'u1', product: 'riishe', kind: 'chat', title: 'Done' })
    await startTrustTask(t.id)
    await fake.trustTask.updateMany({
      where: { id: t.id },
      data: { status: 'cancelled', completedAt: new Date(), cancelledAt: new Date() },
    })
    await expect(
      requestTaskApproval(t.id, { action: { kind: 'x' }, summary: 'X' }),
    ).rejects.toThrow(/cannot request approval/i)
  })
})
