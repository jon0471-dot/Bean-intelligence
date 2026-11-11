/**
 * LAXII hosted conversational-edit tests — REAL contract against the
 * scripted SDK boundary (mocks: z-ai-web-dev-sdk + the Prisma boundary).
 *
 * Pinned behavior:
 *  - editImage calls the gateway's images.edit endpoint with the user's
 *    image + prompt and validates the output by JPEG magic bytes;
 *  - an observed 429 opens the images-class breaker; while open, edits fail
 *    fast with zero network traffic (bounded backoff contract);
 *  - the conversational-edit JOB branch runs the hosted adapter (never the
 *    masked worker), stores the result as a real ImageAsset row and marks
 *    the job completed with honest provenance ("not pixel-preserving");
 *  - masked modes still refuse honestly while the Diffusers worker is
 *    disabled (preservation policy unchanged).
 */
import { describe, test, expect, beforeEach, afterAll, beforeAll, mock } from 'bun:test'
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const state = {
  editCalls: [] as Record<string, unknown>[],
  editImpl: ((body: Record<string, unknown>) => {
    throw new Error('editImpl not scripted')
  }) as (body: Record<string, unknown>) => unknown,
}

// A real 64x64 red JPEG (magic bytes validated downstream).
let JPEG: Buffer

const scriptedZai = {
  config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key-not-real' },
  images: {
    generations: {
      edit: async (body: Record<string, unknown>) => {
        state.editCalls.push(body)
        return state.editImpl(body)
      },
    },
  },
}
mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => scriptedZai } }))

// ---- in-memory Prisma fake --------------------------------------------------
const USER = 'laxii-edit-test-user'
const ASSET_ROOT = path.join(process.cwd(), 'storage', 'laxii', 'assets')

interface FakeAssetRow {
  id: string
  userId: string
  kind: string
  mime: string
  width: number | null
  height: number | null
  bytes: number
  metaJson: string | null
}
const assetRows = new Map<string, FakeAssetRow>()
interface FakeJob {
  id: string
  userId: string
  product: string
  task: string
  status: string
  progress: number
  paramsJson: string
  resultJson: string | null
  errorClass: string | null
  errorCode: string | null
  errorMessage: string | null
  backendId: string | null
  nextRunAt: Date | null
  finishedAt: Date | null
}
const jobRows = new Map<string, FakeJob>()
const usageRecords: Array<Record<string, unknown>> = []
let idCounter = 0

async function seedAsset(): Promise<FakeAssetRow> {
  idCounter += 1
  const row: FakeAssetRow = {
    id: `asset-${idCounter}`,
    userId: USER,
    kind: 'original',
    mime: 'image/png',
    width: 64,
    height: 64,
    bytes: 0,
    metaJson: JSON.stringify({ ext: 'png' }),
  }
  assetRows.set(row.id, row)
  mkdirSync(path.join(ASSET_ROOT, USER), { recursive: true })
  writeFileSync(path.join(ASSET_ROOT, USER, `${row.id}.png`), await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 40 } } }).png().toBuffer())
  return row
}

const fakeDb = {
  imageAsset: {
    findUnique: async ({ where }: { where: { id: string } }) => assetRows.get(where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      idCounter += 1
      const row = { ...(data as unknown as FakeAssetRow), id: `asset-${idCounter}` }
      assetRows.set(row.id, row)
      return row
    },
  },
  generationJob: {
    findUnique: async ({ where }: { where: { id: string } }) => jobRows.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeJob> }) => {
      const job = jobRows.get(where.id)
      if (!job) throw new Error('job not found')
      Object.assign(job, data)
      return job
    },
  },
  usageRecord: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRecords.push(data)
      return data
    },
  },
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

import { _resetUpstreamCooldownForTests, upstreamCoolingDown } from '../../src/lib/upstream/gateway'
import { hostedImageAdapter } from '../../src/lib/adapters/hosted-image'
import { IMAGE_MAX_GENERATION_ATTEMPTS } from '../../src/lib/jobs/image-worker'
import { processEditJob } from '../../src/lib/laxii/jobs'

afterAll(() => {
  rmSync(path.join(ASSET_ROOT, USER), { recursive: true, force: true })
})

beforeAll(async () => {
  JPEG = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg({ quality: 90 })
    .toBuffer()
})

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  state.editCalls = []
  state.editImpl = () => {
    throw new Error('editImpl not scripted')
  }
  usageRecords.length = 0
})

