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

// ---------------------------------------------------------------------------
// BACKGROUND coding-turn recorder (specialist-coverage milestone).
//
// The file-op recorder above covers the user-CONFIRMED execute route. The
// BACKGROUND coding handler (ai-engine giftz-coding-handler) performs the
// other real coding path: a full turn whose accepted file-fences are applied
// to the project workspace. This recorder gives that path the SAME shared
// ledger contract — same lifecycle, same receipt composition, same honesty
// rules. It is NOT a second receipt system: it composes the identical
// TrustTask/Step/Evidence rows through src/lib/trust/tasks.ts.
//
// Honesty contract:
//  - the receipt settles from the turn's ACTUAL result: applied mutations,
//    the version/diff reference, and the self-verification outcome;
//  - a turn whose self-verification was disabled or could not establish
//    correctness settles completed_with_limitations — never plain completed;
//  - a failure AFTER content was produced records which mutations were
//    actually applied (WorkspaceApplyError.appliedSoFar) — the workspace is
//    never claimed untouched unless that is established;
//  - a cancellation observed AFTER the turn applied its files records those
//    applied mutations in the cancel note — cancellation never erases them.
// ---------------------------------------------------------------------------

export interface CodeGiftzBackgroundRecorderInput {
  userId: string
  projectId: string
  projectName?: string | null
  jobId: string
  /** Bounded request preview (the owner's own message text). */
  requestPreview: string
  /** Workspace files loaded as context (files inspected, not modified). */
  filesInspected: number
}

export interface CodeGiftzBackgroundTurnResult {
  /** Files actually applied by the turn (bounded refs — never content). */
  changes: Array<{ path: string; change: 'added' | 'modified' }>
  versionSeq?: number
  /** Public self-verification summary (null when skipped/unavailable). */
  verification: { status: string; attempts: number; corrections: number; issuesFound: number } | null
  /** Explicit reason when verification did not run. */
  verificationSkippedReason?: string | null
  continuations: number
  durationMs: number
}

export interface CodeGiftzBackgroundRecorder {
  readonly taskId: string | null
  /** Create the task + planned steps and start it (best-effort). */
  begin(): Promise<void>
  /** Settle honestly from the turn's ACTUAL result. */
  executed(result: CodeGiftzBackgroundTurnResult): Promise<void>
  /**
   * Settle as cancelled. `turnCompleted` carries the applied mutations when
   * cancellation was observed only AFTER the turn had already applied them —
   * the receipt must keep that truth visible.
   */
  cancelled(note: string, turnCompleted?: { applied: Array<{ path: string; change: string }> } | null): Promise<void>
  /**
   * Settle as failed. `applied` carries mutations actually applied before the
   * failure (empty/null = established that nothing was applied only when the
   * failure happened before the apply stage).
   */
  failed(failure: { code?: string; message: string }, applied?: Array<{ path: string; change: string }> | null, appliedEstablished?: boolean): Promise<void>
}

const BG_STEP_SEQ: Record<string, number> = {
  generation: 1,
  verification: 2,
  delivery: 3,
}

