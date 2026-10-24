import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { withTimeout } from '@/lib/adapters/hosted-llm'
import { recordUsage } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'

const schema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1, 'Enter a message.').max(12000),
})

const SYSTEM_PROMPT =
  'You are RIISHE, the conversational AI of BEAN Intelligence. Be accurate, helpful and professional. ' +
  'For coding questions you may include code in fenced blocks. If you are unsure about a fact, say so ' +
  'instead of inventing one. Never claim capabilities you do not have.'

/**
 * RIISHE conversational endpoint. SSE streaming when the client asks,
 * JSON otherwise. Every request passes the same preflight: auth,
 * availability, rate limits, quotas, concurrency, capability validation.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, adapter, release } = await preflight(user.id, 'riishe', 'chat')
    if (!adapter.chat || !adapter.chatStream) {
      release()
      throw new BeanApiError('NO_BACKEND', 'The chat backend is missing its adapter.')
    }

    // Resolve or create the conversation (ownership enforced).
    let conversationId = body.conversationId
    if (conversationId) {
      const conv = await db.conversation.findUnique({ where: { id: conversationId } })
      if (!conv || conv.userId !== user.id) {
        release()
        throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
      }
    } else {
      const conv = await db.conversation.create({
        data: { userId: user.id, title: body.message.slice(0, 60) },
      })
      conversationId = conv.id
    }

    const caps = assertChatRequest(backend, [{ role: 'user', content: body.message }])
    const priorMessages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: caps.maxHistoryMessages,
    })

    const chatMessages = [
      { role: 'assistant' as const, content: SYSTEM_PROMPT },
      ...priorMessages.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      { role: 'user' as const, content: body.message },
    ]

    await db.message.create({
      data: { conversationId, role: 'user', content: body.message },
    })

    const wantsStream = new URL(request.url).searchParams.get('stream') === '1'

    if (!wantsStream) {
      try {
        const result = await withTimeout(
          adapter.chat({
            messages: chatMessages,
            maxPromptChars: caps.maxPromptChars,
            maxHistoryMessages: caps.maxHistoryMessages,
            timeoutMs: backend.timeouts.requestMs,
          }),
          backend.timeouts.requestMs,
          'RIISHE',
        )
        await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: result.content,
            tokensEstIn: result.tokensInEst,
            tokensEstOut: result.tokensOutEst,
            latencyMs: result.durationMs,
          },
        })
        await recordUsage({
          userId: user.id,
          product: 'riishe',
          backendId: backend.id,
          kind: 'chat',
          tokensIn: result.tokensInEst,
          tokensOut: result.tokensOutEst,
          durationMs: result.durationMs,
          success: true,
        })
        return ok({ conversationId, content: result.content, durationMs: result.durationMs })
      } finally {
        release()
      }
    }

    // ---- SSE streaming path ----------------------------------------------
    const convId = conversationId
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let full = ''
        const t0 = Date.now()
        let succeeded = false
        try {
          for await (const delta of adapter.chatStream!({
            messages: chatMessages,
            maxPromptChars: caps.maxPromptChars,
            maxHistoryMessages: caps.maxHistoryMessages,
            timeoutMs: backend.timeouts.requestMs,
          })) {
            full += delta
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta, conversationId: convId })}\n\n`),
            )
          }
          succeeded = full.length > 0
          if (succeeded) {
            await db.message.create({
              data: {
                conversationId: convId,
                role: 'assistant',
                content: full,
                tokensEstIn: Math.ceil(body.message.length / 4),
                tokensEstOut: Math.ceil(full.length / 4),
                latencyMs: Date.now() - t0,
              },
            })
          }
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: backend.id,
            kind: 'chat',
            tokensIn: Math.ceil(body.message.length / 4),
            tokensOut: full ? Math.ceil(full.length / 4) : null,
            durationMs: Date.now() - t0,
            success: succeeded,
            errorCode: succeeded ? null : 'BACKEND_FAILURE',
          })
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                conversationId: convId,
                durationMs: Date.now() - t0,
                partial: !succeeded,
              })}\n\n`,
            ),
          )
        } catch (e) {
          logger.warn('riishe.stream_failed', {
            message: e instanceof Error ? e.message : String(e),
          })
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: backend.id,
            kind: 'chat',
            tokensIn: Math.ceil(body.message.length / 4),
            durationMs: Date.now() - t0,
            success: false,
            errorCode: 'BACKEND_FAILURE',
          })
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: 'The response stream failed before completion. Partial text is labeled as incomplete.',
                partial: true,
              })}\n\n`,
            ),
          )
        } finally {
          release()
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  })
}

/** Conversation list for the RIISHE sidebar. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const conversations = await db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { _count: { select: { messages: true } } },
    })
    return ok({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messages: c._count.messages,
        updatedAt: c.updatedAt,
      })),
    })
  })
}
