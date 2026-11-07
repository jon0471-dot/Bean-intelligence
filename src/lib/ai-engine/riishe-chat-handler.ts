/**
 * BEAN Intelligence — RIISHE background chat worker handler.
 *
 * Executes a REAL conversational turn away from the browser: same
 * orchestrator (understand → retrieve → tool loop → solve → verify →
 * respond), same conversation persistence, same memory commands, same
 * usage metering as the live SSE path. Partial text streams into the job's
 * event log, so the user can close the tab and the finished answer is in
 * the conversation history when they return.
 *
 * Difference from the live path (by design): there is no interactive user
 * to watch a stream — everything flows through the event log, and the
 * assistant message is persisted by THIS handler exactly like the route's
 * persistence block.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { assertChatRequest, resolveBackgroundAdapter } from '@/lib/router/router'
import { orchestrateTurn, type OrchestrationEvent } from '@/lib/riishe/orchestrator'
import { CHAT_BACKEND_CAPABILITIES } from '@/lib/riishe/classify'
import { buildConversationDigest } from '@/lib/riishe/summarize'
import { getMemoryDelegate } from '@/lib/riishe/memory-db'
import { MEMORY_LIMITS } from '@/lib/riishe/memory'
import { performMemoryCommandIfPresent } from '@/lib/riishe/memory-actions'
import { metadataToJson } from '@/lib/riishe/states'
import type { AttachedDocument } from '@/lib/riishe/orchestrator'
import type { ToolContext } from '@/lib/riishe/tools/types'
import type { ChatTurn } from '@/lib/adapters/types'
import { isCancelRequested } from './queue'
import { appendJobEventSafe } from './events'
import { transitionJob } from './queue'
import { classifyJobFailure } from './classify'
import type { ClaimedJob, HandlerOutcome } from './types'

interface RiisheJobParams {
  message: string
  conversationId: string
  /** The user row persisted at submission — excluded from history window. */
  userMessageId: string
  documentIds?: string[]
}

