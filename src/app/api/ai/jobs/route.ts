/**
 * BEAN Intelligence — UNIVERSAL BACKGROUND JOB API (Phase 3A).
 *
 * POST /api/ai/jobs   — submit a background job (returns a persistent job id
 *                       immediately; execution happens in workers).
 * GET  /api/ai/jobs   — the caller's job history (all products, newest first).
 *
 * Products keep their existing submission routes (LAXII/JAZMII POSTs and the
 * live RIISHE/CODE GIFTZ chat streams are unchanged); this API is the
 * unified surface for BACKGROUND execution — chat and coding jobs today,
 * every product's rows visible in one place.
 *
 * Security: session-authenticated, owner-scoped rows only, provider/model
 * identities never exposed, per-user active-job caps, duplicate-submission
 * guard, operator request budget enforced at routing.
 */

import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { hasActiveDuplicate, dedupeKeyFor } from '@/lib/ai-engine/queue'
import { engineConfig } from '@/lib/ai-engine/config'
import { ACTIVE_STATES, normalizeStatusForProduct } from '@/lib/ai-engine/types'
import { recordAudit } from '@/lib/observability/metering'
import { shouldCollapseDuplicateUserMessage } from '@/lib/giftz/retry'

const schema = z.discriminatedUnion('product', [
  z.object({
    product: z.literal('riishe'),
    message: z.string().min(1, 'Enter a message.').max(12_000),
    conversationId: z.string().min(1).optional(),
    documentIds: z.array(z.string().min(1)).max(3).optional(),
  }),
  z.object({
    product: z.literal('code-giftz'),
    message: z.string().min(1, 'Enter a request.').max(64_000),
    projectId: z.string().min(1).optional(),
    fileIds: z.array(z.string().min(1)).max(5).optional(),
  }),
])

type JobView = {
  id: string
  product: string
  task: string
  status: string
  legacyStatus: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  result: Record<string, unknown> | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
}

function viewJob(j: {
  id: string
  product: string
  task: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  resultJson: string | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}): JobView {
  return {
    id: j.id,
    product: j.product,
    task: j.task,
    status: j.status,
    legacyStatus: normalizeStatusForProduct(j.status),
    progress: j.progress,
    errorCode: j.errorCode,
    errorMessage: j.errorMessage,
    result: j.resultJson ? safeParse(j.resultJson) : null,
    queuedAt: j.queuedAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    if (body.product === 'riishe') {
      return submitRiishe(user.id, body)
    }
    return submitGiftz(user.id, body)
  })
}

async function submitRiishe(
  userId: string,
  body: { message: string; conversationId?: string; documentIds?: string[] },
) {
  // Routing rules 1–4 (availability, rate limit, quota, budget, concurrency
  // slot) — the slot releases immediately; the queue slot belongs to the worker.
  const { backend, release } = await preflight(userId, 'riishe', 'chat')
  release()

  let conversationId = body.conversationId
  if (conversationId) {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv || conv.userId !== userId) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
  } else {
    const conv = await db.conversation.create({
      data: { userId, title: body.message.slice(0, 60) },
    })
    conversationId = conv.id
  }

  // Duplicate-submission guard: identical active payload (same conversation)
  // is rejected with 409 instead of queueing a second identical turn.
  // Fresh submissions (no conversationId) share the '__new__' bucket so a
  // double-submit of the same message is caught before a second conversation
  // is created; identical repeats inside an existing conversation are keyed
  // per conversation.
  const dedupeKey = dedupeKeyFor(userId, 'riishe', 'chat', {
    conversationId: body.conversationId ?? '__new__',
    message: body.message,
    documentIds: body.documentIds ?? [],
  })
  if (await hasActiveDuplicate(dedupeKey)) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      'An identical background job is already queued or running.',
    )
  }

  // Per-user active cap for this product.
  const active = await db.generationJob.count({
    where: { userId, product: 'riishe', status: { in: [...ACTIVE_STATES] } },
  })
  if (active >= engineConfig().perUserActiveLimit) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      `You already have ${active} background jobs in progress for RIISHE. Wait for one to finish.`,
    )
  }

  const userMessage = await db.message.create({
    data: { conversationId, role: 'user', content: body.message },
  })

  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'riishe',
      task: 'chat',
      capability: 'chat',
      status: 'queued',
      backendId: backend.id,
      dedupeKey,
      paramsJson: JSON.stringify({
        message: body.message,
        conversationId,
        userMessageId: userMessage.id,
        documentIds: body.documentIds ?? [],
      }),
    },
  })

  await recordAudit({
    actorId: userId,
    action: 'ai.jobs.submit',
    target: job.id,
    meta: { product: 'riishe', task: 'chat', chars: body.message.length },
  })

  enqueueJob(job.id)

  return ok({ job: viewJob(job) }, { status: 202 })
}

async function submitGiftz(
  userId: string,
  body: { message: string; projectId?: string; fileIds?: string[] },
) {
  const { backend, release } = await preflight(userId, 'code-giftz', 'coding-task')
  release()

  let projectId = body.projectId
  if (projectId) {
    const project = await db.codeProject.findUnique({ where: { id: projectId } })
    if (!project || project.userId !== userId) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
  } else {
    const project = await db.codeProject.create({
      data: { userId, title: body.message.slice(0, 60) },
    })
    projectId = project.id
  }

  const dedupeKey = dedupeKeyFor(userId, 'code-giftz', 'coding-task', {
    projectId: body.projectId ?? '__new__',
    message: body.message,
    fileIds: body.fileIds ?? [],
  })
  if (await hasActiveDuplicate(dedupeKey)) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      'An identical background job is already queued or running.',
    )
  }

  const active = await db.generationJob.count({
    where: { userId, product: 'code-giftz', status: { in: [...ACTIVE_STATES] } },
  })
  if (active >= engineConfig().perUserActiveLimit) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      `You already have ${active} background jobs in progress for CODE GIFTZ. Wait for one to finish.`,
    )
  }

  // Retry idempotency mirrors the live route: a failed turn left a trailing
  // identical user row — collapse that ONE duplicate.
  const lastMessage = await db.codeMessage.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })
  const collapseDuplicate = shouldCollapseDuplicateUserMessage(lastMessage, body.message)

  const userMessage = collapseDuplicate
    ? null
    : await db.codeMessage.create({
        data: { projectId, role: 'user', content: body.message },
      })

  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'code-giftz',
      task: 'coding-task',
      capability: 'coding-task',
      status: 'queued',
      backendId: backend.id,
      dedupeKey,
      paramsJson: JSON.stringify({
        message: body.message,
        projectId,
        userMessageId: userMessage?.id ?? null,
        fileIds: body.fileIds ?? [],
      }),
    },
  })

  await recordAudit({
    actorId: userId,
    action: 'ai.jobs.submit',
    target: job.id,
    meta: { product: 'code-giftz', task: 'coding-task', chars: body.message.length },
  })

  enqueueJob(job.id)

  return ok({ job: viewJob(job) }, { status: 202 })
}

/** The caller's background-job history across products (newest first). */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const product = url.searchParams.get('product')
    const status = url.searchParams.get('status')
    const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? 40) || 40, 1), 100)

    const jobs = await db.generationJob.findMany({
      where: {
        userId: user.id,
        // Only engine-managed products are listed; GANGZII keeps its own surface.
        product: { in: ['riishe', 'laxii', 'jazmii', 'code-giftz'] },
        ...(product ? { product } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { queuedAt: 'desc' },
      take,
    })
    return ok({ jobs: jobs.map(viewJob) })
  })
}
