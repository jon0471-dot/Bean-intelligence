import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { titleFromText } from '@/lib/laxii/chat'

const createSchema = z.object({
  title: z.string().min(1).max(120).optional(),
})

/**
 * LAXII — conversation list for the unified studio.
 *
 * CONVERSATION PERSISTENCE (acceptance §8): existing generation history is
 * preserved — a user with jobs but no conversations gets ONE "Earlier
 * generations" conversation backfilled from their real GenerationJob rows
 * (linked by id, chronological order). Job rows, artifact references and
 * storage paths are never rewritten; the messages only point at them, and
 * their state keeps rendering live.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const existing = await db.laxiiConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { _count: { select: { messages: true } } },
    })

    if (existing.length === 0) {
      const jobCount = await db.generationJob.count({ where: { userId: user.id, product: 'laxii' } })
      if (jobCount > 0) {
        const recent = await db.generationJob.findMany({
          where: { userId: user.id, product: 'laxii' },
          orderBy: { queuedAt: 'desc' },
          take: 30,
        })
        const seeded = await db.laxiiConversation.create({
          data: { userId: user.id, title: 'Earlier generations' },
        })
        // Chronological order: oldest first, so the thread reads like history.
        for (const job of [...recent].reverse()) {
          await db.laxiiMessage.create({
            data: {
              conversationId: seeded.id,
              role: 'assistant',
              kind: 'job',
              jobId: job.id,
              metaJson: JSON.stringify({ intent: 'history', task: job.task }),
            },
          })
        }
        await db.laxiiConversation.update({ where: { id: seeded.id }, data: { updatedAt: new Date() } })
        const withCount = { ...seeded, _count: { messages: recent.length } }
        return ok({ conversations: [serializeConversationRow(withCount)] })
      }
    }

    return ok({ conversations: existing.map(serializeConversationRow) })
  })
}

/** Start a fresh conversation (the studio's implicit "new chat"). */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)
    const conv = await db.laxiiConversation.create({
      data: { userId: user.id, title: body.title ? titleFromText(body.title) : 'New image conversation' },
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
