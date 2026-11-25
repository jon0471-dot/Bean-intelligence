import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { recordUsage } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { orchestrateTurn } from '@/lib/riishe/orchestrator'
import { createRiisheTurnRecorder } from '@/lib/trust/adapters/riishe'
import { CHAT_BACKEND_CAPABILITIES } from '@/lib/riishe/classify'
import { buildConversationDigest } from '@/lib/riishe/summarize'
import type { AttachedDocument } from '@/lib/riishe/orchestrator'
import type { ToolContext } from '@/lib/riishe/tools/types'
import { metadataToJson, type MessageMetadata } from '@/lib/riishe/states'
import { MEMORY_LIMITS } from '@/lib/riishe/memory'
import { getMemoryDelegate } from '@/lib/riishe/memory-db'
import { performMemoryCommandIfPresent } from '@/lib/riishe/memory-actions'
import { upstreamStreamErrorPayload, upstreamErrorCode } from '@/lib/upstream/gateway'
import { createSseWriter } from '@/lib/riishe/sse'
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
    const { backend, adapter, release, servedBy } = await preflight(user.id, 'riishe', 'chat')
    // M26 (audit G-4): the concurrency slot is released EXACTLY ONCE through
    // this guard — every early return, mid-path release and the execution
    // paths' own finallys funnel here, and the outer try/finally below
    // catches anything the inner paths miss. Previously several awaits
    // between the slot acquisition and the execution paths' try/finally
    // (conversation create, regenerate deletions, memory commands, message
    // insert) were unguarded: a throw there leaked the slot PERMANENTLY —
    // two leaks lock the user out with CONCURRENCY_LIMIT until restart.
    let slotReleased = false
    let sseHandoff = false
    // CONCURRENCY DIAGNOSTIC (2026-11-23): ownership flag for the SSE handoff.
    // The OUTER finally below must stay hands-off once the streamed response
    // is returned (the turn is still running), but that decision must NOT
    // touch `slotReleased` — that flag means "release() actually ran" and is
    // owned solely by releaseOnce. Setting it eagerly (the M26 G-4 handoff)
    // poisoned the guard: the stream's own finally then called releaseOnce()
    // and silently no-opped, leaking ONE slot per streamed turn against the
    // router's in-memory per-user counter — two streamed turns locked the
    // user out with CONCURRENCY_LIMIT until a process restart (the exact
    // reported "maximum number of concurrent jobs" failure; same symptom as
    // the committed pre-M26 dig-*.sse artifacts). This flag moves ONLY the
    // outer finally's decision; the stream's finally still releases exactly
    // once through the untouched shared guard.
    const releaseOnce = (): void => {
      if (slotReleased) return
      slotReleased = true
      release()
    }
    try {
    // Request validation + orchestration pre-flight (auth, body parse, rate
    // limits, quotas, concurrency, capability resolution) — measured so
    // non-model overhead is never mistaken for model latency.
    const preflightMs = Date.now() - tRequest
    if (!adapter.chat || !adapter.chatStream) {
      releaseOnce()
      throw new BeanApiError('NO_BACKEND', 'The chat backend is missing its adapter.')
    }

    // Resolve or create the conversation (ownership enforced).
    let conversationId = body.conversationId
    if (conversationId) {
      const conv = await db.conversation.findUnique({ where: { id: conversationId } })
      if (!conv || conv.userId !== user.id) {
        releaseOnce()
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
    // MUST run BEFORE the dangling-retry collapse below: after the trailing
    // assistant row is removed, the trailing row is the original user turn —
    // exactly what the collapse then deduplicates against the re-sent
    // message (measured defect: regenerating a trailing turn used to append
    // a SECOND copy of the same question to history).
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

    // Dangling-retry collapse: a previous turn that failed BEFORE producing
    // any assistant reply leaves a trailing user row with no answer. When
    // that same question is re-sent (the natural retry after a rate limit,
    // OR a Regenerate of a turn whose assistant row was just removed above),
    // the dangling row is removed first so the conversation keeps ONE honest
    // record of the turn instead of accumulating duplicate questions.
    // Never triggers after an ANSWERED turn (the trailing row is the
    // assistant's), and never for regenerate-from-message flows (they manage
    // rows above). Applies to BOTH plain retries and trailing regenerates —
    // measured defect: retry=true used to skip the collapse and append a
    // duplicate question row for every regenerated turn.
    if (!body.retryFromMessageId) {
      const trailing = await db.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, role: true, content: true },
      })
      if (isDanglingDuplicateUserRow(trailing, body.message)) {
        await db.message.delete({ where: { id: trailing.id } })
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
    // sees a document id the user does not own. kind (server-detected file
    // capability) and storagePath (server-written path for stored image
    // originals) flow to the tool context for the analyze_image tool.
    let documents: AttachedDocument[] = []
    if (body.documentIds && body.documentIds.length > 0) {
      const rows = await db.document.findMany({
        where: { id: { in: body.documentIds }, userId: user.id },
      })
      documents = rows.map((d) => {
        let storagePath: string | null = null
        try {
          const meta = d.metaJson ? (JSON.parse(d.metaJson) as { storagePath?: string }) : null
          storagePath = typeof meta?.storagePath === 'string' ? meta.storagePath : null
        } catch {
          storagePath = null
        }
        return {
          id: d.id,
          name: d.name,
          text: d.text,
          truncated: d.truncated,
          kind: d.kind,
          storagePath,
          // Honest processing note (extraction scope, e.g. PDF page
          // accounting) rides along so the model states it, never hides it.
          note: d.note,
        }
      })
      if (documents.length !== body.documentIds.length) {
        releaseOnce()
        throw new BeanApiError('NOT_FOUND', 'One or more attached documents were not found.')
      }
    }

    const toolContext: ToolContext = {
      // The permission keys are the SERVER-side authority (no client toggle);
      // the orchestrator's capability planner narrows them per turn (explicit
      // execution/media-creation requests) before any gated tool call reaches
      // the registry's permission gate. Code execution additionally runs the
      // restricted sandbox; specialist delegation submits durable jobs through
      // the SAME preflight gates as the product routes.
      permissions: new Set(['allowCodeExecution', 'allowImageGeneration', 'allowVideoCreation', 'allowSpeechSynthesis', 'allowCodingDelegation', 'allowMissionDelegation']),
      // M36-C: specialist delegation submits jobs under THIS user only.
      userId: user.id,
      // M40: conversation-scoped cache key for the retrieval lanes.
      conversationKey: conversationId,
      documents: new Map(
        documents.map((d) => [d.id, { name: d.name, text: d.text, truncated: d.truncated, kind: d.kind, storagePath: d.storagePath }]),
      ),
    }

    const history: ChatTurn[] = inWindow.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }))

    await db.message.create({
      data: { conversationId, role: 'user', content: body.message },
    })

    const wantsStream = new URL(request.url).searchParams.get('stream') === '1'

    // ---- User-approved memory commands (Phase 6) ---------------------------
    // "remember …" / "forget …" / "what do you remember about me" are REAL
    // database actions with SYSTEM-authored receipts (metadata labels them),
    // never model-simulated results. The implementation is SHARED with the
    // background chat worker (src/lib/riishe/memory-actions.ts) so both
    // execution paths behave identically.
    const memoryOutcome = await performMemoryCommandIfPresent(user.id, conversationId, body.message)
    if (memoryOutcome) {
      const { content, meta } = memoryOutcome
      // Trust Engine: memory commands are REAL database actions on both
      // execution paths, so the interactive path records the same receipt
      // (one receipt system — the shared recorder, no second pipeline).
      const memoryTrust = createRiisheTurnRecorder({
        userId: user.id,
        message: body.message,
        conversationId,
      })
      await memoryTrust.begin()
      await memoryTrust.completeMemory(memoryOutcome)
      releaseOnce()
      if (!wantsStream) {
        return ok({ conversationId, content, durationMs: 0, metadata: meta })
      }
      const enc = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: content, conversationId })}\n\n`))
            c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, conversationId, durationMs: 0, partial: false, meta })}\n\n`))
            c.close()
          },
        }),
        {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
          },
        },
      )
    }

    // The user's own approved memories ride along as bounded prompt context.
    // Skipped (honestly) when the memory store is unavailable on this process.
    // M33 EXPLAINABLE RECALL: the selection is fetched WITH ids plus the
    // store's total size at selection time, so the orchestrator can compose
    // the truthful memory-context record (IDs + policy + counts) that makes
    // every answer's memory usage explainable. Contents never enter
    // metadata — the chat UI loads them through this owner-scoped API.
    const memoryStore = getMemoryDelegate()
    let memoryRecords: Array<{ id: string; content: string }> = []
    let memoryTotalCount = 0
    if (memoryStore) {
      memoryTotalCount = await memoryStore.count({ where: { userId: user.id } })
      memoryRecords = (
        await memoryStore.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: MEMORY_LIMITS.injectionCount,
          select: { id: true, content: true },
        })
      ).map((r) => ({ id: r.id, content: r.content }))
    }

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
          memoryRecords,
          memoryTotalCount,
          userId: user.id,
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
          backendId: servedBy.backendId,
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
        releaseOnce()
      }
    }

    // ---- SSE streaming path ----------------------------------------------
    // ROOT-CAUSE FIX (2026-11-01 "network error" / premature termination):
    // this stream previously wrote NOTHING during the long silent phases of
    // a turn (research: multi-query search + page reads, measured 20-60s+;
    // buffered tool-loop/injection-gate solves; the gap before the model's
    // first token). Reverse proxies on the hosting path kill an idle stream
    // mid-generation, surfacing client-side as Chromium's literal
    // `TypeError: network error` with the partial answer stranded. Fixes:
    //  (a) an immediate `: connected` comment flushes headers/first bytes;
    //  (b) createSseWriter emits a `: keepalive` comment whenever nothing
    //      else is written for 15s — comments are spec-valid SSE, ignored by
    //      parsers, and reset proxy idle timers;
    //  (c) consumer disconnects are CONTAINED (writer swallows enqueue
    //      failures): the orchestrator finishes and the complete answer is
    //      persisted, so a dropped connection never leaves a dangling
    //      half-turn or a duplicate user retry;
    //  (d) `x-accel-buffering: no` stops buffering proxies from holding
    //      frames.
    // The wire protocol itself (single-line `data: {json}` frames) is
    // UNCHANGED.
    const convId = conversationId
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writer = createSseWriter(controller, {
          onClosed: (reason) => {
            if (reason === 'client_gone') {
              logger.info('riishe.stream_client_disconnected', { conversationId: convId })
            }
          },
        })
        const t0 = Date.now()
        let succeeded = false
        let full = ''
        let firstTokenAt: number | null = null
        let finalMetadata: MessageMetadata | null = null
        let assistantMessageId: string | null = null
        // Trust Engine: the interactive turn gets the SAME receipt contract
        // as background turns — one recorder, no second receipt system.
        // Best-effort: recording failures never affect the streamed turn.
        const trust = createRiisheTurnRecorder({
          userId: user.id,
          message: body.message,
          conversationId: convId,
        })
        await trust.begin()
        await trust.addDocuments(
          documents.map((d) => ({ id: d.id, name: d.name, truncated: d.truncated, note: (d.kind ? `kind ${d.kind}` : null) })),
        )
        try {
          // First bytes on the wire immediately — establishes the response
          // before any slow research/model work begins.
          writer.comment('connected')
          const result = await orchestrateTurn({
            userMessage: body.message,
            history,
            caps,
            adapter,
            backendCapabilities: CHAT_BACKEND_CAPABILITIES,
            toolContext,
            documents,
            digest,
            memoryRecords,
            memoryTotalCount,
            userId: user.id,
            onEvent: (e) => {
              // Feed the same orchestrator events into the receipt ledger
              // (stage transitions → steps, tool starts → names).
              trust.onEvent(e)
              if (e.type === 'delta') {
                if (firstTokenAt === null) firstTokenAt = Date.now()
                full += e.delta
                writer.send({ delta: e.delta, conversationId: convId })
              } else if (e.type === 'reset') {
                // Reset protocol: a verification rewrite replaced the streamed
                // draft — the client must CLEAR what it has so the final
                // answer replaces it instead of concatenating.
                full = ''
                writer.send({ reset: true })
              } else if (e.type === 'stage') {
                writer.send(e)
              } else if (e.type === 'research') {
                writer.send({ research: { queries: e.queries } })
              } else if (e.type === 'tool') {
                writer.send({ tool: e })
              } else if (e.type === 'task') {
                // M37 §5 — genuine operational stages (planning, reading
                // documents, delegating, approval waiting, terminal outcome)
                // recorded from REAL execution events; additive wire frames.
                trust.onTaskEvent(e)
                writer.send({ task: { stage: e.stage, ...(e.detail ? { detail: e.detail } : {}) } })
              }
            },
          })
          finalMetadata = result.metadata
          succeeded = full.trim().length > 0
          // Honest settlement from ACTUAL execution — identical semantics to
          // the background path (persisted answer + assigned states).
          await trust.complete(result, { persisted: succeeded })
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
            backendId: servedBy.backendId,
            kind: 'chat',
            tokensIn: result.tokensInEst,
            tokensOut: succeeded ? result.tokensOutEst : null,
            durationMs: Date.now() - t0,
            success: succeeded,
            errorCode: succeeded ? null : 'BACKEND_FAILURE',
          })
          writer.send({
            done: true,
            conversationId: convId,
            durationMs: Date.now() - t0,
            partial: !succeeded,
            // The persisted message id lets the client wire Regenerate
            // on ANY assistant message (not just the trailing one).
            ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
            ...(firstTokenAt !== null ? { firstTokenMs: firstTokenAt - t0 } : {}),
            ...(finalMetadata ? { meta: finalMetadata } : {}),
          })
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e)
          logger.warn('riishe.stream_failed', { message: errorMessage.slice(0, 300) })
          const payload = upstreamStreamErrorPayload(e)
          const errorCode =
            payload.code === 'UPSTREAM_RATE_LIMITED'
              ? 'UPSTREAM_RATE_LIMITED'
              : payload.code === 'UPSTREAM_AUTH'
                ? 'UPSTREAM_AUTH'
                : payload.code === 'UPSTREAM_BILLING'
                  ? 'UPSTREAM_BILLING'
                  : payload.code === 'UPSTREAM_TIMEOUT'
                    ? 'UPSTREAM_TIMEOUT'
                    : payload.code === 'UPSTREAM_TRUNCATED'
                      ? 'UPSTREAM_TRUNCATED'
                      : 'BACKEND_FAILURE'
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: servedBy.backendId,
            kind: 'chat',
            tokensIn: Math.ceil(body.message.length / 4),
            durationMs: Date.now() - t0,
            success: false,
            errorCode,
          })
          // Truthful failure receipt with the same classification the user saw.
          await trust.failed({ errorCode, errorMessage })
          writer.send(payload)
        } finally {
          releaseOnce()
          writer.close()
        }
      },
    })

    // Digest degradation is surfaced honestly once per turn.
    if (digestDegraded) {
      logger.info('riishe.digest_degraded', { conversationId: convId, reason: digestDegraded })
    }

    // M26 G-4 SSE ownership handoff, CORRECTED: the stream's own finally
    // (start()) releases the slot when the stream COMPLETES; the outer
    // finally below must not release at response-return time (streaming is
    // still running) — so it defers via sseHandoff instead of poisoning
    // slotReleased (the release-once guard stays intact for the stream).
    sseHandoff = true
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Buffering proxies must forward SSE frames as they arrive; without
        // this, nginx-class proxies hold frames until their buffer fills,
        // delaying every delta and inviting idle-connection kills.
        'x-accel-buffering': 'no',
      },
    })
    } finally {
      // M26 G-4: the slot can NEVER outlive the request handler — a throw
      // anywhere above (DB hiccup, validation, memory command) releases it.
      // CONCURRENCY DIAGNOSTIC (2026-11-23): once the SSE handoff happened
      // the STREAM's finally owns the release; releasing here too would
      // double-decrement the counter, so defer to it.
      if (!sseHandoff) releaseOnce()
    }
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