export function createCodeGiftzBackgroundRecorder(input: CodeGiftzBackgroundRecorderInput): CodeGiftzBackgroundRecorder {
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
          title: `Background coding turn — ${(input.projectName ?? 'project').slice(0, TRUST_LIMITS.title - 26)}`,
          requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
          projectId: input.projectId,
          jobId: input.jobId,
          status: 'planned',
        },
      })
      taskId = task.id
      await planTrustSteps(taskId, [
        { kind: 'generation', title: 'Coding turn (background execution)' },
        { kind: 'verification', title: 'Self-verification pass' },
        { kind: 'delivery', title: 'Workspace persistence (files + version)' },
      ])
      await addTrustEvidence(taskId, {
        kind: 'tool-output',
        stepSeq: BG_STEP_SEQ.generation,
        ref: `code-project:${input.projectId}`,
        title: `Workspace context loaded (${input.filesInspected} file(s) inspected, none modified by loading)`,
        origin: 'extracted',
      })
      await startTrustTask(taskId)
    })

  const executed = async (result: CodeGiftzBackgroundTurnResult): Promise<void> =>
    guard('executed', async () => {
      if (!taskId) return
      const changes = result.changes.slice(0, EVIDENCE_CAP)

      // Generation step: what the turn actually produced (counts only).
      await updateStepDone(taskId, BG_STEP_SEQ.generation, JSON.stringify({
        continuations: result.continuations,
        durationMs: result.durationMs,
        changesProposed: result.changes.length,
      }).slice(0, TRUST_LIMITS.detailJson))

      // Verification step: the executor's OWN self-verification outcome —
      // recorded exactly (ran+passed / ran+unconfirmed / did not run).
      const verificationRan = result.verification !== null
      await updateTrustStepStatus(
        taskId,
        BG_STEP_SEQ.verification,
        verificationRan ? 'done' : 'skipped',
        {
          ...(verificationRan ? { detailJson: JSON.stringify(result.verification).slice(0, TRUST_LIMITS.detailJson) } : {}),
          ...(verificationRan ? {} : { errorNote: (result.verificationSkippedReason ?? 'self-verification did not run').slice(0, TRUST_LIMITS.noteField) }),
        },
      )

      // Delivery step: what actually landed in the workspace.
      await updateTrustStepStatus(
        taskId,
        BG_STEP_SEQ.delivery,
        'done',
        {
          detailJson: JSON.stringify({
            applied: changes,
            versionSeq: result.versionSeq ?? null,
            appliedCount: result.changes.length,
          }).slice(0, TRUST_LIMITS.detailJson),
        },
      )
      for (const c of changes) {
        await addTrustEvidence(taskId, {
          kind: 'artifact',
          stepSeq: BG_STEP_SEQ.delivery,
          ref: `code-file:${c.path}`,
          title: `${c.change} ${c.path}`,
          origin: 'extracted',
        })
      }
      if (result.versionSeq !== undefined) {
        await addTrustEvidence(taskId, {
          kind: 'artifact',
          stepSeq: BG_STEP_SEQ.delivery,
          ref: `code-project-version:${input.projectId}#${result.versionSeq}`,
          title: `Workspace version #${result.versionSeq} (diff reference)`,
          origin: 'extracted',
        })
      }

      // Honest settlement: build/test were NOT run by this turn (they are
      // separate, individually verified tasks); an unverified turn never
      // settles as plain completed.
      const limitations: string[] = [
        'Project build and tests were not run by this turn; use the build/preview check for a verified run.',
      ]
      const vStatus = result.verification?.status
      let outcome: 'completed' | 'completed_with_limitations'
      let verificationSummary: string
      if (!verificationRan) {
        outcome = 'completed_with_limitations'
        limitations.push(`Self-verification did not run (${result.verificationSkippedReason ?? 'disabled or unavailable'}); the answer was not independently verified.`)
        verificationSummary = 'The turn completed its coding work, but the self-verification pass did not run, so correctness was never established.'
      } else if (vStatus === 'verified' || vStatus === 'corrected') {
        outcome = 'completed'
        verificationSummary = `Self-verification ran to a definitive result (status=${vStatus}, attempts=${result.verification!.attempts}, corrections=${result.verification!.corrections}). Structural checks confirm the turn's own consistency, not project build/test success.`
      } else {
        outcome = 'completed_with_limitations'
        limitations.push(`Self-verification could not establish correctness (status=${vStatus ?? 'unknown'}); the reply is the best available answer, not a verified one.`)
        verificationSummary = `The turn completed its coding work; self-verification ended at status=${vStatus ?? 'unknown'} (${result.verification!.issuesFound} issue(s) found on the final pass), so correctness was not established.`
      }
      if (result.changes.length === 0) {
        limitations.push('The turn changed no workspace files (a conversational answer only).')
      }

      await finalizeTrustTask(taskId, {
        outcome,
        outcomeSummary: `The background coding turn finished (${result.changes.length} file(s) changed, reply persisted).`,
        verificationSummary: verificationSummary.slice(0, TRUST_LIMITS.summaryField),
        limitations: limitations.slice(0, TRUST_LIMITS.limitationsPerTask),
      })
    })

  const cancelled = async (note: string, turnCompleted?: { applied: Array<{ path: string; change: string }> } | null): Promise<void> =>
    guard('cancelled', async () => {
      if (!taskId) return
      const applied = turnCompleted?.applied ?? []
      const suffix = applied.length
        ? ` IMPORTANT: the turn had already applied ${applied.length} workspace change(s) (${applied.slice(0, 6).map((c) => `${c.change} ${c.path}`).join(', ')}${applied.length > 6 ? ', …' : ''}) before the cancellation was observed — those changes remain in the workspace and the assistant reply was not persisted.`
        : ' No workspace changes were applied by this turn.'
      await cancelTrustTask(taskId, `${note.slice(0, Math.max(1, TRUST_LIMITS.summaryField - suffix.length))}${suffix}`.slice(0, TRUST_LIMITS.summaryField))
    })

  const failed = async (
    failure: { code?: string; message: string },
    applied?: Array<{ path: string; change: string }> | null,
    appliedEstablished?: boolean,
  ): Promise<void> =>
    guard('failed', async () => {
      if (!taskId) return
      const appliedList = applied ?? []
      const known = appliedEstablished !== false
      const note = `${failure.code ?? 'ERROR'}: ${failure.message}`.slice(0, TRUST_LIMITS.summaryField)
      // Failure during the apply stage carries the mutations that DID land —
      // the workspace is never claimed untouched unless that is established.
      const suffix = known && appliedList.length
        ? ` (${appliedList.length} workspace change(s) were already applied before the failure: ${appliedList.slice(0, 6).map((c) => `${c.change} ${c.path}`).join(', ')}${appliedList.length > 6 ? ', …' : ''} — they remain in the workspace.)`
        : known
          ? ' (No workspace changes were applied by this turn.)'
          : ''
      const limitations: string[] = []
      if (known && appliedList.length) {
        limitations.push(`The turn failed after applying ${appliedList.length} workspace change(s); those changes remain in the workspace.`)
        for (const c of appliedList.slice(0, EVIDENCE_CAP)) {
          await addTrustEvidence(taskId, {
            kind: 'artifact',
            stepSeq: BG_STEP_SEQ.delivery,
            ref: `code-file:${c.path}`,
            title: `${c.change} ${c.path} (applied before failure)`,
            origin: 'extracted',
          }).catch(() => undefined)
        }
      } else if (known) {
        limitations.push('The turn failed before any workspace change was applied.')
      } else {
        limitations.push('The turn failed at a stage where the applied-change state could not be established; inspect the workspace version history.')
      }
      limitations.push('The assistant reply was not persisted for this failed turn.')
      await failTrustTask(taskId, {
        failureNote: `${note}${suffix}`.slice(0, TRUST_LIMITS.summaryField),
        limitations: limitations.slice(0, TRUST_LIMITS.limitationsPerTask),
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
