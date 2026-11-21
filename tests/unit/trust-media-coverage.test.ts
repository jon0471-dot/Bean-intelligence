/**
 * TRUST SPECIALIST COVERAGE — media adapter extensions.
 *
 * Pinned (milestone contract):
 *  - image PROCESSING ops (enhancement / editing / background removal) settle
 *    receipts with their MEASURED preservation facts — checked facts, never
 *    an aesthetic-quality claim;
 *  - a processing result with NO recorded verification never settles as
 *    plain completed (explicit no-verification limitation);
 *  - identity-metric failure and dimension changes are honest limitations;
 *  - source + difference-map artifacts are recorded as evidence references;
 *  - settlement is idempotent per job (a replayed terminal event is a no-op).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const fake = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const {
  recordMediaJobCompletion,
  recordMediaJobFailure,
} = await import('../../src/lib/trust/adapters/media')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')

beforeEach(() => {
  fake.reset()
})

const OWNER = 'user-owner'

describe('media receipts — image processing (measured preservation)', () => {
  test('enhancement with preservation facts completes with a measurement, not a quality claim', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-enhancement', jobId: 'job-enh-1', backendId: 'be-1', requestPreview: 'sharpen the stars' },
      {
        artifactUrl: '/api/laxii/assets/asset-enh-1',
        assetId: 'asset-enh-1',
        width: 1024,
        height: 768,
        format: 'png',
        bytes: 500000,
        durationMs: 3400,
        preservation: {
          pipeline: 'deterministic-sharp',
          generativeUsed: false,
          exactPreservedPct: 96.4,
          changedPct: 3.6,
          dimensionsChanged: false,
          summary: '96.4% bit-exact original pixels preserved',
        },
        sourceUrl: '/api/laxii/assets/src-1',
        diffUrl: '/api/laxii/assets/diff-1',
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed')
    expect(receipt!.task.verificationSummary).toContain('exactPreservedPct=96.4')
    expect(receipt!.task.verificationSummary).toContain('not a claim that the edit is aesthetically correct')
    const refs = receipt!.evidence.map((e) => e.ref)
    expect(refs).toContain('/api/laxii/assets/src-1')
    expect(refs).toContain('/api/laxii/assets/diff-1')
    const measurement = receipt!.evidence.find((e) => e.kind === 'measurement')
    expect(measurement!.note).toContain('generativeUsed=false')
  })

  test('background removal records its measured cutout facts; dimension change is a limitation', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-editing', jobId: 'job-bg-1', requestPreview: 'background removal' },
      {
        artifactUrl: '/api/laxii/assets/asset-bg-1',
        width: 1312,
        height: 1312,
        format: 'png',
        preservation: {
          pipeline: 'two-stage-bg-removal',
          generativeUsed: true,
          dimensionsChanged: true,
          summary: 'Deterministic chroma-cutout passed its coverage gate',
        },
        mode: 'background-removal',
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.includes('changed the image dimensions'))).toBe(true)
    expect(receipt!.task.verificationSummary).toContain('two-stage-bg-removal')
  })

  test('a failed identity metric is never hidden', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-editing', jobId: 'job-ident-1', requestPreview: 'inpaint the wall' },
      {
        artifactUrl: '/api/laxii/assets/asset-ident-1',
        preservation: {
          pipeline: 'diffusers-worker:sd15-inpaint',
          generativeUsed: true,
          exactPreservedPct: 99.1,
          changedPct: 0.9,
          identityPassed: false,
          identityMetric: 'arcface',
        },
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.includes('identity metric ran and did NOT pass'))).toBe(true)
  })

  test('a processing artifact with NO recorded verification never settles as verified', async () => {
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-editing', jobId: 'job-conv-1', requestPreview: 'make it sunset' },
      {
        artifactUrl: '/api/laxii/assets/asset-conv-1',
        width: 1024,
        height: 1024,
        preservation: null,
        mode: 'conversational-edit',
      },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('completed_with_limitations')
    expect(receipt!.task.limitations.some((l) => l.includes('no bounded verification was recorded'))).toBe(true)
    const verStep = receipt!.steps.find((s) => s.kind === 'verification')!
    expect(verStep.status).toBe('skipped')
  })

  test('processing failure receipts carry the real class', async () => {
    await recordMediaJobFailure(
      { userId: OWNER, product: 'laxii', kind: 'image-editing', jobId: 'job-edit-fail', requestPreview: 'inpaint the wall', backendId: 'be-2' },
      { errorCode: 'BACKEND_TIMEOUT', errorClass: 'timeout', errorMessage: 'Generation exceeded the time limit and was stopped.' },
    )
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('BACKEND_TIMEOUT')
    expect(receipt!.task.limitations.some((l) => l.includes('No artifact was delivered'))).toBe(true)
  })

  test('idempotent settlement: a replayed completion after a failure receipt is a no-op', async () => {
    await recordMediaJobFailure(
      { userId: OWNER, product: 'laxii', kind: 'image-enhancement', jobId: 'job-idem-2', requestPreview: 'x' },
      { errorCode: 'BACKEND_FAILURE', errorMessage: 'failed' },
    )
    const countAfterFailure = fake.trustTask.rows.length
    await recordMediaJobCompletion(
      { userId: OWNER, product: 'laxii', kind: 'image-enhancement', jobId: 'job-idem-2', requestPreview: 'x' },
      { artifactUrl: '/late', preservation: { pipeline: 'x' } },
    )
    expect(fake.trustTask.rows.length).toBe(countAfterFailure)
    const receipt = await composeTrustReceipt(fake.trustTask.rows[0].id, OWNER)
    expect(receipt!.task.status).toBe('failed')
  })
})
