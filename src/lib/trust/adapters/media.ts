/**
 * BEAN Intelligence — LAXII / JAZMII Trust Engine adapter (media tasks).
 *
 * One receipt per finished media job, recorded from the worker's ACTUAL
 * result: the delivered artifact reference, the measured facts, and the
 * product's OWN validation result. Honesty contract:
 *
 *   - a generated file is NEVER labeled verified merely because it exists:
 *     the receipt carries the applicable product validation — the video
 *     worker's ffprobe-measured stream facts, the image worker's bounded
 *     vision check — and when that validation did not run, the receipt says
 *     so with an explicit limitation instead of a verification claim;
 *   - validation defects are limitations, never silently dropped;
 *   - no paid GPU dependencies are introduced; the receipt records the
 *     backend that actually served the job;
 *   - secrets never enter the ledger: bounded request previews only.
 *
 * Best-effort by contract: recording failures are logged and never break the
 * worker. SERVER-ONLY.
 */

import { logger } from '@/lib/observability/logger'
import { db } from '@/lib/db'
import { TRUST_LIMITS } from '@/lib/trust/types'
import {
  addTrustEvidence,
  cancelTrustTask,
  createTrustTask,
  failTrustTask,
  finalizeTrustTask,
  planTrustSteps,
  startTrustTask,
  updateTrustStepStatus,
} from '@/lib/trust/tasks'

export interface MediaStreamFacts {
  codec?: string
  width?: number
  height?: number
  durationSec?: number
  frames?: number
  fps?: number
  validatedBy?: string // e.g. 'ffprobe'
}

export interface MediaVerificationReport {
  checked?: boolean
  method?: string
  defects?: unknown[]
  observation?: string
  reason?: string
  correction?: {
    attempted?: boolean
    applied?: boolean
    note?: string
  }
}

export interface MediaReceiptResult {
  /** The delivered artifact URL as served by the product. */
  artifactUrl?: string
  assetId?: string | null
  width?: number
  height?: number
  format?: string
  bytes?: number
  durationMs?: number
  /** Video: ffprobe-measured stream facts (real validation). */
  stream?: MediaStreamFacts | null
  /** Image: the bounded vision check report (real validation). */
  verification?: MediaVerificationReport | null
  /**
   * Image PROCESSING ops (enhancement / edit / background removal): the
   * executor's measured preservation report — pixel-level facts about what
   * the operation changed relative to the input. Real validation, distinct
   * from the generative vision check.
   */
  preservation?: MediaPreservationFacts | null
  /** Processing ops: the source asset the operation started from. */
  sourceUrl?: string | null
  /** Processing ops: the measured difference-map artifact, when produced. */
  diffUrl?: string | null
  /** Processing ops: the requested operation mode (e.g. background-removal). */
  mode?: string | null
}

/** Bounded, measured facts from the executor's preservation validation. */
export interface MediaPreservationFacts {
  pipeline?: string
  generativeUsed?: boolean
  exactPreservedPct?: number
  blendedPct?: number
  changedPct?: number
  dimensionsChanged?: boolean
  identityPassed?: boolean | null
  identityMetric?: string | null
  summary?: string
}

export interface MediaJobFailure {
  errorCode?: string | null
  errorMessage?: string | null
  errorClass?: string | null
}

export type MediaJobKind =
  | 'image-generation'
  | 'image-enhancement'
  | 'image-editing'
  | 'video-generation'

export interface MediaJobInput {
  userId: string
  product: 'laxii' | 'jazmii'
  kind: MediaJobKind
  jobId: string
  conversationId?: string | null
  projectId?: string | null
  backendId?: string | null
  /** Bounded request description (prompt preview is the owner's own data). */
  requestPreview: string
}

const MEDIA_STEPS = [
  { kind: 'generation' as const, seq: 1, title: 'Media generation' },
  { kind: 'verification' as const, seq: 2, title: 'Artifact validation' },
]

const TERMINAL_TASK_STATUSES = [
  'completed',
  'completed_with_limitations',
  'partially_completed',
  'failed',
  'cancelled',
] as const

/**
 * Idempotent settlement guard (milestone contract: two concurrent workers
 * must never settle one job into two receipts, and a late replayed event
 * must not mutate a terminal record). Looks up the receipt task already
 * recorded for this job: a terminal task means the outcome is already
 * settled — return null so the caller records nothing; an active task (a
 * pre-created ledger, e.g. the director orchestration) is returned for the
 * caller to settle; none exists → null (the caller creates its own).
 */