function makeJob(params: Record<string, unknown>): FakeJob {
  idCounter += 1
  const job: FakeJob = {
    id: `job-${idCounter}`,
    userId: USER,
    product: 'laxii',
    task: 'image-editing',
    status: 'queued',
    progress: 0,
    paramsJson: JSON.stringify(params),
    resultJson: null,
    errorClass: null,
    errorCode: null,
    errorMessage: null,
    backendId: null,
    nextRunAt: null,
    finishedAt: null,
  }
  jobRows.set(job.id, job)
  return job
}

describe('hosted editImage adapter contract', () => {
  test('success: image+prompt → validated JPEG output, breaker success noted', async () => {
    state.editImpl = () => ({ data: [{ base64: JPEG.toString('base64') }] })
    const res = await hostedImageAdapter.editImage!({
      prompt: 'replace the background with a dusk skyline',
      imageBase64: JPEG.toString('base64'),
      size: '1024x1024',
    })
    expect(state.editCalls).toHaveLength(1)
    expect(state.editCalls[0].prompt).toContain('dusk skyline')
    // OFFICIAL PROVIDER CONTRACT (2026-11-07 FIX): the edit body is
    // { prompt, images: [{ url: <data URL> }], size } — the shape published
    // in the provider's OWN documentation ("The images parameter must be an
    // array of objects with a url property, not a plain string"), matching
    // the validator's measured error text ("image_to_image task must provide
    // images"). The previously pinned SINGULAR `image` body (SDK 0.0.18
    // typings/CLI) is the shape that was MEASURED to fail with HTTP 400/1210
    // through the real job path.
    expect(state.editCalls[0].image).toBeUndefined()
    expect(state.editCalls[0].images).toEqual([
      { url: `data:image/jpeg;base64,${JPEG.toString('base64')}` },
    ])
    expect(state.editCalls[0].size).toBe('1024x1024')
    expect(res.format).toBe('jpeg')
    expect(res.bytes[0]).toBe(0xff)
    expect(res.bytes[1]).toBe(0xd8)
    expect(res.width).toBe(1024)
    expect(upstreamCoolingDown('images')).toBe(false)
  })

  test('unsupported size is rejected before any network call', async () => {
    await expect(
      hostedImageAdapter.editImage!({ prompt: 'x'.repeat(5), imageBase64: JPEG.toString('base64'), size: '123x456' }),
    ).rejects.toThrow(/Unsupported size/)
    expect(state.editCalls).toHaveLength(0)
  })

  test('an observed 429 opens the images breaker; the next edit fails fast with zero traffic', async () => {
    state.editImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    await expect(
      hostedImageAdapter.editImage!({ prompt: 'lighting change to golden hour', imageBase64: JPEG.toString('base64') }),
    ).rejects.toThrow(/rate-limited upstream/)
    expect(upstreamCoolingDown('images')).toBe(true)
    expect(state.editCalls).toHaveLength(1)
    await expect(
      hostedImageAdapter.editImage!({ prompt: 'second try lighting', imageBase64: JPEG.toString('base64') }),
    ).rejects.toThrow(/not attempted/)
    expect(state.editCalls).toHaveLength(1) // no second network call
  })

  test('a non-image payload never masquerades as a result', async () => {
    state.editImpl = () => ({ data: [{ base64: Buffer.alloc(64, 1).toString('base64') }] })
    await expect(
      hostedImageAdapter.editImage!({ prompt: 'add a neon sign', imageBase64: JPEG.toString('base64') }),
    ).rejects.toThrow(/not a valid image/)
  })
})