export async function handleRiisheChatJob(
  job: ClaimedJob,
  ctx: { signal: { aborted: boolean } },
): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as RiisheJobParams
  const startedAt = Date.now()

  const { adapter, backend, servedBy } = await resolveBackgroundAdapter(job.userId, 'riishe', 'chat')
  if (!adapter.chat || !adapter.chatStream) {
    return {
      errorClass: 'permanent',
      errorCode: 'NO_BACKEND',
      errorMessage: 'The chat backend is missing its adapter.',
    }
  }

  // Conversation + ownership (defensive re-check — submit verified it too).
  const conv = await db.conversation.findUnique({ where: { id: params.conversationId } })
  if (!conv || conv.userId !== job.userId) {
    return {
      errorClass: 'permanent',
      errorCode: 'NOT_FOUND',
      errorMessage: 'Conversation not found.',
    }
  }

  await transitionJob(job.id, job.workerId, 'running', { backendId: backend.id })

  // Memory commands are REAL database actions on both execution paths.
  const memoryOutcome = await performMemoryCommandIfPresent(
    job.userId,
    params.conversationId,
    params.message,
  )
  if (memoryOutcome) {
    const done = await db.generationJob.updateMany({
      where: { id: job.id, workerId: job.workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: {
        status: 'completed',
        progress: 100,
        resultJson: JSON.stringify({
          conversationId: params.conversationId,
          memoryAction: memoryOutcome.meta.memoryAction ?? null,
          contentChars: memoryOutcome.content.length,
          durationMs: Date.now() - startedAt,
        }),
        finishedAt: new Date(),
        errorClass: 'none',
      },
    })
    if (done.count === 1) {
      await appendJobEventSafe(job.id, 'delta', { delta: memoryOutcome.content, conversationId: params.conversationId })
    }
    return { result: {} } // row already terminal
  }

  const caps = assertChatRequest(backend, [{ role: 'user', content: params.message }])

  // History window: exclude THIS turn's user row (persisted at submit) —
  // the message itself is passed as userMessage, never duplicated.
  const total = await db.message.count({ where: { conversationId: params.conversationId } })
  const window = await db.message.findMany({
    where: { conversationId: params.conversationId, id: { not: params.userMessageId } },
    orderBy: { createdAt: 'desc' },
    take: caps.maxHistoryMessages,
  })
  const inWindow = window.reverse()
  const overflowCount = Math.max(0, total - 1 - inWindow.length) // minus this turn's row

  let digest: string | null = null
  if (overflowCount > 0) {
    if (conv.summary && conv.summaryCount === overflowCount) {
      digest = conv.summary
    } else {
      const overflowRows = await db.message.findMany({
        where: { conversationId: params.conversationId, id: { not: params.userMessageId } },
        orderBy: { createdAt: 'asc' },
        take: overflowCount,
      })
      const built = await buildConversationDigest(adapter, overflowRows.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })))
      digest = built.digest
      if (digest) {
        await db.conversation.update({
          where: { id: params.conversationId },
          data: { summary: digest, summaryCount: overflowCount },
        })
      }
    }
  }

  // Attached documents: ownership-checked (identical to the live route).
  let documents: AttachedDocument[] = []
  if (params.documentIds && params.documentIds.length > 0) {
    const rows = await db.document.findMany({
      where: { id: { in: params.documentIds }, userId: job.userId },
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
        note: d.note,
      }
    })
    if (documents.length !== params.documentIds.length) {
      return { errorClass: 'permanent', errorCode: 'NOT_FOUND', errorMessage: 'One or more attached documents were not found.' }
    }
  }

  const toolContext: ToolContext = {
    permissions: new Set(['allowCodeExecution']),
    documents: new Map(
      documents.map((d) => [d.id, { name: d.name, text: d.text, truncated: d.truncated, kind: d.kind, storagePath: d.storagePath }]),
    ),
  }

  const history: ChatTurn[] = inWindow.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  const memoryStore = getMemoryDelegate()
  const memories = memoryStore
    ? (
        await memoryStore.findMany({
          where: { userId: job.userId },
          orderBy: { createdAt: 'desc' },
          take: MEMORY_LIMITS.injectionCount,
          select: { content: true },
        })
      ).map((r) => r.content)
    : []
  // ---- Streaming sink -----------------------------------------------------
  let full = ''
  let streamingTransitioned = false
  let lastCancelCheck = Date.now()
  let cancelled = false

  const onEvent = (e: OrchestrationEvent): void => {
    if (e.type === 'delta') {
      full += e.delta ?? ''
      if (!streamingTransitioned) {
        streamingTransitioned = true
        void transitionJob(job.id, job.workerId, 'streaming')
      }
      void appendJobEventSafe(job.id, 'delta', { delta: e.delta, conversationId: params.conversationId })
    } else if (e.type === 'reset') {
      full = ''
      void appendJobEventSafe(job.id, 'reset', { conversationId: params.conversationId })
    } else if (e.type === 'stage') {
      void appendJobEventSafe(job.id, 'stage', { stage: e.stage })
    } else if (e.type === 'research') {
      void appendJobEventSafe(job.id, 'research', { queries: e.queries })
    } else if (e.type === 'tool') {
      void appendJobEventSafe(job.id, 'tool', { name: e.name, status: e.status })
    }
    // Cooperative cancellation between natural checkpoints (time-gated).
    const now = Date.now()
    if (now - lastCancelCheck > 1_000) {
      lastCancelCheck = now
      void isCancelRequested(job.id).then((c) => {
        if (c) cancelled = true
      })
    }
  }

  try {
    const result = await orchestrateTurn({
      userMessage: params.message,
      history,
      caps,
      adapter,
      backendCapabilities: CHAT_BACKEND_CAPABILITIES,
      toolContext,
      documents,
      digest,
      memories,
      onEvent,
    })

    if (cancelled || ctx.signal.aborted) {
      await settleCancelled(job)
      return { result: {} }
    }

    const succeeded = full.trim().length > 0
    await transitionJob(job.id, job.workerId, 'finalizing')

    if (succeeded) {
      await db.message.create({
        data: {
          conversationId: params.conversationId,
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
      userId: job.userId,
      product: 'riishe',
      backendId: servedBy.backendId,
      kind: 'chat',
      tokensIn: result.tokensInEst,
      tokensOut: succeeded ? result.tokensOutEst : null,
      durationMs: Date.now() - startedAt,
      success: succeeded,
    })

    const done = await finishCompletedRow(job, {
      conversationId: params.conversationId,
      messageId: succeeded ? 'persisted' : null,
      contentChars: result.content.length,
      task: result.task,
      states: result.metadata.states ?? [],
      durationMs: Date.now() - startedAt,
    })
    if (done) {
      await appendJobEventSafe(job.id, 'artifact', {
        conversationId: params.conversationId,
        contentChars: result.content.length,
      })
    }
    return { result: {} }
  } catch (e) {
    if (cancelled || ctx.signal.aborted) {
      await settleCancelled(job)
      return { result: {} }
    }
    const failure = classifyJobFailure(e)
    logger.warn('engine.riishe_chat_failed', {
      jobId: job.id,
      conversationId: params.conversationId,
      code: failure.errorCode,
      message: failure.errorMessage,
    })
    return failure
  }
}

/** Settle a cooperatively-cancelled job as CANCELLED (terminal, honest). */
async function settleCancelled(job: ClaimedJob): Promise<void> {
  await db.generationJob.updateMany({
    where: { id: job.id, workerId: job.workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
    data: {
      status: 'cancelled',
      errorClass: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled while generating. Any streamed partial is visible in the event log; nothing was saved as a complete answer.',
      finishedAt: new Date(),
    },
  }).catch(() => undefined)
}

/** Settle the job row as COMPLETED with the real result payload. */
async function finishCompletedRow(job: ClaimedJob, result: Record<string, unknown>): Promise<boolean> {
  const res = await db.generationJob.updateMany({
    where: { id: job.id, workerId: job.workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
    data: {
      status: 'completed',
      progress: 100,
      resultJson: JSON.stringify(result),
      errorClass: 'none',
      errorCode: null,
      errorMessage: null,
      finishedAt: new Date(),
    },
  })
  return res.count === 1
}
