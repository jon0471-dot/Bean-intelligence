/**
 * BEAN Intelligence — CODE GIFTZ Trust Engine adapter.
 *
 * Turns every executed CODE GIFTZ file operation (the user-confirmed coding
 * action) into a real, inspectable execution receipt: the change plan, the
 * files actually modified, the executor's own verification result and the
 * version/diff reference become ledger rows with provenance.
 *
 * Honesty contract (never pretend):
 *   - a task is NEVER settled as completed merely because files were written:
 *     the settlement carries the executor's ACTUAL verification result
 *     (contents preserved, remaining references, exact per-mutation outcomes,
 *     failures) and an explicit limitation for what was NOT verified
 *     (project build/tests are separate, individually verified tasks);
 *   - a replayed result (idempotent re-submit) says so in the receipt;
 *   - failures keep their truthful typed message;
 *   - captures never include file content beyond bounded references — no
 *     secrets, no tokens.
 *
 * Best-effort by contract: recording failures are logged and never break the
 * coding operation itself. SERVER-ONLY.
 */

import { logger } from '@/lib/observability/logger'
import { db } from '@/lib/db'
import {
  TRUST_LIMITS,
} from '@/lib/trust/types'
import { addTrustEvidence, finalizeTrustTask, failTrustTask, planTrustSteps, startTrustTask, updateTrustStepStatus, cancelTrustTask } from '@/lib/trust/tasks'

interface AppliedLike {
  from?: string
  to?: string
  path?: string
  action: string
}

interface FileOpResultLike {
  opId: string
  kind: string
  applied: AppliedLike[]
  failed: Array<{ path?: string; from?: string; error?: string; message?: string }>
  versionSeq: number | null
  verification: {
    contentsPreserved: boolean
    remainingReferences?: number
    detail?: string
  }
  replayed?: boolean
}

export interface CodeGiftzFileOpRecorderInput {
  userId: string
  projectId: string
  projectName?: string | null
  opId: string
  planHash: string
  kind: string
  /** Bounded, customer-displayable description of the requested change. */
  requestPreview: string
}

/** The three coding-task receipt steps. */
const STEP_SEQ: Record<string, number> = {
  plan: 1,
  modification: 2,
  verification: 3,
}

const EVIDENCE_CAP = 20

export interface CodeGiftzFileOpRecorder {
  readonly taskId: string | null
  /** Create the task + planned steps and start it (best-effort). */
  begin(): Promise<void>
  /** Settle honestly from the ACTUAL executor result. */
  executed(result: FileOpResultLike): Promise<void>
  /** Settle as cancelled (operation cancelled before execution). */
  cancelled(note: string): Promise<void>
  /** Settle as failed with the truthful typed failure. */
  failed(failure: { code?: string; message: string }): Promise<void>
}

