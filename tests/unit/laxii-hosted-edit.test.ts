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
  errorCode: string | null
  errorMessage: string | null
  backendId: string | null
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
    errorCode: null,
    errorMessage: null,
    backendId: null,
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
    // MEASURED gateway contract (2026-11-05): the edit field is `images`
    // (a string — arrays and the typings' singular `image` are rejected by
    // name); the value is the self-describing data URL. See
    // src/lib/adapters/hosted-image.ts for the full 10-shape evidence table.
    expect(state.editCalls[0].image).toBeUndefined()
    expect(state.editCalls[0].images).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`)
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

  test('a 429 during the job fails it with RATE_LIMITED and upstream evidence', async () => {
    const asset = await seedAsset()
    state.editImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob({ mode: 'conversational-edit', assetId: asset.id, prompt: 'make it night with rain' })
    await processEditJob(job)
    expect(job.status).toBe('failed')
    expect(job.errorCode).toBe('RATE_LIMITED')
    expect(job.errorMessage).toContain('rate-limited')
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
