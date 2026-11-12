/**
 * BEAN Intelligence — LAXII conversation persistence tests.
 *
 * Pins the acceptance-§8 contract: existing generation history survives the
 * conversational redesign — a user with jobs but no conversations gets one
 * backfilled "Earlier generations" thread LINKED to their real job rows, and
 * conversation reads merge the live job state (status/progress/artifacts)
 * straight from GenerationJob on every load.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const USER = { id: 'user-1' }

let conversationRows: Array<Record<string, unknown>> = []
let messageRows: Array<Record<string, unknown>> = []
let jobRows: Array<Record<string, unknown>> = []

mock.module('@/lib/db', () => ({
  db: {
    laxiiConversation: {
      findMany: async () => conversationRows,
      findUnique: async ({ where }: { where: { id: string } }) =>
        conversationRows.find((c) => (c as { id: string }).id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `conv-${conversationRows.length + 1}`, updatedAt: new Date(), ...data }
        conversationRows.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = conversationRows.find((c) => (c as { id: string }).id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
      delete: async ({ where }: { where: { id: string } }) => {
        conversationRows = conversationRows.filter((c) => (c as { id: string }).id !== where.id)
        messageRows = messageRows.filter((m) => (m as { conversationId: string }).conversationId !== where.id)
        return { id: where.id }
      },
      count: async () => conversationRows.length,
      _count: undefined,
    },
    laxiiMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `msg-${messageRows.length + 1}`, createdAt: new Date(), ...data }
        messageRows.push(row)
        return row
      },
      findMany: async ({ where, orderBy }: { where?: { conversationId?: string }; orderBy?: { createdAt?: string } } = {}) => {
        let rows = messageRows
        if (where?.conversationId) rows = rows.filter((m) => (m as { conversationId: string }).conversationId === where.conversationId)
        if (orderBy?.createdAt === 'asc') rows = [...rows].sort((a, b) => (a as { createdAt: Date }).createdAt.getTime() - (b as { createdAt: Date }).createdAt.getTime())
        return rows
      },
      count: async () => messageRows.length,
    },
    generationJob: {
      count: async () => jobRows.length,
      findMany: async ({ where, orderBy, take }: { where?: { userId?: string; product?: string; id?: { in?: string[] } }; orderBy?: { queuedAt?: string }; take?: number } = {}) => {
        let rows = jobRows
        if (where?.userId) rows = rows.filter((j) => (j as { userId: string }).userId === where.userId)
        if (where?.id?.in) rows = rows.filter((j) => (where.id!.in as string[]).includes((j as { id: string }).id))
        if (orderBy?.queuedAt === 'desc') rows = [...rows].sort((a, b) => (b as { queuedAt: Date }).queuedAt.getTime() - (a as { queuedAt: Date }).queuedAt.getTime())
        return take ? rows.slice(0, take) : rows
      },
    },
  },
}))

mock.module('@/lib/auth/session', () => ({
  requireUser: async () => USER,
}))
mock.module('@/lib/laxii/assets', () => ({
  loadAsset: async () => ({ data: Buffer.alloc(4), mime: 'image/png', width: 8, height: 8, kind: 'original', url: '/x' }),
}))

const conversationsRoute = await import('../../src/app/api/laxii/conversations/route')
const detailRoute = await import('../../src/app/api/laxii/conversations/[id]/route')

beforeEach(() => {
  conversationRows = []
  messageRows = []
  jobRows = []
})

describe('history backfill (acceptance §8)', () => {
  test('a user with past jobs but no conversations gets ONE backfilled thread', async () => {
    const mk = (i: number) => ({
      id: `job-${i}`,
      userId: USER.id,
      product: 'laxii',
      task: 'image-generation',
      status: 'completed',
      paramsJson: '{}',
      resultJson: JSON.stringify({ imageUrl: '/api/laxii/assets/old' }),
      errorCode: null,
      errorMessage: null,
      queuedAt: new Date(Date.now() + i * 1000),
    })
    jobRows = [mk(1), mk(2), mk(3)]
    const res = await conversationsRoute.GET()
    const body = (await res.json()) as { conversations: Array<{ title: string }> }
    expect(body.conversations).toHaveLength(1)
    expect(body.conversations[0].title).toBe('Earlier generations')
    // Linked by id, chronological order — the newest job last.
    expect(messageRows).toHaveLength(3)
    expect((messageRows[0] as { jobId: string }).jobId).toBe('job-1')
    expect((messageRows[2] as { jobId: string }).jobId).toBe('job-3')
    // The second list call does NOT duplicate the backfill.
    await conversationsRoute.GET()
    expect(conversationRows).toHaveLength(1)
    expect(messageRows).toHaveLength(3)
  })

  test('a brand-new user gets an empty list (no phantom history)', async () => {
    const res = await conversationsRoute.GET()
    const body = (await res.json()) as { conversations: unknown[] }
    expect(body.conversations).toHaveLength(0)
  })

  test('explicit creation yields an empty conversation', async () => {
    const res = await conversationsRoute.POST(
      new Request('http://localhost:3000/api/laxii/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Poster campaign' }),
      }),
    )
    const body = (await res.json()) as { conversation: { title: string; messageCount: number } }
    expect(body.conversation.title).toBe('Poster campaign')
    expect(body.conversation.messageCount).toBe(0)
  })
})

describe('conversation detail merges LIVE job state', () => {
  test('a job message renders the current GenerationJob status and artifacts', async () => {
    conversationRows = [{ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() }]
    messageRows = [
      { id: 'm1', conversationId: 'conv-1', role: 'assistant', kind: 'job', jobId: 'job-1', assetId: null, maskAssetIds: null, metaJson: '{}', createdAt: new Date() },
    ]
    jobRows = [
      {
        id: 'job-1',
        task: 'image-editing',
        status: 'running',
        progress: 45,
        paramsJson: JSON.stringify({ mode: 'background-removal', assetId: 'a1' }),
        resultJson: null,
        errorCode: null,
        errorMessage: null,
        queuedAt: new Date(),
      },
    ]
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { messages: Array<{ job: { status: string; mode: string; progress: number } }> }
    expect(body.messages[0].job.status).toBe('running')
    expect(body.messages[0].job.mode).toBe('background-removal')
    expect(body.messages[0].job.progress).toBe(45)
  })

  test('failed jobs expose their genuine backend error to the reader', async () => {
    conversationRows = [{ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() }]
    messageRows = [
      { id: 'm1', conversationId: 'conv-1', role: 'assistant', kind: 'job', jobId: 'job-1', assetId: null, maskAssetIds: null, metaJson: '{}', createdAt: new Date() },
    ]
    jobRows = [
      {
        id: 'job-1',
        task: 'image-generation',
        status: 'failed',
        progress: 30,
        paramsJson: '{}',
        resultJson: null,
        errorCode: 'RATE_LIMITED',
        errorMessage: 'The image backend is rate-limited right now (HTTP 429).',
        queuedAt: new Date(),
      },
    ]
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { messages: Array<{ job: { status: string; errorCode: string | null; errorMessage: string | null; imageUrl: string | null } }> }
    expect(body.messages[0].job.status).toBe('failed')
    expect(body.messages[0].job.errorCode).toBe('RATE_LIMITED')
    expect(body.messages[0].job.errorMessage).toContain('429')
    expect(body.messages[0].job.imageUrl).toBeNull()
  })

  test('another user\u2019s conversation is not readable', async () => {
    conversationRows = [{ id: 'conv-1', userId: 'user-2', title: 't', updatedAt: new Date() }]
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    expect(res.status).toBe(404)
  })

  test('delete removes the thread but NOT the linked job rows', async () => {
    conversationRows = [{ id: 'conv-1', userId: USER.id, title: 't', updatedAt: new Date() }]
    messageRows = [
      { id: 'm1', conversationId: 'conv-1', role: 'assistant', kind: 'job', jobId: 'job-keep', assetId: null, maskAssetIds: null, metaJson: '{}', createdAt: new Date() },
    ]
    jobRows = [{ id: 'job-keep', userId: USER.id, product: 'laxii', task: 'image-generation', status: 'completed', paramsJson: '{}', resultJson: null, errorCode: null, errorMessage: null, queuedAt: new Date() }]
    const res = await detailRoute.DELETE(new Request('http://x'), { params: Promise.resolve({ id: 'conv-1' }) })
    const body = (await res.json()) as { deleted: boolean }
    expect(body.deleted).toBe(true)
    expect(conversationRows).toHaveLength(0)
    expect(jobRows).toHaveLength(1) // jobs are NEVER destroyed by a thread delete
  })
})