describe('conversational-edit job branch', () => {
  test('completes through the hosted adapter, stores a real result asset, honest provenance', async () => {
    const asset = await seedAsset()
    state.editImpl = () => ({ data: [{ base64: JPEG.toString('base64') }] })
    const job = makeJob({ mode: 'conversational-edit', assetId: asset.id, prompt: 'remove the parked car and change the sky to sunset' })
    await processEditJob(job)
    expect(job.status).toBe('completed')
    expect(job.backendId).toBe('bean-image-hosted-edit')
    const result = JSON.parse(job.resultJson!) as Record<string, unknown>
    expect(result.imageUrl).toMatch(/^\/api\/laxii\/assets\/asset-\d+$/)
    expect(result.format).toBe('png')
    const prov = result.provenance as Record<string, unknown>
    expect(prov.engine).toBe('hosted-edit')
    expect(prov.mode).toBe('conversational-edit')
    // The result asset really exists on disk with PNG bytes.
    const resultPath = path.join(ASSET_ROOT, USER, `${(result.imageUrl as string).split('/').pop()}.png`)
    expect(existsSync(resultPath)).toBe(true)
    expect(readFileSync(resultPath).subarray(1, 4).toString('ascii')).toBe('PNG')
    // Usage + honest attempt evidence.
    expect(usageRecords).toHaveLength(1)
    expect(usageRecords[0].success).toBe(true)
    expect(usageRecords[0].kind).toBe('image-editing')
  })

  test('CAPABILITY RECOVERY: a genuine 429 during the job PARKS it in retry_wait with honest throttle evidence', async () => {
    // The 2026-11-11 recovery contract (the T2I settleThrottledGeneration
    // pattern): a real provider 429 must not destroy an accepted job — it
    // parks in retry_wait with a breaker-aligned bounded backoff, persists
    // the throttle budget, and records genuine upstream evidence.
    const asset = await seedAsset()
    state.editImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob({ mode: 'conversational-edit', assetId: asset.id, prompt: 'make it night with rain' })
    await processEditJob(job)
    expect(job.status).toBe('retry_wait')
    expect(job.errorClass).toBe('rate_limited')
    expect(job.errorCode).toBe('RATE_LIMITED')
    expect(job.errorMessage).toContain('429')
    // The retry is scheduled in the future — never an immediate re-hit.
    expect(job.nextRunAt).not.toBeNull()
    expect(job.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 30_000)
    // The persisted budget: 1 real attempt consumed, breaker-aligned wait.
    const parked = JSON.parse(job.resultJson!) as { submissionAttempts: number; throttleWaitMs: number; throttle: { attempted: boolean } }
    expect(parked.submissionAttempts).toBe(1)
    expect(parked.throttleWaitMs).toBeGreaterThanOrEqual(60_000)
    expect(parked.throttle.attempted).toBe(true)
  })

  test('CAPABILITY RECOVERY: an exhausted throttle budget ends in an honest terminal failure', async () => {
    const asset = await seedAsset()
    state.editImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob({ mode: 'conversational-edit', assetId: asset.id, prompt: 'make it night with fog' })
    // The budget a restart-surviving parked job would carry: one attempt
    // left. The next real 429 consumes it and must fail the job honestly.
    job.resultJson = JSON.stringify({ submissionAttempts: IMAGE_MAX_GENERATION_ATTEMPTS - 1, throttleWaitMs: 0 })
    await processEditJob(job)
    expect(job.status).toBe('failed')
    expect(job.errorClass).toBe('rate_limited')
    expect(job.errorCode).toBe('RATE_LIMITED')
    expect(job.errorMessage).toContain('throttling')
    expect(job.errorMessage).toContain(String(IMAGE_MAX_GENERATION_ATTEMPTS))
  })

  test('a non-throttle upstream failure (timeout) fails terminally WITH its honest errorClass', async () => {
    const asset = await seedAsset()
    state.editImpl = () => {
      // classifyUpstreamError's timeout signature: no embedded HTTP status
      // + "timed out" → kind 'timeout' → honest persisted class.
      throw new Error('edit request timed out after 60s waiting for the gateway')
    }
    const job = makeJob({ mode: 'conversational-edit', assetId: asset.id, prompt: 'make it dusk' })
    await processEditJob(job)
    expect(job.status).toBe('failed')
    // CAPABILITY RECOVERY: the restart-proof chain now receives this
    // failure's class (the pre-fix rows carried errorClass null and were
    // invisible to the persisted evidence after a restart).
    expect(job.errorClass).toBe('timeout')
    expect(job.errorCode).toBe('BACKEND_FAILURE')
  })

  test('masked generative modes still refuse honestly while the worker is disabled', async () => {
    const asset = await seedAsset()
    const job = makeJob({
      mode: 'smart-edit',
      assetId: asset.id,
      maskStrokes: [{ assetId: 'mask-1', kind: 'edit' }],
      prompt: 'replace the jacket with a leather one',
    })
    await processEditJob(job)
    expect(job.status).toBe('failed')
    expect(job.errorCode).toBe('PROVIDER_UNAVAILABLE')
    expect(job.errorMessage).toContain('not operational')
  })
})
