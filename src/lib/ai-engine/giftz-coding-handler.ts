/**
 * BEAN Intelligence — CODE GIFTZ background coding worker handler.
 *
 * Executes a REAL coding turn away from the browser through the shared turn
 * core (src/lib/giftz/turn.ts): controlled continuation, self-verification,
 * file-fence extraction with real diffs, identical persistence to the live
 * SSE path. Deltas stream into the job's event log; the finished answer and
 * updated project files are in the workspace when the user returns.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { resolveBackgroundAdapter } from '@/lib/router/router'
import { shouldCollapseDuplicateUserMessage } from '@/lib/giftz/retry'
import { verificationConfig } from '@/lib/verification/config'
import { publicVerificationSummary } from '@/lib/verification/pipeline'
import {
  runGiftzTurnCore,
  persistGiftzAssistantTurn,
  loadGiftzAttachments,
  type GiftzTurnCoreResult,
} from '@/lib/giftz/turn'
import { SYSTEM_PROMPT, buildProjectContext } from '@/lib/giftz/prompts'
import type { GenerationGuard } from '@/lib/giftz/chat-stream'
import { isCancelRequested } from './queue'
import { appendJobEventSafe } from './events'
import { transitionJob } from './queue'
import { classifyJobFailure } from './classify'
import type { ClaimedJob, HandlerOutcome } from './types'

const MAX_HISTORY = 12

interface GiftzJobParams {
  message: string
  projectId: string
  /** The user row persisted at submission — excluded from history. */
  userMessageId?: string
  fileIds?: string[]
}

export async function handleGiftzCodingJob(
  job: ClaimedJob,
  ctx: { signal: { aborted: boolean } },
): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as GiftzJobParams
  const startedAt = Date.now()

  const { adapter, backend, servedBy } = await resolveBackgroundAdapter(
    job.userId,
    'code-giftz',
    'coding-task',
  )

  // Project + ownership (defensive re-check; submit verified it too).
  const project = await db.codeProject.findUnique({ where: { id: params.projectId } })
  if (!project || project.userId !== job.userId) {
    return { errorClass: 'permanent', errorCode: 'NOT_FOUND', errorMessage: 'Project not found.' }
  }

  await transitionJob(job.id, job.workerId, 'running', { backendId: backend.id })

  const history = await db.codeMessage.findMany({
    where: { projectId: params.projectId, ...(params.userMessageId ? { id: { not: params.userMessageId } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY,
  })
  const orderedHistory = history.reverse()

  // Retry idempotency mirrors the live route: a FAILED turn left a trailing
  // identical user row — collapse that ONE duplicate in the PROMPT.
  const lastMessage = orderedHistory[orderedHistory.length - 1]
  const collapseDuplicate = shouldCollapseDuplicateUserMessage(lastMessage, params.message)
  const promptHistory = collapseDuplicate ? orderedHistory.slice(0, -1) : orderedHistory

  const files = await db.codeFile.findMany({
    where: { projectId: params.projectId },
    orderBy: { path: 'asc' },
  })
  const attachmentBlock = await loadGiftzAttachments(job.userId, params.fileIds)

  const userContent = [attachmentBlock, buildProjectContext(files), params.message]
    .filter((s) => s.length > 0)
    .join('\n\n')

  const maxPromptChars = Number(backend.limits.maxPromptChars ?? 12_000)
  const verifyCfg = await verificationConfig()

  const buildTurnMessages = () => [
    { role: 'assistant' as const, content: SYSTEM_PROMPT },
    ...promptHistory.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    })),
    { role: 'user' as const, content: userContent },
  ]

  // ---- Streaming sink + cooperative cancellation --------------------------
  let streamingTransitioned = false
  let cancelled = false
  let lastCancelCheck = Date.now()
  const guard: GenerationGuard = { get aborted() { return cancelled || ctx.signal.aborted } }

  const onEvent = (e: { delta?: string; stage?: string }): void => {
    if (e.delta !== undefined) {
      if (!streamingTransitioned) {
        streamingTransitioned = true
        void transitionJob(job.id, job.workerId, 'streaming')
      }
      void appendJobEventSafe(job.id, 'delta', { delta: e.delta, projectId: params.projectId })
    } else if (e.stage !== undefined) {
      void appendJobEventSafe(job.id, 'stage', { stage: e.stage })
    }
    const now = Date.now()
    if (now - lastCancelCheck > 1_000) {
      lastCancelCheck = now
      void isCancelRequested(job.id).then((c) => {
        if (c) cancelled = true
      })
    }
  }

  try {
    const result: GiftzTurnCoreResult = await runGiftzTurnCore({
      requestText: params.message,
      userContent,
      buildTurnMessages,
      adapter,
      backendRequestMs: backend.timeouts.requestMs,
      maxPromptChars,
      projectId: params.projectId,
      verifyCfg,
      onEvent,
      guard,
    })

    if (cancelled || ctx.signal.aborted) {
      await settleCancelled(job)
      return { result: {} }
    }

    await transitionJob(job.id, job.workerId, 'finalizing')
    const { messageId } = await persistGiftzAssistantTurn(
      params.projectId,
      result,
      verifyCfg.verificationModel,
    )
    await recordUsage({
      userId: job.userId,
      product: 'code-giftz',
      backendId: servedBy.backendId,
      kind: 'coding-task',
      tokensIn: result.tokensInEst,
      tokensOut: result.tokensOutEst,
      durationMs: result.durationMs,
      success: true,
    })
    await recordAudit({
      actorId: job.userId,
      action: 'code-giftz.background_job',
      target: job.id,
      meta: { projectId: params.projectId, files: result.changes.length },
    })

    const done = await finishCompletedRow(job, {
      projectId: params.projectId,
      messageId,
      changes: result.changes.map((c) => ({ path: c.path, change: c.change })),
      contentChars: result.content.length,
      continuations: result.continuationCount,
      verification: publicVerificationSummary(result.verification),
      durationMs: Date.now() - startedAt,
    })
    if (done) {
      await appendJobEventSafe(job.id, 'artifact', {
        projectId: params.projectId,
        messageId,
        files: result.changes.map((c) => c.path),
      })
    }
    return { result: {} }
  } catch (e) {
    if (cancelled || ctx.signal.aborted) {
      await settleCancelled(job)
      return { result: {} }
    }
    const failure = classifyJobFailure(e)
    logger.warn('engine.giftz_coding_failed', {
      jobId: job.id,
      projectId: params.projectId,
      code: failure.errorCode,
      message: failure.errorMessage,
    })
    return failure
  }
}

async function settleCancelled(job: ClaimedJob): Promise<void> {
  await db.generationJob
    .updateMany({
      where: { id: job.id, workerId: job.workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: {
        status: 'cancelled',
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled while generating.',
        finishedAt: new Date(),
      },
    })
    .catch(() => undefined)
}

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
