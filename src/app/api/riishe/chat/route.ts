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
import { upstreamStreamErrorPayload, upstreamErrorCode } from '@/lib/upstream/gateway'
import type { ChatTurn } from '@/lib/adapters/types'

const schema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1, 'Enter a message.').max(12000),
  /** Files (already uploaded, ownership-checked) to ground this turn on. */
  documentIds: z.array(z.string().min(1)).max(3).optional(),
  /** Regenerate: drop the trailing assistant message before answering. */
  retry: z.boolean().default(false),
  /** Regenerate a SPECIFIC earlier response: the conversation's messages
   *  from that exchange onward (the assistant reply, its user turn, and
   *  everything after) are removed first, so history stays an honest,
   *  coherent sequence. Owner-checked below. */
  retryFromMessageId: z.string().min(1).optional(),
})

/**
 * Pure predicate for the dangling-retry collapse: TRUE when the conversation's
 * trailing row is the SAME user message with no assistant reply after it —
 * the exact residue of a turn that failed before answering (e.g. upstream
 * HTTP 429). Re-sending that question is the retry, so the route replaces
 * the dangling row instead of accumulating duplicate user turns.
 */
export function isDanglingDuplicateUserRow(
  trailing: { role: string; content: string } | null,
  incoming: string,
): trailing is { role: string; content: string } {
  return trailing !== null && trailing.role === 'user' && trailing.content === incoming
}

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
    const tRequest = Date.now()
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, adapter, release } = await preflight(user.id, 'riishe', 'chat')
    // Request validation + orchestration pre-flight (auth, body parse, rate
    // limits, quotas, concurrency, capability resolution) — measured so
    // non-model overhead is never mistaken for model latency.
    const preflightMs = Date.now() - tRequest
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

    // Dangling-retry collapse: a previous turn that failed BEFORE producing
    // any assistant reply leaves a trailing user row with no answer. When the
    // user sends that same question again (the natural retry after a rate
    // limit), the dangling row is removed first so the conversation keeps ONE
    // honest record of the retried turn instead of accumulating duplicates.
    // Never triggers after an ANSWERED turn (the trailing row is the
    // assistant's), and never for regenerate flows (they manage rows below).
    if (!body.retry && !body.retryFromMessageId) {
      const trailing = await db.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, role: true, content: true },
      })
      if (isDanglingDuplicateUserRow(trailing, body.message)) {
        await db.message.delete({ where: { id: trailing.id } })
      }
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
    } else if (body.retryFromMessageId) {
      // Regenerate from an EARLIER response: delete that assistant message,
      // its preceding user turn, and every message after it.
      const target = await db.message.findFirst({
        where: { id: body.retryFromMessageId, conversationId, role: 'assistant' },
      })
      if (target) {
        const all = await db.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true },
        })
        const idx = all.findIndex((m) => m.id === target.id)
        if (idx >= 0) {
          // Walk back to the user turn that produced this reply, then drop
          // everything from that user turn onward.
          let start = idx
          for (let i = idx - 1; i >= 0; i -= 1) {
            start = i
            if (all[i].role === 'user') break
          }
          const idsToDelete = all.slice(start).map((m) => m.id)
          await db.message.deleteMany({ where: { id: { in: idsToDelete } } })
          // A summary digest computed over deleted turns is stale.
          await db.conversation.update({ where: { id: conversationId }, data: { summary: null, summaryCount: 0 } })
        }
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
      // Code execution is a SERVER-SIDE policy (no client toggle): the
      // permission is always granted; the orchestrator's selectTools only
      // offers run_code for tasks where executing code genuinely helps, and
      // the tool registry still gates every actual execution.
      permissions: new Set(['allowCodeExecution']),
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
        logger.info('riishe.performance', {
          path: 'json',
          conversationId,
          task: result.task,
          preflightMs,
          ...(result.metadata.timings ?? {}),
        })
        return ok({
          conversationId,
          content: result.content,
          durationMs: result.durationMs,
          metadata: result.metadata,
        })
      } catch (e) {
        // Typed upstream failures map to their honest BeanApiError codes so
        // the JSON path reports rate-limited as 429 (not a generic 500).
        throw new BeanApiError(upstreamErrorCode(e), e instanceof Error ? e.message : 'The backend call failed.')
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
        let firstTokenAt: number | null = null
        let finalMetadata: MessageMetadata | null = null
        let assistantMessageId: string | null = null
        try {
          const result = await orchestrateTurn({
            userMessage: body.message,
            history,
            caps,
            adapter,
            backendCapabilities: CHAT_BACKEND_CAPABILITIES,
            toolContext,
            documents,
            digest,
            onEvent: (e) => {
              if (e.type === 'delta') {
                if (firstTokenAt === null) firstTokenAt = Date.now()
                full += e.delta
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ delta: e.delta, conversationId: convId })}\n\n`,
                  ),
                )
              } else if (e.type === 'reset') {
                // Reset protocol: a verification rewrite replaced the streamed
                // draft — the client must CLEAR what it has so the final
                // answer replaces it instead of concatenating.
                full = ''
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reset: true })}\n\n`))
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
          logger.info('riishe.performance', {
            path: 'sse',
            conversationId: convId,
            task: result.task,
            preflightMs,
            // User-perceived time to first streamed token (null when the turn
            // was buffered end-to-end — tool loop / injection gate).
            firstTokenMs: firstTokenAt !== null ? firstTokenAt - t0 : null,
            ...(result.metadata.timings ?? {}),
          })
          if (succeeded) {
            const assistantRow = await db.message.create({
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
            assistantMessageId = assistantRow.id
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
                // The persisted message id lets the client wire Regenerate
                // on ANY assistant message (not just the trailing one).
                ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
                ...(firstTokenAt !== null ? { firstTokenMs: firstTokenAt - t0 } : {}),
                ...(finalMetadata ? { meta: finalMetadata } : {}),
              })}\n\n`,
            ),
          )
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e)
          logger.warn('riishe.stream_failed', { message: errorMessage.slice(0, 300) })
          // Honest failure classification: the upstream status (embedded by the
          // SDK in the error text) decides the story. A 429 is temporary
          // throttling; 401/403 is an operator action; 402 is an account
          // action; anything else is an application failure. Research-layer
          // failures never reach this catch — they degrade into the evidence
          // pack — so a rate-limit here is the chat/LLM endpoint, and the
          // wording says so instead of blaming the research gateway.
          const payload = upstreamStreamErrorPayload(e)
          const errorCode =
            payload.code === 'UPSTREAM_RATE_LIMITED'
              ? 'UPSTREAM_RATE_LIMITED'
              : payload.code === 'UPSTREAM_AUTH'
                ? 'UPSTREAM_AUTH'
                : payload.code === 'UPSTREAM_BILLING'
                  ? 'UPSTREAM_BILLING'
                  : 'BACKEND_FAILURE'
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: backend.id,
            kind: 'chat',
            tokensIn: Math.ceil(body.message.length / 4),
            durationMs: Date.now() - t0,
            success: false,
            errorCode,
          })
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
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

/** Conversation list for the RIISHE sidebar. `?q=` filters by title
 *  (case-insensitive) across ALL of the user's conversations — the recent
 *  list itself is capped, but a search must still find older threads.
 *  Filtering happens in JS because SQLite's LIKE is only ASCII-case-aware. */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    if (q.length > 0) {
      const candidates = await db.conversation.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        include: { _count: { select: { messages: true } } },
      })
      const needle = q.toLowerCase()
      const conversations = candidates
        .filter((c) => c.title.toLowerCase().includes(needle))
        .slice(0, 50)
        .map((c) => ({
          id: c.id,
          title: c.title,
          messages: c._count.messages,
          updatedAt: c.updatedAt,
        }))
      return ok({ conversations, query: q })
    }
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
