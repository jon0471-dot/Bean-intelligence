/**
 * BEAN Intelligence — LAXII deterministic UPSCALE regression test.
 *
 * Measured defect (2026-11-12, conversational acceptance step A5): an
 * enhancement job with options.upscaleFactor completed the actual Lanczos
 * upscale and THEN failed in finishWithArtifacts because the difference map
 * asserted same-geometry ("difference map: geometry mismatch (640x480 vs
 * 2560x1920)") — discarding a genuine result. The fix computes the diff map
 * against a geometry-matched baseline whenever the output legitimately
 * changed size. This test runs the REAL sharp/preservation pipeline against
 * mocked storage and pins: completed status, 4x output geometry, a
 * preservation report with dimensionsChanged, and a difference-map artifact.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import sharp from 'sharp'

let jobUpdates: Array<Record<string, unknown>> = []
let storedResults: Array<{ id: string; url: string; width: number; height: number; bytes: number }> = []

mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      findUnique: async () => ({ status: 'queued', cancelRequested: false }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        jobUpdates.push(data)
        return data
      },
    },
  },
}))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))
mock.module('@/lib/laxii/assets', () => ({
  loadAsset: async () => ({ data: Buffer.alloc(4), mime: 'image/png', width: 64, height: 48, kind: 'original', url: '/api/laxii/assets/src' }),
  readAssetBytes: async () =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 90, b: 60 } } })
      .jpeg()
      .toBuffer(),
  storeResultAsset: async (_userId: string, _kind: string, png: Buffer, width: number, height: number) => {
    const row = { id: `res-${storedResults.length + 1}`, url: `/api/laxii/assets/res-${storedResults.length + 1}`, width, height, bytes: png.length }
    storedResults.push(row)
    return row
  },
}))

const { processEnhancementJob } = await import('../../src/lib/laxii/jobs')

beforeEach(() => {
  jobUpdates = []
  storedResults = []
})

describe('deterministic upscale completes with a geometry-matched difference map', () => {
  test('4x upscale on a 64x48 source yields 256x192, completed, with report + diff', async () => {
    const job = {
      id: 'job-upscale-1',
      userId: 'user-1',
      status: 'queued',
      paramsJson: JSON.stringify({
        assetId: 'src',
        maskStrokes: [],
        faceZones: [],
        shaping: { expandPx: 0, featherPx: 4 },
        options: { denoise: true, exposureWhiteBalance: true, grade: true, localContrast: true, upscaleFactor: 4, allowGlobalColor: true },
        globalColor: true,
      }),
      resultJson: null,
    }
    await processEnhancementJob(job)
    const final = jobUpdates[jobUpdates.length - 1]
    expect(final.status).toBe('completed')
    const result = JSON.parse(final.resultJson as string) as {
      width: number
      height: number
      format: string
      report: { dimensionsChanged: boolean; summary: string }
      diffUrl: string | null
      imageUrl: string
    }
    expect(result.width).toBe(256)
    expect(result.height).toBe(192)
    expect(result.format).toBe('png')
    expect(result.report.dimensionsChanged).toBe(true)
    expect(result.report.summary).toContain('differ from the original')
    // BOTH artifacts exist: the result AND the difference map (previously the
    // job died before either was fully recorded).
    expect(result.imageUrl).toMatch(/^\/api\/laxii\/assets\//)
    expect(result.diffUrl).toMatch(/^\/api\/laxii\/assets\//)
    expect(storedResults).toHaveLength(2)
  })

  test('same-geometry enhancement keeps the exact original diff behavior', async () => {
    const job = {
      id: 'job-enhance-1',
      userId: 'user-1',
      status: 'queued',
      paramsJson: JSON.stringify({
        assetId: 'src',
        maskStrokes: [],
        faceZones: [],
        shaping: { expandPx: 0, featherPx: 4 },
        options: { denoise: true, exposureWhiteBalance: true, grade: true, localContrast: true },
        globalColor: true,
      }),
      resultJson: null,
    }
    await processEnhancementJob(job)
    const final = jobUpdates[jobUpdates.length - 1]
    expect(final.status).toBe('completed')
    const result = JSON.parse(final.resultJson as string) as { width: number; height: number; report: { dimensionsChanged: boolean } }
    expect(result.width).toBe(64)
    expect(result.height).toBe(48)
    expect(result.report.dimensionsChanged).toBe(false)
  })
})