export function createCodeGiftzFileOpRecorder(input: CodeGiftzFileOpRecorderInput): CodeGiftzFileOpRecorder {
  let taskId: string | null = null

  const guard = async (method: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      logger.warn('trust.record_failed', {
        taskId: taskId ?? undefined,
        method,
        product: 'code-giftz',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const begin = async (): Promise<void> =>
    guard('begin', async () => {
      const task = await db.trustTask.create({
        data: {
          userId: input.userId,
          product: 'code-giftz',
          kind: 'coding-task',
          title: `${input.kind} — ${(input.projectName ?? 'project').slice(0, TRUST_LIMITS.title - input.kind.length - 4)}`,
          requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
          projectId: input.projectId,
          status: 'planned',
        },
      })
      taskId = task.id
      await planTrustSteps(taskId, [
        { kind: 'plan', title: `Change plan confirmed (${input.kind})`, detailJson: JSON.stringify({ opId: input.opId, planHash: input.planHash }).slice(0, TRUST_LIMITS.detailJson) },
        { kind: 'generation', title: 'Workspace modification' },
        { kind: 'verification', title: 'Executor verification' },
      ])
      await addTrustEvidence(taskId, {
        kind: 'tool-output',
        stepSeq: STEP_SEQ.plan,
        ref: `code-file-op:${input.opId}`,
        title: 'Confirmed change plan (plan-hash bound)',
        note: `planHash=${input.planHash}; the executed action is bound to the exact plan shown for confirmation`,
        origin: 'extracted',
      })
      await startTrustTask(taskId)
    })

  const executed = async (result: FileOpResultLike): Promise<void> =>
    guard('executed', async () => {
      if (!taskId) return
      const replayed = result.replayed === true

      // The confirmed plan was executed: the plan step is done.
      await updateStepDone(taskId, STEP_SEQ.plan, JSON.stringify({ opId: result.opId, replayed }).slice(0, TRUST_LIMITS.detailJson))

      // Step truth from the actual result.
      await updateStepDone(taskId, STEP_SEQ.modification, JSON.stringify({
        applied: result.applied.slice(0, EVIDENCE_CAP),
        failed: result.failed.slice(0, 10),
        replayed,
      }).slice(0, TRUST_LIMITS.detailJson))

      // Evidence: every actually-applied file mutation (bounded).
      for (const a of result.applied.slice(0, EVIDENCE_CAP)) {
        const path = a.to ?? a.path ?? a.from
        if (!path) continue
        await addTrustEvidence(taskId, {
          kind: 'artifact',
          stepSeq: STEP_SEQ.modification,
          ref: `code-file:${path}`,
          title: `${a.action} ${path}`.slice(0, TRUST_LIMITS.summaryField),
          origin: 'extracted',
        })
      }
      // Evidence: the recorded version/diff reference (the actual diff lives
      // in the project version ledger; the receipt references, never copies).
      if (result.versionSeq !== null) {
        await addTrustEvidence(taskId, {
          kind: 'artifact',
          stepSeq: STEP_SEQ.verification,
          ref: `code-project-version:${input.projectId}#${result.versionSeq}`,
          title: `Workspace version #${result.versionSeq} (diff reference)`,
          origin: 'extracted',
        })
      }

      // Step verification: the executor's OWN post-execution verification.
      const verificationOk = result.verification.contentsPreserved && result.failed.length === 0
      await updateStepStatus(taskId, STEP_SEQ.verification, verificationOk ? 'done' : 'failed', JSON.stringify({
        contentsPreserved: result.verification.contentsPreserved,
        remainingReferences: result.verification.remainingReferences ?? null,
        detail: result.verification.detail ?? null,
      }).slice(0, TRUST_LIMITS.detailJson), verificationOk ? null : (result.verification.detail ?? 'verification reported an issue').slice(0, TRUST_LIMITS.noteField))

      // Honest settlement. What was verified: the executor's structural
      // checks over the applied mutations. What was NOT: project build/tests
      // (separate, individually verified tasks).
      const limitations: string[] = [
        'Project build and tests were not run by this operation; use the build/preview check for a verified run.',
      ]
      if (replayed) limitations.push('This result was replayed from the recorded operation ledger (idempotent re-submit); the workspace was not mutated again.')
      for (const f of result.failed.slice(0, TRUST_LIMITS.limitationsPerTask - limitations.length)) {
        limitations.push(`Not applied: ${f.path ?? f.from ?? 'unknown'} — ${f.message ?? f.error ?? 'failed'}`.slice(0, TRUST_LIMITS.limitationChars))
      }
      if (!result.verification.contentsPreserved) {
        limitations.push(`Post-execution verification reported an issue: ${result.verification.detail ?? 'details in the verification step'}`.slice(0, TRUST_LIMITS.limitationChars))
      }

      const verificationSummary = (
        replayed
          ? `Replayed recorded result for ${result.kind}: ${result.applied.length} planned mutation(s), ${result.failed.length} failed; executor verification: contentsPreserved=${result.verification.contentsPreserved}, remainingReferences=${result.verification.remainingReferences ?? 'n/a'}.`
          : `Executed ${result.kind} with ${result.applied.length} applied mutation(s) and ${result.failed.length} failure(s); executor verification: contentsPreserved=${result.verification.contentsPreserved}, remainingReferences=${result.verification.remainingReferences ?? 'n/a'}. ${result.verification.detail ?? ''}`
      ).slice(0, TRUST_LIMITS.summaryField)

      const outcome = verificationOk ? 'completed' : 'completed_with_limitations'
      await finalizeTrustTask(taskId, {
        outcome,
        outcomeSummary: (
          replayed
            ? `The confirmed ${result.kind} operation replayed its recorded result; no new mutation was applied.`
            : `The confirmed ${result.kind} operation ran against the project workspace (${result.applied.length} applied, ${result.failed.length} failed).`
        ).slice(0, TRUST_LIMITS.summaryField),
        verificationSummary,
        limitations,
      })
    })

  const cancelled = async (note: string): Promise<void> =>
    guard('cancelled', async () => {
      if (!taskId) return
      await cancelTrustTask(taskId, note.slice(0, TRUST_LIMITS.summaryField))
    })

  const failed = async (failure: { code?: string; message: string }): Promise<void> =>
    guard('failed', async () => {
      if (!taskId) return
      // FileOpError STALE/CONFLICT mean NOTHING was mutated — say exactly that.
      const untouched = failure.code === 'STALE' || failure.code === 'CONFLICT' || failure.code === 'NOT_FOUND'
      // The plan step genuinely happened (plan confirmed and bound); the
      // modification step never ran.
      await updateStepDone(taskId, STEP_SEQ.plan, JSON.stringify({ opId: input.opId, refused: untouched }).slice(0, TRUST_LIMITS.detailJson))
      const note = `${failure.code ?? 'ERROR'}: ${failure.message}`.slice(0, TRUST_LIMITS.summaryField)
      await failTrustTask(taskId, {
        failureNote: untouched ? `${note} (the workspace was left unchanged)` : note,
        limitations: untouched ? ['The workspace was not modified: the operation was refused before any file change.'] : undefined,
      })
    })

  return {
    get taskId() {
      return taskId
    },
    begin,
    executed,
    cancelled,
    failed,
  }
}

// Local step helpers bound to this adapter's fixed seq layout.
async function updateStepStatus(
  taskId: string,
  seq: number,
  status: 'done' | 'failed',
  detailJson: string,
  errorNote: string | null,
): Promise<void> {
  await updateTrustStepStatus(taskId, seq, status, { detailJson, ...(errorNote !== null ? { errorNote } : {}) })
}

async function updateStepDone(taskId: string, seq: number, detailJson: string): Promise<void> {
  await updateStepStatus(taskId, seq, 'done', detailJson, null)
}
