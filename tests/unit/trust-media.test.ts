/**
 * TRUST ENGINE — LAXII/JAZMII media adapter tests.
 *
 * Pinned behavior (Phase 1 Priority 4, "LAXII/JAZMII adapters"):
 *  - a generated file is NEVER labeled verified merely because it exists;
 *  - video receipts carry ffprobe-measured stream facts as REAL validation;
 *  - image receipts carry the product's bounded vision check — checked or
 *    honestly skipped, defects become limitations, never hidden;
 *  - missing validation → completed_with_limitations with an explicit
 *    "no quality claim" limitation;
 *  - failures state that nothing was delivered; cancellations are honest.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const {
  recordMediaJobCompletion,
  recordMediaJobFailure,
  recordMediaJobCancelled,
} = await import('../../src/lib/trust/adapters/media')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')

beforeEach(() => {
  fake.reset()
})

const OWNER = 'user-owner'

describe('media receipts — video (ffprobe-validated)', () => {
  test('ffprobe facts are recorded as real validation and the task completes', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'jazmii', kind: 'video-generation', jobId: 'job-v1', backendId: 'be-1', requestPreview: 'a calm ocean timelapse' },
      {
        artifactUrl: '/api/jazmii/jobs/job-v1/media',
        format: 'mp4',
        bytes: 1048576,
        durationMs: 42000,
        width: 720,
        height: 1280,
        stream: { codec: 'h264', width: 720, height: 1280, durationSec: 4.0, frames: 96, fps: 24, validatedBy: 'ffprobe' },
      },
    )
    const rows = fake.trustTask.rows
    expect(rows.length).toBe(1)
    const receipt = await composeTrustReceipt(rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed')
    expect(receipt!.task.verificationSummary).toContain('ffprobe')
    expect(receipt!.task.verificationSummary).toContain('codec=h264')
    const kinds = receipt!.evidence.map((e) => e.kind)
    expect(kinds).toContain('artifact')
    expect(kinds).toContain('measurement')
    expect(receipt!.task.limitations.length).toBe(0)
    expect(receipt!.task.jobId).toBe('job-v1')
  })

  test('a video without ffprobe facts is never claimed as verified', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'jazmii', kind: 'video-generation', jobId: 'job-v2', requestPreview: 'x' },
      { artifactUrl: '/api/jazmii/jobs/job-v2/media', format: 'mp4' },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.includes('no ffprobe stream validation'))).toBe(true)
    const verStep = receipt!.steps.find((s) => s.kind === 'verification')!
    expect(verStep.status).toBe('skipped')
  })
})

describe('media receipts — image (bounded vision check)', () => {
  test('checked report with defects settles with the defects as limitations', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-i1', requestPreview: 'portrait of a hiker' },
      {
        artifactUrl: '/api/laxii/images/job-i1',
        width: 1024,
        height: 1024,
        format: 'jpeg',
        bytes: 200000,
        verification: {
          checked: true,
          method: 'vision-intel',
          defects: [{ kind: 'anatomy', note: 'left hand' }],
          observation: 'one minor defect observed',
        },
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.verificationSummary).toContain('1 defect(s) reported')
    expect(receipt!.task.limitations.some((l) => l.includes('1 defect(s) on the delivered artifact'))).toBe(true)
  })

  test('checked clean report completes with the method named', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-i2', requestPreview: 'abstract gradient' },
      {
        artifactUrl: '/api/laxii/images/job-i2',
        verification: { checked: true, method: 'vision-intel', defects: [], observation: 'no defects' },
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed')
    expect(receipt!.task.verificationSummary).toContain('method=vision-intel')
    expect(receipt!.task.verificationSummary).toContain('0 defect(s) reported')
  })

  test('a skipped check is reported as exactly that — never a pass', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-i3', requestPreview: 'x' },
      {
        artifactUrl: '/api/laxii/images/job-i3',
        verification: { checked: false, method: 'vision-intel', defects: [], reason: 'checker unavailable' },
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.includes('vision check did not run'))).toBe(true)
    expect(receipt!.task.verificationSummary).toContain('did not run')
  })

  test('the targeted-correction outcome is recorded honestly (kept original)', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-i4', requestPreview: 'x' },
      {
        artifactUrl: '/api/laxii/images/job-i4',
        verification: {
          checked: true,
          method: 'vision-intel',
          defects: [{ kind: 'anatomy' }],
          correction: { attempted: true, applied: false, note: 'the ORIGINAL image was kept' },
        },
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.limitations.some((l) => l.includes('ORIGINAL image was kept'))).toBe(true)
  })
})

describe('media receipts — failures and cancellations', () => {
  test('failure states that nothing was delivered', async () => {
    await recordMediaJobFailure(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-f1', requestPreview: 'x' },
      { errorCode: 'RATE_LIMITED', errorMessage: 'the gateway kept throttling this generation', errorClass: 'rate_limited' },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('RATE_LIMITED')
    expect(receipt!.task.limitations.some((l) => l.includes('No artifact was delivered'))).toBe(true)
    const gen = receipt!.steps.find((s) => s.kind === 'generation')!
    expect(gen.status).toBe('failed')
  })

  test('cancellation carries the honest no-artifact note', async () => {
    await recordMediaJobCancelled(
      { userId: OWNER, product: 'jazmii', kind: 'video-generation', jobId: 'job-c1', requestPreview: 'x' },
      'before',
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('cancelled')
    expect(receipt!.task.failureNote).toContain('cancelled by the user before it completed')
    expect(receipt!.task.failureNote).toContain('no artifact was delivered')
  })

  test('every media receipt is owner-scoped; request preview is bounded owner data', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-generation', jobId: 'job-i5', requestPreview: 'portrait of a hiker at dawn' },
      { artifactUrl: '/api/laxii/images/job-i5', verification: { checked: false, reason: 'unavailable' } },
    )
    const foreign = await composeTrustReceipt(fake.trustTask.rows[0].id, 'user-foreign')
    expect(foreign).toBeNull()
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    // the bounded request preview is the owner's own data, deliberately
    // present; the ledger holds no backend credentials or key material
    expect(receipt!.task.requestPreview).toContain('portrait of a hiker')
    expect(JSON.stringify(receipt)).not.toContain('apiKey')
    expect(JSON.stringify(receipt)).not.toContain('Bearer ')
  })
})