async function existingReceiptTaskForJob(jobId: string): Promise<{ id: string; status: string } | null> {
  const rows = await db.trustTask.findMany({
    where: { jobId },
    orderBy: { createdAt: 'desc' },
    take: 1,
  })
  const task = rows[0]
  if (!task) return null
  return { id: task.id, status: task.status }
}

/** True when a receipt for this job is already settled — recording must stop. */
async function jobReceiptAlreadySettled(jobId: string): Promise<boolean> {
  try {
    const existing = await existingReceiptTaskForJob(jobId)
    return existing !== null && (TERMINAL_TASK_STATUSES as readonly string[]).includes(existing.status)
  } catch {
    return false // the lookup must never break the worker's own settle path
  }
}

async function guard(method: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logger.warn('trust.record_failed', {
      method,
      product: 'media',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Record the full receipt for a COMPLETED media job and settle it honestly
 * from the actual result + the applicable validation.
 */
export async function recordMediaJobCompletion(input: MediaJobInput, result: MediaReceiptResult): Promise<void> {
  await guard('recordMediaJobCompletion', async () => {
    if (await jobReceiptAlreadySettled(input.jobId)) return
    const task = await createTrustTask({
      userId: input.userId,
      product: input.product,
      kind: input.kind,
      title: `${input.kind} — delivered artifact`,
      requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
      jobId: input.jobId,
      conversationId: input.conversationId ?? undefined,
      projectId: input.projectId ?? undefined,
    })
    await planTrustSteps(task.id, MEDIA_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)

    // Generation step: what was actually produced (measured facts only).
    await updateTrustStepStatus(task.id, MEDIA_STEPS[0].seq, 'done', {
      detailJson: JSON.stringify({
        artifactUrl: result.artifactUrl ?? null,
        assetId: result.assetId ?? null,
        width: result.width ?? null,
        height: result.height ?? null,
        format: result.format ?? null,
        bytes: result.bytes ?? null,
        durationMs: result.durationMs ?? null,
      }).slice(0, TRUST_LIMITS.detailJson),
    })

    // Evidence: the delivered artifact (reference, never a copy).
    if (result.artifactUrl) {
      await addTrustEvidence(task.id, {
        kind: 'artifact',
        stepSeq: MEDIA_STEPS[0].seq,
        ref: result.artifactUrl.slice(0, TRUST_LIMITS.refChars),
        title: `Delivered ${input.kind === 'video-generation' ? 'video' : 'image'} artifact`,
        note: [
          result.format ? `format=${result.format}` : null,
          result.bytes !== undefined ? `bytes=${result.bytes}` : null,
          result.width && result.height ? `dimensions=${result.width}x${result.height}` : null,
        ].filter(Boolean).join('; ') || undefined,
        origin: 'extracted',
      })
    }
    // Processing ops carry their source + measured difference map as evidence.
    if (input.kind === 'image-enhancement' || input.kind === 'image-editing') {
      await addProcessingArtifactEvidence(task.id, input, result)
    }

    // Validation: the product's OWN applicable check — video stream facts
    // (ffprobe) or the image vision report. Checked vs skipped is stated
    // exactly; a file alone is never a verification claim.
    const limitations: string[] = []
    let verificationSummary: string
    let outcome: 'completed' | 'completed_with_limitations' = 'completed'

    if (input.kind === 'video-generation' && result.stream) {
      const facts = result.stream
      await updateTrustStepStatus(task.id, MEDIA_STEPS[1].seq, 'done', {
        detailJson: JSON.stringify(facts).slice(0, TRUST_LIMITS.detailJson),
      })
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: MEDIA_STEPS[1].seq,
        ref: result.artifactUrl ?? input.jobId,
        title: 'ffprobe-measured stream facts',
        note: [
          facts.codec ? `codec=${facts.codec}` : null,
          facts.width && facts.height ? `dimensions=${facts.width}x${facts.height}` : null,
          facts.durationSec !== undefined ? `durationSec=${facts.durationSec}` : null,
          `validatedBy=${facts.validatedBy ?? 'unknown'}`,
        ].filter(Boolean).join('; '),
        origin: 'extracted',
      })
      if (facts.validatedBy === 'ffprobe') {
        verificationSummary = `Artifact persisted and validated with ffprobe stream measurements: codec=${facts.codec ?? 'unknown'}, dimensions=${facts.width ?? '?'}x${facts.height ?? '?'}, durationSec=${facts.durationSec ?? 'unknown'}.`
      } else {
        outcome = 'completed_with_limitations'
        limitations.push('The delivered video file exists but no ffprobe stream validation was recorded for it; no playback-quality claim is made.')
        verificationSummary = 'Artifact persisted; automated stream validation did not run, so no playback-quality claim is made.'
      }
    } else if (input.kind === 'image-generation' && result.verification) {
      // (image-generation keeps its own bounded vision check below)
      const report = result.verification
      await updateTrustStepStatus(
        task.id,
        MEDIA_STEPS[1].seq,
        report.checked ? 'done' : 'skipped',
        {
          detailJson: JSON.stringify(report).slice(0, TRUST_LIMITS.detailJson),
          ...(report.checked ? {} : { errorNote: (report.reason ?? 'validation did not run').slice(0, TRUST_LIMITS.noteField) }),
        },
      )
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: MEDIA_STEPS[1].seq,
        ref: result.artifactUrl ?? input.jobId,
        title: 'Bounded vision check report',
        note: [
          `checked=${report.checked === true}`,
          report.method ? `method=${report.method}` : null,
          Array.isArray(report.defects) ? `defects=${report.defects.length}` : null,
        ].filter(Boolean).join('; '),
        origin: 'extracted',
      })
      if (report.checked) {
        verificationSummary = `Artifact persisted and passed through the product's bounded vision check (method=${report.method ?? 'unknown'}); ${Array.isArray(report.defects) ? report.defects.length : 0} defect(s) reported.`
        if (Array.isArray(report.defects) && report.defects.length > 0) {
          outcome = 'completed_with_limitations'
          limitations.push(`The vision check reported ${report.defects.length} defect(s) on the delivered artifact; they are reported, not hidden.`.slice(0, TRUST_LIMITS.limitationChars))
        }
        if (report.correction?.attempted) {
          limitations.push(
            `One bounded targeted correction was attempted${report.correction.applied ? ' and applied (fewer serious defects after re-check)' : ' but the ORIGINAL image was kept: the correction did not verifiably reduce the serious defects'}.`.slice(0, TRUST_LIMITS.limitationChars),
          )
        }
      } else {
        outcome = 'completed_with_limitations'
        limitations.push(`The delivered image exists but the bounded vision check did not run (${report.reason ?? 'no reason recorded'}); no quality claim is made.`.slice(0, TRUST_LIMITS.limitationChars))
        verificationSummary = 'Artifact persisted; the vision check did not run, so no quality claim is made.'
      }
    } else if (
      (input.kind === 'image-enhancement' || input.kind === 'image-editing') &&
      result.preservation
    ) {
      // Image PROCESSING ops: the executor's measured preservation report is
      // the applicable validation — pixel-level facts, not a quality claim.
      const facts = result.preservation
      await updateTrustStepStatus(task.id, MEDIA_STEPS[1].seq, 'done', {
        detailJson: JSON.stringify(facts).slice(0, TRUST_LIMITS.detailJson),
      })
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: MEDIA_STEPS[1].seq,
        ref: result.artifactUrl ?? input.jobId,
        title: 'Measured preservation report',
        note: [
          facts.pipeline ? `pipeline=${facts.pipeline}` : null,
          facts.exactPreservedPct !== undefined ? `exactPreservedPct=${facts.exactPreservedPct}` : null,
          facts.changedPct !== undefined ? `changedPct=${facts.changedPct}` : null,
          `generativeUsed=${facts.generativeUsed === true}`,
        ].filter(Boolean).join('; '),
        origin: 'extracted',
      })
      verificationSummary =
        `Artifact persisted and measured against its source` +
        (facts.pipeline ? ` (pipeline=${facts.pipeline})` : '') +
        `: exactPreservedPct=${facts.exactPreservedPct ?? 'n/a'}, ` +
        `changedPct=${facts.changedPct ?? 'n/a'}, generativeUsed=${facts.generativeUsed === true}. ` +
        'This is a structural preservation measurement — it is not a claim that the edit is aesthetically correct.'
      if (facts.dimensionsChanged) {
        // A usable result whose geometry differs from the source is a known
        // limitation of THAT result — completed_with_limitations, per the
        // honest outcome mapping (never silently omitted).
        outcome = 'completed_with_limitations'
        limitations.push('The operation changed the image dimensions relative to its input.')
      }
      if (facts.identityPassed === false) {
        outcome = 'completed_with_limitations'
        limitations.push('The identity metric ran and did NOT pass; the output may not preserve subject identity.')
      }
    } else {
      await updateTrustStepStatus(
        task.id,
        MEDIA_STEPS[1].seq,
        'skipped',
        {
          errorNote:
            input.kind === 'video-generation'
              ? 'no ffprobe stream facts were recorded for this artifact'
              : 'no image verification report was recorded for this artifact',
        },
      )
      outcome = 'completed_with_limitations'
      limitations.push(
        input.kind === 'video-generation'
          ? 'The video file exists and was persisted, but no ffprobe stream validation was recorded for it; no playback-quality claim is made.'
          : 'The image file exists and was persisted, but no bounded verification was recorded for it; no quality claim is made.',
      )
      verificationSummary = 'Artifact persisted; automated validation did not run, so no quality claim is made.'
    }

    if (outcome === 'completed_with_limitations' && limitations.length === 0) {
      limitations.push('Completed with limitations; see the verification summary for exactly what was and was not checked.')
    }
    await finalizeTrustTask(task.id, {
      outcome,
      outcomeSummary: `The ${input.kind} job delivered its artifact${result.artifactUrl ? '' : ' (artifact URL not recorded)'}.`,
      verificationSummary: verificationSummary.slice(0, TRUST_LIMITS.summaryField),
      limitations: limitations.slice(0, TRUST_LIMITS.limitationsPerTask),
    })
  })
}

