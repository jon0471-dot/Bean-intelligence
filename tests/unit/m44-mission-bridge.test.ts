/**
 * M44 Phase 7 — the mission bridge (all-product integration surface).
 *
 * Covers: deterministic task contract stamps, honest verdict mapping
 * (executing/skipped carry NO invented verdict), bounded note rendering,
 * and the Trust-ledger write path through the REAL addTrustEvidence
 * validation (active task required, bounded ledger, honest refusal shape)
 * over the repo's trust fake-db idiom.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const { buildTaskSpec } = await import('../../src/lib/riishe/mission/types')
const {
  m44VerificationVerdict,
  recordM44TaskEvidence,
  renderM44TaskNote,
  taskContractStamp,
} = await import('../../src/lib/riishe/mission/mission-bridge')

beforeEach(() => {
  fake.reset()
})

function researchSpec() {
  return buildTaskSpec({
    id: 'research',
    kind: 'research',
    title: 'Gather cited evidence',
    objective: 'Research the topic with live retrieval and collect real attributable sources for the migration plan.',
    expectedOutput: 'A research pack of at least three real sources (title + URL each).',
    verification: { minSources: 3 },
  })
}

describe('m44 bridge: stamps, verdicts and notes', () => {
  test('the contract stamp is deterministic and content-sensitive', () => {
    const spec = researchSpec()
    const s1 = taskContractStamp('Research and write the migration report', spec)
    const s2 = taskContractStamp('Research and write the migration report', spec)
    const s3 = taskContractStamp('Research and write a DIFFERENT report', spec)
    expect(s1).toBe(s2)
    expect(s1).not.toBe(s3)
    expect(s1).toMatch(/^[a-f0-9]{32}$/)
  })

  test('verdict mapping never invents a verdict for pending phases', () => {
    expect(m44VerificationVerdict('verified')).toBe('confirmed')
    expect(m44VerificationVerdict('failed')).toBe('failed')
    expect(m44VerificationVerdict('executing')).toBeNull()
    expect(m44VerificationVerdict('skipped')).toBeNull()
  })

  test('note rendering is bounded and honest', () => {
    const note = renderM44TaskNote({
      planVersion: 'a'.repeat(32),
      kind: 'research',
      taskId: 'research',
      phase: 'verified',
      actionType: 'research-fetch',
      riskClass: 'read-only',
      idempotencyKey: 'mission:abc123:research',
      executorNote: '3 distinct sources observed',
    })
    expect(note).toContain('verdict=confirmed')
    expect(note).toContain('research→research-fetch')
    expect(note).toContain('risk=read-only')
    expect(note.length).toBeLessThanOrEqual(390)
  })
})

describe('m44 bridge: the Trust-ledger write path', () => {
  test('writes a measurement row through the REAL addTrustEvidence validation', async () => {
    const { createTrustTask, startTrustTask } = await import('../../src/lib/trust/tasks')
    const created = await createTrustTask({ userId: 'user-m44', product: 'riishe', kind: 'mission', title: 'Mission trust task', requestPreview: 'Research the migration topic' })
    await startTrustTask(created.id)
    await recordM44TaskEvidence(
      { id: 'mission-1', trustTaskId: created.id, objective: 'Research and write the migration report' },
      { taskId: 'research', kind: 'research', title: 'Gather cited evidence', objective: researchSpec().objective },
      researchSpec(),
      'verified',
      '3 distinct sources observed',
    )
    const rows = fake.trustEvidence.rows.filter((r) => r.taskId === created.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('measurement')
    expect(String(rows[0].note)).toContain('verdict=confirmed')
    expect(String(rows[0].ref)).toMatch(/^m44:mission-1:research/)
  })

  test('a settled trust task refuses the write without breaking the caller', async () => {
    const { createTrustTask, startTrustTask, finalizeTrustTask } = await import('../../src/lib/trust/tasks')
    const created = await createTrustTask({ userId: 'user-m44', product: 'riishe', kind: 'mission', title: 'Settled mission task', requestPreview: 'Research the migration topic' })
    await startTrustTask(created.id)
    await finalizeTrustTask(created.id, { outcome: 'completed', outcomeSummary: 'settled before the bridge ran', verificationSummary: 'verifier confirmed the deliverable before settle' })
    // Must NOT throw — the bridge is additive provenance only.
    await expect(
      recordM44TaskEvidence(
        { id: 'mission-2', trustTaskId: created.id, objective: 'Research the topic' },
        { taskId: 'research', kind: 'research', title: 'Gather cited evidence', objective: researchSpec().objective },
        researchSpec(),
        'verified',
      ),
    ).resolves.toBeUndefined()
    expect(fake.trustEvidence.rows.filter((r) => r.taskId === created.id)).toHaveLength(0)
  })

  test('a null trustTaskId writes nothing and resolves cleanly', async () => {
    await expect(
      recordM44TaskEvidence(
        { id: 'mission-3', trustTaskId: null, objective: 'Research the topic' },
        { taskId: 'research', kind: 'research', title: 'Gather cited evidence', objective: researchSpec().objective },
        researchSpec(),
        'executing',
      ),
    ).resolves.toBeUndefined()
    expect(fake.trustEvidence.rows).toHaveLength(0)
  })
})
