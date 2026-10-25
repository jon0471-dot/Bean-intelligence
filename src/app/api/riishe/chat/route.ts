import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { recordUsage } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { orchestrateTurn } from '@/lib/riishe/orchestrator'
import { CHAT_BACKEND_CAPABILITIES } from '@/lib/riishe/classify'
import { buildConversationDigest } from '@/lib/riishe/summarize'
import type { AttachedDocument } from '@/lib/riishe/orchestrator'
import type { ToolContext } from '@/lib/riishe/tools/types'
import { metadataToJson, type MessageMetadata } from '@/lib/riishe/states'
import type { ChatTurn } from '@/lib/adapters/types'

const schema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1, 'Enter a message.').max(12000),
  /** Live-retrieval control: policy decides by default. */
  searchMode: z.enum(['auto', 'on', 'off']).default('auto'),
  /** Explicit per-request opt-in for sandboxed code execution. */
  allowCodeExecution: z.boolean().default(false),
  /** Documents (already uploaded) to ground this turn on. */
  documentIds: z.array(z.string().min(1)).max(2).optional(),
  /** Regenerate: drop the trailing assistant message before answering. */
  retry: z.boolean().default(false),
})

/**
 * RIISHE conversational endpoint. SSE streaming when the client asks,
 * JSON otherwise. Every request passes the same preflight: auth,
 * availability, rate limits, quotas, concurrency, capability validation.
 *
 * The orchestrator runs Understand -> Retrieve -> (tool loop) -> Solve ->
 * Verify -> Respond; response states and verification summaries are assigned
 * from ACTUAL tool execution (search, arithmetic evaluator, citation audit,
 * sandbox), never by the model. Long conversations are condensed into a
 * cached digest instead of silently losing their oldest turns.
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

    // Regenerate: the previous attempt for this trailing turn is removed
    // (owner-checked above) so history stays a clean, honest sequence.
    if (body.retry) {
      const last = await db.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      })
      if (last && last.role === 'assistant') {
        await db.message.delete({ where: { id: last.id } })
      }
    }

    const caps = assertChatRequest(backend, [{ role: 'user', content: body.message }])

    // History window: the MOST RECENT messages must reach the model, so the
    // fetch takes the tail (desc) and restores chronological order. Turns
    // that fell out of the window (the oldest total - N messages) are
    // condensed into a cached conversation digest instead of being lost.
    const total = await db.message.count({ where: { conversationId } })
    const window = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: caps.maxHistoryMessages,
    })
    const inWindow = window.reverse()
    const overflowCount = Math.max(0, total - inWindow.length)

    // Reuse the cached digest when it already covers the current overflow;
    // regenerate only when more turns fell out of the window.
    let digest: string | null = null
    let digestDegraded: string | null = null
    if (overflowCount > 0) {
      const conv = await db.conversation.findUnique({ where: { id: conversationId } })
      if (conv?.summary && conv.summaryCount === overflowCount) {
        digest = conv.summary
      } else {
        const overflowRows = await db.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: overflowCount,
        })
        const overflow = overflowRows.map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }))
        const built = await buildConversationDigest(adapter, overflow)
        digest = built.digest
        digestDegraded = built.degraded
        if (digest) {
          await db.conversation.update({
            where: { id: conversationId },
            data: { summary: digest, summaryCount: overflowCount },
          })
        }
      }
    }

    // Attached documents: ownership-checked here, so the orchestrator never
    // sees a document id the user does not own.
    let documents: AttachedDocument[] = []
    if (body.documentIds && body.documentIds.length > 0) {
      const rows = await db.document.findMany({
        where: { id: { in: body.documentIds }, userId: user.id },
      })
      documents = rows.map((d) => ({ id: d.id, name: d.name, text: d.text, truncated: d.truncated }))
      if (documents.length !== body.documentIds.length) {
        release()
        throw new BeanApiError('NOT_FOUND', 'One or more attached documents were not found.')
      }
    }

    const toolContext: ToolContext = {
      permissions: new Set(body.allowCodeExecution ? ['allowCodeExecution'] : []),
      documents: new Map(documents.map((d) => [d.id, { name: d.name, text: d.text, truncated: d.truncated }])),
    }

    const history: ChatTurn[] = inWindow.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }))

    await db.message.create({
      data: { conversationId, role: 'user', content: body.message },
    })

    const wantsStream = new URL(request.url).searchParams.get('stream') === '1'

    // ---- JSON path ---------------------------------------------------------
    if (!wantsStream) {
      try {
        const result = await orchestrateTurn({
          userMessage: body.message,
          history,
          caps,
          adapter,
          nonStreaming: true,
          backendCapabilities: CHAT_BACKEND_CAPABILITIES,
          searchMode: body.searchMode,
          toolContext,
          documents,
          digest,
        })
        await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: result.content,
            tokensEstIn: result.tokensInEst,
            tokensEstOut: result.tokensOutEst,
            latencyMs: result.durationMs,
            metadata: metadataToJson(result.metadata),
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
        return ok({
          conversationId,
          content: result.content,
          durationMs: result.durationMs,
          metadata: result.metadata,
        })
      } finally {
        release()
      }
    }

    // ---- SSE streaming path ----------------------------------------------
    const convId = conversationId
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const t0 = Date.now()
        let succeeded = false
        let full = ''
        let finalMetadata: MessageMetadata | null = null
        try {
          const result = await orchestrateTurn({
            userMessage: body.message,
            history,
            caps,
            adapter,
            backendCapabilities: CHAT_BACKEND_CAPABILITIES,
            searchMode: body.searchMode,
            toolContext,
            documents,
            digest,
            onEvent: (e) => {
              if (e.type === 'delta') {
                full += e.delta
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ delta: e.delta, conversationId: convId })}\n\n`,
                  ),
                )
              } else if (e.type === 'stage') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
              } else if (e.type === 'research') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ research: { queries: e.queries } })}\n\n`),
                )
              } else if (e.type === 'tool') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool: e })}\n\n`))
              }
            },
          })
          finalMetadata = result.metadata
          succeeded = full.trim().length > 0
          if (succeeded) {
            await db.message.create({
              data: {
                conversationId: convId,
                role: 'assistant',
                content: result.content,
                tokensEstIn: result.tokensInEst,
                tokensEstOut: result.tokensOutEst,
                latencyMs: result.durationMs,
                metadata: metadataToJson(result.metadata),
              },
            })
          }
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: backend.id,
            kind: 'chat',
            tokensIn: result.tokensInEst,
            tokensOut: succeeded ? result.tokensOutEst : null,
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
                ...(finalMetadata ? { meta: finalMetadata } : {}),
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

    // Digest degradation is surfaced honestly once per turn.
    if (digestDegraded) {
      logger.info('riishe.digest_degraded', { conversationId: convId, reason: digestDegraded })
    }

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
