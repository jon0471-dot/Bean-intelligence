/**
 * BEAN Intelligence — JAZMII conversational studio tests (2026-11-12).
 *
 * Pins the unified-studio contract: the chat route submits jobs with the
 * EXACT generate-route semantics (same zod bounds, same paramsJson shape,
 * same preflight → dedupe guard → job row → enqueue → poller chain), every
 * job state is read back live from GenerationJob (never fabricated), and
 * existing video history is backfilled into a linked "Earlier generations"
 * thread without touching any job row.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import sharp from 'sharp'

const USER = { id: 'user-1' }

let createdConversations: Array<Record<string, unknown>> = []
let createdMessages: Array<Record<string, unknown>> = []
let createdJobs: Array<Record<string, unknown>> = []
let jobRows: Array<Record<string, unknown>> = []
let pollerCalls = 0

function cuid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

mock.module('@/lib/db', () => ({
  db: {
    jazmiiConversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        createdConversations.find((c) => (c as { id: string }).id === where.id) ?? null,
      findMany: async () => createdConversations,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('conv'), updatedAt: new Date(), ...data }
        createdConversations.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = createdConversations.find((c) => (c as { id: string }).id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
      delete: async ({ where }: { where: { id: string } }) => {
        createdConversations = createdConversations.filter((c) => (c as { id: string }).id !== where.id)
        createdMessages = createdMessages.filter((m) => (m as { conversationId: string }).conversationId !== where.id)
        return { id: where.id }
      },
      count: async () => createdConversations.length,
    },
    jazmiiMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('msg'), createdAt: new Date(), ...data }
        createdMessages.push(row)
        return row
      },
      findMany: async ({ where, orderBy }: { where?: { conversationId?: string }; orderBy?: { createdAt?: string } } = {}) => {
        let rows = createdMessages
        if (where?.conversationId) rows = rows.filter((m) => (m as { conversationId: string }).conversationId === where.conversationId)
        if (orderBy?.createdAt === 'asc') rows = [...rows].sort((a, b) => (a as { createdAt: Date }).createdAt.getTime() - (b as { createdAt: Date }).createdAt.getTime())
        return rows
      },
      count: async () => createdMessages.length,
    },
    generationJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: cuid('job'), queuedAt: new Date(), finishedAt: null, progress: 0, ...data }
        createdJobs.push(row)
        jobRows.push(row)
        return row
      },
      findMany: async ({ where, orderBy, take }: { where?: { id?: { in?: string[] }; status?: { in?: string[] } }; orderBy?: { queuedAt?: string }; take?: number } = {}) => {
        let rows = jobRows
        if (where?.id?.in) rows = rows.filter((j) => (where.id!.in as string[]).includes((j as { id: string }).id))
        if (orderBy?.queuedAt === 'desc') rows = [...rows].sort((a, b) => (b as { queuedAt: Date }).queuedAt.getTime() - (a as { queuedAt: Date }).queuedAt.getTime())
        return take ? rows.slice(0, take) : rows
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        jobRows.find((j) => (j as { id: string }).id === where.id) ?? null,
      count: async () => jobRows.length,
    },
  },
}))

mock.module('@/lib/auth/session', () => ({
  requireUser: async () => USER,
}))
mock.module('@/lib/router/router', () => ({
  preflight: async () => ({ backend: { id: 'bean-video-hosted-primary' }, release: () => undefined }),
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
mock.module('@/lib/jobs/video-worker', () => ({
  ensureVideoPoller: () => {
    pollerCalls += 1
  },
}))

const { POST: chatPost } = await import('../../src/app/api/jazmii/chat/route')
const conversationsRoute = await import('../../src/app/api/jazmii/conversations/route')
const detailRoute = await import('../../src/app/api/jazmii/conversations/[id]/route')

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  createdConversations = []
  createdMessages = []
  createdJobs = []
  jobRows = []
  pollerCalls = 0
})

describe('chat route: one turn → one REAL video job', () => {
  test('text-only prompt queues a video-generation job with the exact params shape', async () => {
    const res = await chatPost(
      jsonRequest('http://localhost:3000/api/jazmii/chat', {
        text: 'A golden perfume bottle rotating slowly on black silk.',
        settings: { size: '1280x720', durationSec: 5, quality: 'quality', withAudio: false },
      }),
    )
    const body = (await res.json()) as { conversation: { id: string }; messages: Array<Record<string, unknown>> }
    const job = createdJobs[createdJobs.length - 1]
    expect(job).toBeDefined()
    expect(job?.product).toBe('jazmii')
    expect(job?.task).toBe('video-generation')
    expect(job?.status).toBe('queued')
    expect(JSON.parse(job?.paramsJson as string)).toEqual({
      prompt: 'A golden perfume bottle rotating slowly on black silk.',
      quality: 'quality',
      withAudio: false,
      size: '1280x720',
      durationSec: 5,
    })
    // user + assistant messages persisted, assistant LINKS the job
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[1].kind).toBe('job')
    expect(body.messages[1].jobId).toBe((job as { id: string }).id)
    expect(pollerCalls).toBe(1) // the fresh job gets its poller immediately
    // conversation titled from the first prompt
    expect(createdConversations[0].title).toContain('perfume bottle')
  })

  test('image-to-video: reference image + settings ride into paramsJson verbatim', async () => {
    // LAXII-JAZMII RESTORATION (defect D3): the chat route now validates the
    // reference image server-side BEFORE queueing, so this fixture is a REAL
    // decodable still image (a truncated fake payload is rejected with 400 —
    // pinned by the next test). The measured validation summary rides into
    // paramsJson ADDITIVELY; the original reference string is untouched.
    const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 90, g: 140, b: 200 } } })
      .png()
      .toBuffer()
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    await chatPost(
      jsonRequest('http://localhost:3000/api/jazmii/chat', {
        text: 'Animate this scene with slow camera drift.',
        imageUrl: dataUrl,
        settings: { size: '720x1280', durationSec: 10, quality: 'speed', withAudio: true },
      }),
    )
    const job = createdJobs[createdJobs.length - 1]
    const params = JSON.parse(job?.paramsJson as string) as Record<string, unknown>
    expect(params.imageUrl).toBe(dataUrl)
    expect(params.size).toBe('720x1280')
    expect(params.durationSec).toBe(10)
    expect(params.quality).toBe('speed')
    expect(params.withAudio).toBe(true)
    const validation = params.imageValidation as Record<string, unknown>
    expect(validation).toMatchObject({ format: 'png', width: 256, height: 256 })
    const userMeta = JSON.parse((createdMessages[0].metaJson as string) ?? '{}') as Record<string, unknown>
    expect(userMeta.hasReferenceImage).toBe(true)
  })

  test('a non-decodable reference image is rejected BEFORE any job exists (defect D3)', async () => {
    const jobsBefore = createdJobs.length
    const res = await chatPost(
      jsonRequest('http://localhost:3000/api/jazmii/chat', {
        text: 'Animate this scene with slow camera drift.',
        // Syntactically valid data-URL shape, garbage image payload.
        imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { message?: string } }
    expect(body.error?.message).toContain('not a decodable image')
    expect(createdJobs.length).toBe(jobsBefore)
  })

  test('out-of-bounds settings are rejected BEFORE any job exists', async () => {
    const res = await chatPost(
      jsonRequest('http://localhost:3000/api/jazmii/chat', {
        text: 'A drone shot at sunset.',
        settings: { size: '4000x2000' },
      }),
    )
    expect(res.status).toBe(400)
    expect(createdJobs.length).toBe(0)
  })

  test('a too-short prompt is rejected before queueing', async () => {
    const res = await chatPost(jsonRequest('http://localhost:3000/api/jazmii/chat', { text: 'ab' }))
    expect(res.status).toBe(400)
    expect(createdJobs.length).toBe(0)
  })

  test('another user’s conversation is NOT found (ownership enforced)', async () => {
    createdConversations.push({ id: 'conv-other', userId: 'user-2', title: 'x', updatedAt: new Date() })
    const res = await chatPost(
      jsonRequest('http://localhost:3000/api/jazmii/chat', { conversationId: 'conv-other', text: 'a cinematic flyover' }),
    )
    expect(res.status).toBe(404)
  })
})

describe('conversation persistence (acceptance §4/§9)', () => {
  test('history backfill links existing video jobs without rewriting them', async () => {
    jobRows = [1, 2, 3].map((i) => ({
      id: `job-${i}`,
      userId: USER.id,
      product: 'jazmii',
      task: 'video-generation',
      status: 'completed',
      progress: 100,
      paramsJson: JSON.stringify({ prompt: `scene ${i}`, size: '1280x720' }),
      resultJson: JSON.stringify({ videoUrl: `/api/jazmii/jobs/job-${i}/media`, format: 'mp4', bytes: 1024 }),
      errorCode: null,
      errorMessage: null,
      queuedAt: new Date(Date.now() + i * 1000),
      finishedAt: new Date(),
    }))
    const res = await conversationsRoute.GET()
    const body = (await res.json()) as { conversations: Array<{ title: string }> }
    expect(body.conversations).toHaveLength(1)
    expect(body.conversations[0].title).toBe('Earlier generations')
    expect(createdMessages).toHaveLength(3)
    expect((createdMessages[0] as { jobId: string }).jobId).toBe('job-1')
    // second read does not duplicate the backfill
    await conversationsRoute.GET()
    expect(createdConversations).toHaveLength(1)
    expect(createdMessages).toHaveLength(3)
  })

  test('detail read merges LIVE job state (queued → videoUrl stays null)', async () => {
    createdConversations.push({ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() })
    createdMessages.push({
      id: 'm1',
      conversationId: 'conv-1',
      role: 'assistant',
      kind: 'job',
      jobId: 'job-1',
      metaJson: '{}',
      createdAt: new Date(),
    })
    jobRows = [
      {
        id: 'job-1',
        userId: USER.id,
        product: 'jazmii',
        task: 'video-generation',
        status: 'running',
        progress: 42,
        paramsJson: JSON.stringify({ prompt: 'p', size: '1280x720', durationSec: 5, withAudio: true }),
        resultJson: null,
        errorCode: null,
        errorMessage: null,
        queuedAt: new Date(),
        finishedAt: null,
      },
    ]
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { messages: Array<{ job: Record<string, unknown> }> }
    const job = body.messages[0].job
    expect(job.status).toBe('running')
    expect(job.progress).toBe(42)
    expect(job.videoUrl).toBeNull() // never fabricated
    expect(job.size).toBe('1280x720')
    expect(job.withAudio).toBe(true)
  })

  test('completed jobs expose the ffprobe-measured stream facts and media path', async () => {
    createdConversations.push({ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() })
    createdMessages.push({
      id: 'm1',
      conversationId: 'conv-1',
      role: 'assistant',
      kind: 'job',
      jobId: 'job-1',
      metaJson: '{}',
      createdAt: new Date(),
    })
    jobRows = [
      {
        id: 'job-1',
        userId: USER.id,
        product: 'jazmii',
        task: 'video-generation',
        status: 'completed',
        progress: 100,
        paramsJson: JSON.stringify({ prompt: 'p', size: '1280x720' }),
        resultJson: JSON.stringify({
          videoUrl: '/api/jazmii/jobs/job-1/media',
          format: 'mp4',
          bytes: 5_242_880,
          stream: { codec: 'h264', width: 1280, height: 720, durationSec: 5.0, fps: 24, validatedBy: 'ffprobe' },
          audio: { codec: 'aac' },
        }),
        errorCode: null,
        errorMessage: null,
        queuedAt: new Date(),
        finishedAt: new Date(),
      },
    ]
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { messages: Array<{ job: Record<string, unknown> }> }
    const job = body.messages[0].job
    expect(job.videoUrl).toBe('/api/jazmii/jobs/job-1/media')
    expect(job.width).toBe(1280)
    expect(job.height).toBe(720)
    expect(job.durationSec).toBe(5.0)
    expect(job.codec).toBe('h264')
    expect(job.hasAudio).toBe(true)
  })

  test('delete removes the thread but NOT the linked job rows', async () => {
    createdConversations.push({ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() })
    createdMessages.push({ id: 'm1', conversationId: 'conv-1', role: 'assistant', kind: 'job', jobId: 'job-keep', metaJson: '{}', createdAt: new Date() })
    jobRows = [{ id: 'job-keep', userId: USER.id, product: 'jazmii', task: 'video-generation', status: 'completed', progress: 100, paramsJson: '{}', resultJson: null, errorCode: null, errorMessage: null, queuedAt: new Date(), finishedAt: null }]
    const res = await detailRoute.DELETE(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { deleted: boolean }
    expect(body.deleted).toBe(true)
    expect(jobRows).toHaveLength(1)
  })

  test('rename updates the title (ownership enforced)', async () => {
    createdConversations.push({ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() })
    const res = await detailRoute.PATCH(
      jsonRequest('http://x', { title: 'Drone shots' }),
      { params: Promise.resolve({ id: 'conv-1' }) },
    )
    const body = (await res.json()) as { conversation: { title: string } }
    expect(body.conversation.title).toBe('Drone shots')
  })
})