/** Evidence refs for the processing ops' supporting artifacts. */
async function addProcessingArtifactEvidence(taskId: string, input: MediaJobInput, result: MediaReceiptResult): Promise<void> {
  if (result.sourceUrl) {
    await addTrustEvidence(taskId, {
      kind: 'artifact',
      stepSeq: MEDIA_STEPS[0].seq,
      ref: result.sourceUrl.slice(0, TRUST_LIMITS.refChars),
      title: 'Source asset the operation started from',
      origin: 'extracted',
    })
  }
  if (result.diffUrl) {
    await addTrustEvidence(taskId, {
      kind: 'artifact',
      stepSeq: MEDIA_STEPS[1].seq,
      ref: result.diffUrl.slice(0, TRUST_LIMITS.refChars),
      title: 'Measured difference map (input vs output)',
      origin: 'extracted',
    })
  }
}

/** Record a FAILED media job (truthful note; nothing delivered). */
export async function recordMediaJobFailure(input: MediaJobInput, failure: MediaJobFailure): Promise<void> {
  await guard('recordMediaJobFailure', async () => {
    if (await jobReceiptAlreadySettled(input.jobId)) return
    const task = await createTrustTask({
      userId: input.userId,
      product: input.product,
      kind: input.kind,
      title: `${input.kind} — failed`,
      requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
      jobId: input.jobId,
      conversationId: input.conversationId ?? undefined,
      projectId: input.projectId ?? undefined,
    })
    await planTrustSteps(task.id, MEDIA_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)
    await updateTrustStepStatus(
      task.id,
      MEDIA_STEPS[0].seq,
      'failed',
      {
        errorNote: (failure.errorMessage ?? failure.errorCode ?? 'the generation failed before an artifact was produced').slice(0, TRUST_LIMITS.noteField),
      },
    )
    await updateTrustStepStatus(task.id, MEDIA_STEPS[1].seq, 'skipped')
    await failTrustTask(task.id, {
      failureNote: `${failure.errorCode ?? failure.errorClass ?? 'ERROR'}: ${failure.errorMessage ?? 'the generation failed before an artifact was produced'}`.slice(0, TRUST_LIMITS.summaryField),
      limitations: ['No artifact was delivered; nothing was persisted as a completed media result.'],
    })
  })
}

/** Record a CANCELLED media job (honest cancel note; no artifact delivered). */
export async function recordMediaJobCancelled(input: MediaJobInput, when: string): Promise<void> {
  await guard('recordMediaJobCancelled', async () => {
    if (await jobReceiptAlreadySettled(input.jobId)) return
    const task = await createTrustTask({
      userId: input.userId,
      product: input.product,
      kind: input.kind,
      title: `${input.kind} — cancelled`,
      requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
      jobId: input.jobId,
      conversationId: input.conversationId ?? undefined,
      projectId: input.projectId ?? undefined,
    })
    await planTrustSteps(task.id, MEDIA_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)
    await updateTrustStepStatus(task.id, MEDIA_STEPS[0].seq, 'skipped')
    await updateTrustStepStatus(task.id, MEDIA_STEPS[1].seq, 'skipped')
    await cancelTrustTask(
      task.id,
      `Generation cancelled by the user ${when} it completed (no artifact was delivered).`.slice(0, TRUST_LIMITS.summaryField),
    )
  })
}
