import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { ensureVideoPoller } from '@/lib/jobs/video-worker'
import { jazmiiTitleFromText, normalizeJobStatus } from '@/lib/jazmii/chat'

const createSchema = z.object({
  title: z.string().min(1).max(120).optional(),
})

/**
 * JAZMII — conversation list for the unified studio.
 *
 * CONVERSATION PERSISTENCE: existing video generation history is preserved —
 * a user with video jobs but no conversations gets ONE "Earlier generations"
 * conversation backfilled from their real GenerationJob rows (linked by id,
 * chronological order). Job rows, media artifact paths and provider recovery
 * are never rewritten. Inflight jobs get their pollers re-attached here, so
 * background generation continues safely while the user navigates between
 * conversations.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const existing = await db.jazmiiConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { _count: { select: { messages: true } } },
    })

    if (existing.length === 0) {
      const jobCount = await db.generationJob.count({ where: { userId: user.id, product: 'jazmii' } })
      if (jobCount > 0) {
        const recent = await db.generationJob.findMany({
          where: { userId: user.id, product: 'jazmii' },
          orderBy: { queuedAt: 'desc' },
          take: 30,
        })
        const seeded = await db.jazmiiConversation.create({
          data: { userId: user.id, title: 'Earlier generations' },
        })
        // Chronological order: oldest first, so the thread reads like history.
        for (const job of [...recent].reverse()) {
          await db.jazmiiMessage.create({
            data: {
              conversationId: seeded.id,
              role: 'assistant',
              kind: 'job',
              jobId: job.id,
              metaJson: JSON.stringify({ intent: 'history', prompt: promptOf(job.paramsJson) }),
            },
          })
        }
        await db.jazmiiConversation.update({ where: { id: seeded.id }, data: { updatedAt: new Date() } })
        return ok({ conversations: [{ id: seeded.id, title: seeded.title, updatedAt: seeded.updatedAt.toISOString(), messageCount: recent.length }] })
      }
    }

    // Keep inflight background jobs tracking (restart/recovery parity with
    // the legacy GET /api/jazmii/generate path).
    const inflight = await db.generationJob.findMany({
      where: { userId: user.id, product: 'jazmii', status: { in: ['queued', 'running', 'starting', 'streaming', 'finalizing', 'retry_wait'] } },
      orderBy: { queuedAt: 'desc' },
      take: 20,
    })
    for (const j of inflight) {
      ensureVideoPoller({
        id: j.id,
        userId: j.userId,
        product: j.product,
        task: j.task,
        status: normalizeJobStatus(j.status),
        paramsJson: j.paramsJson,
        resultJson: j.resultJson,
      })
    }

    return ok({ conversations: existing.map(serializeConversationRow) })
  })
}

/** Start a fresh conversation ("New chat") — never touches old ones. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)
    const conv = await db.jazmiiConversation.create({
      data: { userId: user.id, title: body.title ? jazmiiTitleFromText(body.title) : 'New video conversation' },
    })
    return ok({ conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt.toISOString(), messageCount: 0 } }, { status: 201 })
  })
}

function serializeConversationRow(c: {
  id: string
  title: string
  updatedAt: Date
  _count?: { messages: number }
}) {
  return {
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count?.messages ?? 0,
  }
}

function promptOf(paramsJson: string): string {
  try {
    const p = JSON.parse(paramsJson) as { prompt?: unknown }
    return typeof p.prompt === 'string' ? p.prompt.slice(0, 200) : ''
  } catch {
    return ''
  }
}
