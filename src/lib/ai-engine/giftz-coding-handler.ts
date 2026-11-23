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
import { WorkspaceApplyError } from '@/lib/giftz/workspace'
import { createCodeGiftzBackgroundRecorder, type CodeGiftzBackgroundTurnResult } from '@/lib/trust/adapters/code-giftz'
import type { GenerationGuard } from '@/lib/giftz/chat-stream'
import { isCancelRequested } from './queue'
import { appendJobEventSafe } from './events'
import { transitionJob } from './queue'
import { classifyJobFailure } from './classify'
import { buildTechDocsWithReach } from '@/lib/intel/techdocs-reach'
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

  // Trust Engine (specialist-coverage milestone): the background coding turn
  // gets the SAME shared receipt contract as the confirmed file-op route —
  // one receipt per executed turn, settled from the ACTUAL result (best-
  // effort: recording never breaks the coding execution).
  const trust = createCodeGiftzBackgroundRecorder({
    userId: job.userId,
    projectId: params.projectId,
    projectName: project.title,
    jobId: job.id,
    requestPreview: params.message,
    filesInspected: files.length,
  })
  await trust.begin()

  // BEAN Intelligence: live official-docs retrieval (identical to the live
  // route's behavior). Bounded; failure degrades honestly to model knowledge
  // with no source claimed. Reference data only — never executed.
  const { techDocs, research } = await buildTechDocsWithReach(params.message, job.userId)
  if (techDocs?.degraded.length) {
    logger.warn('engine.giftz_techdocs_degraded', { jobId: job.id, degraded: techDocs.degraded })
  }

  const userContent = [attachmentBlock, buildProjectContext(files), techDocs?.block ?? '', params.message]
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

  // The public self-verification summary plus the explicit skip reason when
  // the pass did not run — the receipt never implies a check that did not run.
  function verificationReceiptFields(result: GiftzTurnCoreResult): {
    verification: CodeGiftzBackgroundTurnResult['verification']
    verificationSkippedReason: string | null
  } {
    const publicSummary = publicVerificationSummary(result.verification)
    if (publicSummary) {
      return { verification: publicSummary, verificationSkippedReason: null }
    }
    if (!verifyCfg.enabled) {
      return { verification: null, verificationSkippedReason: 'self-verification is disabled by the operator configuration' }
    }
    return {
      verification: null,
      verificationSkippedReason:
        result.verification && result.verification.status === 'skipped'
          ? `self-verification was skipped${result.verification.reason ? `: ${result.verification.reason}` : ''}`
          : 'self-verification produced no usable result',
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
      // The turn had ALREADY applied its files when cancellation was observed
      // — the receipt keeps that truth visible (cancellation never erases it).
      await trust.cancelled('Cancelled at your request.', {
        applied: result.changes.map((c) => ({ path: c.path, change: c.change })),
      })
      await settleCancelled(job)
      return { result: {} }
    }

    await transitionJob(job.id, job.workerId, 'finalizing')
    const { messageId } = await persistGiftzAssistantTurn(
      params.projectId,
      result,
      verifyCfg.verificationModel,
    )
    const receiptFields = verificationReceiptFields(result)
    await trust.executed({
      changes: result.changes.map((c) => ({ path: c.path, change: c.change })),
      ...(result.versionSeq !== undefined ? { versionSeq: result.versionSeq } : {}),
      verification: receiptFields.verification,
      verificationSkippedReason: receiptFields.verificationSkippedReason,
      continuations: result.continuationCount,
      durationMs: result.durationMs,
      // M33: a chat-requested REAL sandbox run is part of the truthful
      // receipt — bounded references (status/exit/duration), never stdout.
      ...(result.execution
        ? {
            execution: {
              runId: result.execution.runId,
              entry: result.execution.entry,
              status: result.execution.status,
              exitCode: result.execution.exitCode,
              timedOut: result.execution.timedOut,
              durationMs: result.execution.durationMs,
            },
          }
        : {}),
      ...(result.executionUnavailable ? { executionUnavailable: result.executionUnavailable.slice(0, 200) } : {}),
    })
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
      // M22 ADDITIVE: seq of the version recorded for this turn (absent when
      // nothing changed or the snapshot was skipped).
      ...(result.versionSeq !== undefined ? { versionSeq: result.versionSeq } : {}),
      verification: publicVerificationSummary(result.verification),
      // M33 ADDITIVE: real sandbox execution outcome (bounded — no stdout).
      ...(result.execution
        ? {
            execution: {
              runId: result.execution.runId,
              entry: result.execution.entry,
              status: result.execution.status,
              exitCode: result.execution.exitCode,
              timedOut: result.execution.timedOut,
              durationMs: result.execution.durationMs,
            },
          }
        : {}),
      ...(result.executionUnavailable ? { executionUnavailable: result.executionUnavailable.slice(0, 200) } : {}),
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
    // Mutations actually applied before the failure: WorkspaceApplyError
    // carries the exact list (the apply loop is per-file). Any OTHER error
    // happened before the apply stage, so no mutation was even attempted —
    // the receipt can state that truthfully.
    const appliedFromError =
      e instanceof WorkspaceApplyError
        ? e.appliedSoFar.map((c) => ({ path: c.path, change: c.change }))
        : null
    if (cancelled || ctx.signal.aborted) {
      await trust.cancelled(
        'Cancelled while generating.',
        appliedFromError ? { applied: appliedFromError } : null,
      )
      await settleCancelled(job)
      return { result: {} }
    }
    const failure = classifyJobFailure(e)
    await trust.failed(
      { code: failure.errorCode, message: failure.errorMessage ?? 'The background coding turn failed.' },
      appliedFromError,
      true,
    )
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
