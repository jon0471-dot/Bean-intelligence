/**
 * BEAN Intelligence — LAXII conversational chat route tests.
 *
 * Pins the honest routing contract of POST /api/laxii/chat:
 *  - each classified request creates the SAME GenerationJob rows the product
 *    routes create (task, backendId, paramsJson shape) — no new pipeline;
 *  - capability words without an image produce a clarification, never a job;
 *  - follow-up messages pick up the conversation's latest image;
 *  - masked editing is refused honestly while the Diffusers worker is gated;
 *  - genuine backend failures surface verbatim in the conversation.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- mocked infrastructure -------------------------------------------------

const USER = { id: 'user-1' }

let conversationRow: Record<string, unknown> | null = null
let createdConversations: Array<Record<string, unknown>> = []
let createdMessages: Array<Record<string, unknown>> = []
let createdJobs: Array<Record<string, unknown>> = []
let jobRows: Array<Record<string, unknown>> = []
let assetKinds: Record<string, string> = {}
let workerEnabled = false

function cuid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

mock.module('@/lib/db', () => ({
  db: {
    laxiiConversation: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (conversationRow && (conversationRow as { id: string }).id === where.id) return conversationRow
        const found = createdConversations.find((c) => (c as { id: string }).id === where.id)
        return found ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('conv'), createdAt: new Date(), updatedAt: new Date(), ...data }
        createdConversations.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = createdConversations.find((c) => (c as { id: string }).id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
    },
    laxiiMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('msg'), createdAt: new Date(), ...data }
        createdMessages.push(row)
        return row
      },
      findMany: async () => createdMessages,
    },
    generationJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('job'), queuedAt: new Date(), progress: 0, ...data }
        createdJobs.push(row)
        jobRows.push(row)
        return row
      },
      findMany: async ({ where }: { where?: { id?: { in?: string[] } } } = {}) => {
        const ids = where?.id?.in
        return jobRows.filter((j) => !ids || ids.includes((j as { id: string }).id))
      },
    },
  },
}))

mock.module('@/lib/auth/session', () => ({
  requireUser: async () => USER,
}))
mock.module('@/lib/router/router', () => ({
  preflight: async () => ({ backend: { id: 'backend-mock' }, release: () => undefined }),
}))
mock.module('@/lib/jobs/queue', () => ({
  enqueueJob: () => undefined,
}))
mock.module('@/lib/ai-engine/queue', () => ({
  dedupeKeyFor: (...parts: unknown[]) => parts.map((p) => JSON.stringify(p)).join('|'),
  hasActiveDuplicate: async () => false,
}))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async () => undefined,
}))
mock.module('@/lib/laxii/assets', () => ({
  loadAsset: async (_userId: string, assetId: string) => {
    const kind = assetKinds[assetId] ?? 'original'
    return { data: Buffer.alloc(4), mime: 'image/png', width: 8, height: 8, kind, url: `/api/laxii/assets/${assetId}` }
  },
}))
mock.module('@/lib/laxii/provider', () => ({
  resolveProvider: () => 'hosted-edit',
}))
mock.module('@/lib/laxii/models', () => ({
  generativeWorkerStatus: () => ({ registryEnabled: workerEnabled, unavailableReason: workerEnabled ? null : 'hardware preflight' }),
}))

const { POST } = await import('../../src/app/api/laxii/chat/route')

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/laxii/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function lastJob(): Promise<Record<string, unknown> | undefined> {
  return createdJobs[createdJobs.length - 1]
}

beforeEach(() => {
  conversationRow = null
  createdConversations = []
  createdMessages = []
  createdJobs = []
  jobRows = []
  assetKinds = { 'asset-orig': 'original', 'asset-result': 'result', 'asset-mask': 'mask', 'asset-ref': 'reference' }
  workerEnabled = false
})

describe('generation through conversation', () => {
  test('plain description queues a REAL text-to-image job with the default preset', async () => {
    const res = await POST(jsonRequest({ text: 'Create a cinematic perfume advertisement.' }))
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> }
    const job = await lastJob()
    expect(job).toBeDefined()
    expect(job?.task).toBe('image-generation')
    expect(JSON.parse(job?.paramsJson as string)).toEqual({
      prompt: 'Create a cinematic perfume advertisement.',
      size: '1024x1024',
    })
    expect((job?.backendId as string)).toBe('backend-mock') // exactly what preflight authorized
    const assistant = body.messages[1] as { kind: string; jobId: string | null }
    expect(assistant.kind).toBe('job')
    expect(assistant.jobId).toBe((job as { id: string }).id)
  })

  test('typed aspect hints become preset params', async () => {
    await POST(jsonRequest({ text: 'Create a wide perfume banner in 16:9.' }))
    const job = await lastJob()
    expect(JSON.parse(job?.paramsJson as string)).toEqual({
      prompt: 'Create a wide perfume banner in 16:9.',
      size: '1344x768',
    })
  })

  test('composer sizeOverride supplies custom dimensions', async () => {
    await POST(jsonRequest({ text: 'Create a poster of a lighthouse.', sizeOverride: { width: 1920, height: 1080 } }))
    const job = await lastJob()
    expect(JSON.parse(job?.paramsJson as string)).toEqual({
      prompt: 'Create a poster of a lighthouse.',
      width: 1920,
      height: 1080,
    })
  })

  test('out-of-bounds sizeOverride is rejected before any job row exists', async () => {
    const res = await POST(jsonRequest({ text: 'Create a poster.', sizeOverride: { width: 8000, height: 600 } }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(createdJobs.length).toBe(0)
  })
})

describe('image-backed requests through conversation', () => {
  test('edit with an attached image queues the hosted conversational edit', async () => {
    await POST(jsonRequest({ text: 'Change the bottle cap to gold but preserve everything else.', assetId: 'asset-orig' }))
    const job = await lastJob()
    expect(job?.task).toBe('image-editing')
    expect(job?.backendId).toBe('bean-image-hosted-edit')
    expect(JSON.parse(job?.paramsJson as string)).toEqual({
      mode: 'conversational-edit',
      assetId: 'asset-orig',
      prompt: 'Change the bottle cap to gold but preserve everything else.',
    })
  })

  test('background removal queues the two-stage background-removal job', async () => {
    await POST(jsonRequest({ text: 'Remove the background and make it transparent.', assetId: 'asset-orig' }))
    const job = await lastJob()
    expect(job?.task).toBe('image-editing')
    expect(JSON.parse(job?.paramsJson as string)).toEqual({ mode: 'background-removal', assetId: 'asset-orig' })
  })

  test('enhance queues the deterministic engine with all steps enabled', async () => {
    await POST(jsonRequest({ text: 'Improve image sharpness, lighting and colors.', assetId: 'asset-orig' }))
    const job = await lastJob()
    expect(job?.task).toBe('image-enhancement')
    expect(job?.backendId).toBe('bean-image-local-sharp')
    const params = JSON.parse(job?.paramsJson as string) as { options: Record<string, unknown>; globalColor: boolean }
    expect(params.options.denoise).toBe(true)
    expect(params.options.exposureWhiteBalance).toBe(true)
    expect(params.options.upscaleFactor).toBeUndefined()
    expect(params.globalColor).toBe(true)
  })

  test('upscale queues the deterministic engine WITH the Lanczos factor', async () => {
    await POST(jsonRequest({ text: 'Upscale this image to 4K.', assetId: 'asset-result' }))
    const job = await lastJob()
    expect(job?.task).toBe('image-enhancement')
    const params = JSON.parse(job?.paramsJson as string) as { options: { upscaleFactor?: number } }
    expect(params.options.upscaleFactor).toBe(4)
  })

  test('follow-up edit references the conversation image without a new upload', async () => {
    // Seed: an earlier completed generation whose result lives at asset-orig.
    const completed = {
      id: 'job-earlier',
      task: 'image-generation',
      status: 'completed',
      paramsJson: JSON.stringify({ prompt: 'perfume', size: '1024x1024' }),
      resultJson: JSON.stringify({ assetUrl: '/api/laxii/assets/asset-orig', imageUrl: '/api/laxii/assets/asset-orig' }),
      errorCode: null,
      errorMessage: null,
      queuedAt: new Date(),
    }
    jobRows.push(completed)
    const conv = { id: 'conv-1', userId: USER.id, title: 't' }
    createdConversations.push(conv)
    createdMessages.push({
      id: 'm1',
      conversationId: 'conv-1',
      role: 'assistant',
      kind: 'job',
      jobId: 'job-earlier',
      assetId: null,
      maskAssetIds: null,
      metaJson: '{}',
      createdAt: new Date(),
    })
    await POST(jsonRequest({ conversationId: 'conv-1', text: 'Now change the bottle cap to gold.' }))
    const job = await lastJob()
    const params = JSON.parse(job?.paramsJson as string) as { mode: string; assetId: string }
    expect(params.mode).toBe('conversational-edit')
    expect(params.assetId).toBe('asset-orig')
  })
})

describe('honest conversational behavior', () => {
  test('capability words without an image produce a clarification, not a job', async () => {
    const res = await POST(jsonRequest({ text: 'Remove the background and make it transparent.' }))
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> }
    const assistant = body.messages[1] as { kind: string; text: string }
    expect(assistant.kind).toBe('clarify')
    expect(assistant.text).toMatch(/Which image/)
    expect(createdJobs.length).toBe(0)
  })

  test('masked editing is refused honestly while the worker is unavailable', async () => {
    const res = await POST(jsonRequest({ text: 'Remove only the object on the left.', assetId: 'asset-orig' }))
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> }
    const assistant = body.messages[1] as { kind: string; text: string; meta: Record<string, unknown> }
    expect(createdJobs.length).toBe(0)
    expect(assistant.meta.maskedEditUnavailable).toBe(true)
    expect(String(assistant.text)).toMatch(/Diffusers worker/)
    expect(String(assistant.text)).toMatch(/whole-image/)
  })

  test('when the worker IS available, masked editing asks for a painted region', async () => {
    workerEnabled = true
    const res = await POST(jsonRequest({ text: 'Remove only the object on the left.', assetId: 'asset-orig' }))
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> }
    const assistant = body.messages[1] as { kind: string; assetId: string | null; meta: Record<string, unknown> }
    expect(createdJobs.length).toBe(0) // the mask flow completes on the next turn
    expect(assistant.kind).toBe('mask-request')
    expect(assistant.assetId).toBe('asset-orig')
    expect(assistant.meta.maskMode).toBe('object-removal')
    expect(assistant.meta.workerAvailable).toBe(true)
  })

  test('a completed mask flow queues the object-removal job with mask strokes', async () => {
    workerEnabled = true
    await POST(jsonRequest({ text: 'Remove only the object on the left.', assetId: 'asset-orig', maskAssetIds: ['asset-mask'] }))
    const job = await lastJob()
    expect(job?.task).toBe('image-editing')
    const params = JSON.parse(job?.paramsJson as string) as { mode: string; maskStrokes: Array<{ assetId: string; kind: string }> }
    expect(params.mode).toBe('object-removal')
    expect(params.maskStrokes[0]).toEqual({ assetId: 'asset-mask', kind: 'edit' })
  })

  test('a genuine backend failure is surfaced verbatim, never dressed up', async () => {
    // Make the source asset a non-image kind — requireImageAsset rejects it.
    assetKinds['asset-broken'] = 'mask'
    const res = await POST(jsonRequest({ text: 'Enhance this image.', assetId: 'asset-broken' }))
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> }
    const assistant = body.messages[1] as { kind: string; text: string; meta: Record<string, unknown> }
    expect(createdJobs.length).toBe(0)
    expect(assistant.kind).toBe('text')
    expect(String(assistant.meta.errorCode)).toBe('VALIDATION_ERROR')
    expect(String(assistant.text)).toMatch(/editable image/)
  })

  test('empty request is rejected', async () => {
    const res = await POST(jsonRequest({ text: '' }))
    expect(res.status).toBe(400)
  })

  test('another user\u2019s conversation is NOT found (ownership enforced)', async () => {
    createdConversations.push({ id: 'conv-other', userId: 'user-2', title: 'x' })
    const res = await POST(jsonRequest({ conversationId: 'conv-other', text: 'hello there friend' }))
    expect(res.status).toBe(404)
  })
})
