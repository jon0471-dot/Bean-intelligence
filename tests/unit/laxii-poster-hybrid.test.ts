/**
 * POSTER-HOTFIX worker integration (2026-11-11): the FULL
 * processImageJob path against a mocked provider that reproduces the
 * MEASURED provider fault — HTTP 200 with
 * {"error":"Handler dispatch failed; nested exception is java.lang.StackOverflowError"}
 * for the exact BEAN INTELLIGENCE poster prompt. Verifies:
 *   attempt 1 → typed UPSTREAM_RESPONSE_INVALID → bounded transient parking;
 *   attempt 2 → terminal branch → ONE hybrid-typography attempt (text-free
 *   background + deterministic exact-wording composite + real OCR) completes
 *   the job with honest provenance.
 * Everything local (real sharp composite + real tesseract); no live quota.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import sharp from 'sharp'

const POSTER_PROMPT =
  "Create a premium technology advertisement poster for a brand called BEAN INTELLIGENCE. Display the exact headline 'INTELLIGENCE WITHOUT LIMITS' and the exact subtitle 'FOUR PRODUCTS. ONE INTELLIGENCE.' Use a sophisticated black and champagne-gold visual identity, realistic metallic typography, elegant futuristic composition, cinematic lighting, clean hierarchy, professional advertising design. All text must be spelled exactly as supplied. No additional words, no gibberish, no watermark."

/** Mock provider behavior knobs. */
let posterFault = true

/** Real JPEG the provider "returns" for the text-free background prompt. */
async function fakeProviderImage(w = 1024, h = 1024): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 16, g: 14, b: 18 } },
  })
    .jpeg()
    .toBuffer()
}

const jobUpdates: Array<Record<string, unknown>> = []
let currentJobRow: Record<string, unknown> = {}

mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        jobUpdates.push({ id: where.id, ...data })
        if (data.resultJson !== undefined) currentJobRow.resultJson = data.resultJson
        if (data.status !== undefined) currentJobRow.status = data.status
        return { id: where.id }
      },
    },
  },
}))
mock.module('@/lib/observability/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))
mock.module('@/lib/registry/backends', () => ({
  getBackend: () => ({ id: 'bean-image-hosted-primary', timeouts: { requestMs: 60_000 } }),
}))
mock.module('@/lib/laxii/assets', () => ({
  storeResultAsset: async () => ({ id: 'asset-test', url: '/api/laxii/assets/asset-test' }),
}))
mock.module('@/lib/intel/grounding', () => ({
  prepareImageIntelligence: async (prompt: string) => ({
    conditionedPrompt: prompt,
    mode: 'off',
    promptLanguage: 'en',
    knowledgeKeys: [],
    sceneSpec: null,
    evidence: [],
    degraded: [],
    conditioning: '',
    timing: {},
  }),
}))
mock.module('@/lib/intel/continuity', () => ({
  verifyGeneratedImage: async () => ({
    checked: false,
    method: 'unavailable',
    defects: [],
    observation: '',
    checkedAt: new Date().toISOString(),
    durationMs: 1,
    reason: 'mocked in test',
  }),
  imageBufferToDataUrl: (buf: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`,
}))
mock.module('@/lib/providers/account-quota', () => ({
  automatedQuotaState: async () => ({ used: 0, budget: null, reservedForUsers: 0, automatedAllowed: true }),
  automatedSkipReason: () => null,
}))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async () => undefined,
}))

// Mock the provider at the wire level: same contract the adapter uses.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!url.includes('/images/generations')) return realFetch(input as Parameters<typeof fetch>[0], init)
  const body = JSON.parse(String(init?.body)) as { prompt: string }
  if (body.prompt.includes('INTELLIGENCE WITHOUT LIMITS')) {
    // The MEASURED provider fault for the original poster prompt (live body
    // shape: error object with message — recorded in the audit trail).
    if (posterFault) {
      return new Response(
        JSON.stringify({
          error: { message: 'Handler dispatch failed; nested exception is java.lang.StackOverflowError' },
        }),
        { status: 200 },
      )
    }
  }
  // Any other prompt (the text-free background): a real image payload.
  const img = await fakeProviderImage()
  return new Response(JSON.stringify({ created: 1, data: [{ base64: img.toString('base64') }] }), { status: 200 })
}) as typeof fetch

const { processImageJob } = await import('../../src/lib/jobs/image-worker')

beforeEach(() => {
  jobUpdates.length = 0
  posterFault = true
  const g = globalThis as unknown as Record<string, unknown>
  ;(g['__bean_upstream_cooldown__'] as Map<string, unknown> | undefined)?.clear()
  g['__bean_real_attempt_store__'] = undefined
})

const JOB_ID = 'hotfix-test-job'

function freshRow(): Record<string, unknown> {
  return {
    id: JOB_ID,
    userId: 'user-test',
    product: 'laxii',
    task: 'image-generation',
    status: 'queued',
    paramsJson: JSON.stringify({ prompt: POSTER_PROMPT, size: '1024x1024' }),
    resultJson: null,
  }
}

describe('processImageJob — poster prompt against the measured provider fault', () => {
  test('attempt 1 parks the job transiently; attempt 2 recovers through hybrid typography', async () => {
    // ---- attempt 1: direct generation hits the StackOverflowError body ----
    currentJobRow = freshRow()
    await processImageJob(currentJobRow as never)
    const parked = jobUpdates.find((u) => u.status === 'retry_wait')
    expect(parked).toBeDefined()
    expect(parked!.errorCode).toBe('UPSTREAM_RESPONSE_INVALID')
    expect(parked!.errorClass).toBe('transient')
    const parkedState = JSON.parse(parked!.resultJson as string) as { transientRetries: number }
    expect(parkedState.transientRetries).toBe(1)

    // ---- attempt 2 (engine re-claim with the persisted state) ----
    jobUpdates.length = 0
    currentJobRow.status = 'retry_wait'
    await processImageJob(currentJobRow as never)
    const completed = jobUpdates.find((u) => u.status === 'completed')
    expect(completed).toBeDefined()
    const result = JSON.parse(completed!.resultJson as string) as {
      width: number
      height: number
      generation: { strategy: string; typography: string; directAttempt: string }
      verification: { textValidation: { method: string; found: string[]; missing: string[] } }
    }
    // exact dimensions + honest provenance
    expect(result.width).toBe(1024)
    expect(result.height).toBe(1024)
    expect(result.generation.strategy).toBe('hybrid-typography')
    expect(result.generation.typography).toMatch(/deterministic/)
    expect(result.generation.directAttempt).toMatch(/StackOverflowError/)
    // real OCR confirmed the exact wording on the final artifact
    expect(result.verification.textValidation.method).toBe('tesseract')
    expect(result.verification.textValidation.missing).toEqual([])
    expect(result.verification.textValidation.found).toContain('INTELLIGENCE WITHOUT LIMITS')
    expect(result.verification.textValidation.found).toContain('FOUR PRODUCTS. ONE INTELLIGENCE.')
  })

  test('with the fault cleared, the direct pipeline completes natively (no hybrid)', async () => {
    posterFault = false
    currentJobRow = freshRow()
    await processImageJob(currentJobRow as never)
    const completed = jobUpdates.find((u) => u.status === 'completed')
    expect(completed).toBeDefined()
    const result = JSON.parse(completed!.resultJson as string) as {
      generation: { strategy: string }
    }
    expect(result.generation.strategy).toBe('native')
  })

  test('non-text prompts are never hijacked by the hybrid path', async () => {
    currentJobRow = {
      ...freshRow(),
      paramsJson: JSON.stringify({ prompt: 'a serene mountain lake at golden hour, photorealistic', size: '1024x1024' }),
    }
    await processImageJob(currentJobRow as never)
    const completed = jobUpdates.find((u) => u.status === 'completed')
    expect(completed).toBeDefined()
    const result = JSON.parse(completed!.resultJson as string) as { generation: { strategy: string } }
    expect(result.generation.strategy).toBe('native')
  })
})
