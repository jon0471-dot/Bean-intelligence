/**
 * BEAN Intelligence — GANGZII Trust Engine adapter (audio tasks).
 *
 * One receipt per finished audio job, recorded from the worker's ACTUAL
 * result, following the same honesty contract as the media adapter:
 *
 *   - a produced audio file is NEVER labeled verified merely because it
 *     exists: the receipt carries the applicable product validation — the
 *     ffprobe-measured stream facts for every delivered artifact — and when
 *     a validation did not run, the receipt says so with an explicit
 *     limitation instead of a verification claim;
 *   - speech QUALITY (does it sound good? is the wording right?) is a
 *     HUMAN judgment. The receipt separates: generation succeeded /
 *     technical validation succeeded / content listened and approved —
 *     and never claims the last one unless the owner explicitly approves;
 *   - the ENGINE that actually synthesized the audio (local Kokoro vs
 *     authorized hosted gateway) is recorded per job — never "the backend";
 *   - failures and cancellations carry truthful notes; a cancelled job
 *     that produced partial segment audio has that fact recorded, never
 *     silently discarded;
 *   - secrets never enter the ledger: bounded request previews only.
 *
 * Best-effort by contract: recording failures are logged and never break
 * the worker. SERVER-ONLY.
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

export interface AudioStreamFacts {
  codec?: string
  sampleRateHz?: number
  channels?: number
  durationSec?: number | null
  container?: string | null
  bitRateKbps?: number | null
  validatedBy?: string // e.g. 'ffprobe'
}

export interface AudioLoudnessFacts {
  integratedLufs?: number | null
  truePeakDbtp?: number | null
  /** M28: unit exactly as ffmpeg printed it (dBFS in modern summaries). */
  truePeakUnit?: 'dBFS' | 'dBTP' | null
  loudnessRangeLu?: number | null
  measuredBy?: string // e.g. 'ffmpeg ebur128'
}

export interface AudioModelIdentity {
  repo?: string
  revision?: string | null
  revisionCommit?: string | null
  dtype?: string
  /** M28 provenance state from the integrity verifier (verbatim). */
  artifactProvenance?: string | null
  checksumSource?: string | null
  canonicalCommitSha?: string | null
}

export interface AudioDuckingFacts {
  regions: Array<{ startSec: number; endSec: number }>
  config: { duckTo: number; attackMs: number; releaseMs: number; curve: string; minMusicLevel: number }
}

export interface AudioReceiptResult {
  /** The delivered artifact URL as served by the product. */
  artifactUrl?: string
  format?: string
  bytes?: number
  durationMs?: number
  /** ffprobe-measured stream facts (real technical validation). */
  stream?: AudioStreamFacts | null
  /** Measured loudness (EBUR128), when the operation measured it. */
  loudness?: AudioLoudnessFacts | null
  /** The engine that actually produced the audio (local | hosted). */
  engine?: string | null
  /** TTS-specific measured metadata. */
  voice?: string | null
  model?: string | null
  chunks?: number | null
  speed?: number | null
  generationMs?: number | null
  /** Warnings recorded honestly (e.g. partial segment completion). */
  warnings?: string[]
  /** Transcript for ASR jobs (the owner's own data, bounded preview). */
  transcript?: string | null
  /** Conversion source reference. */
  sourceUrl?: string | null
  /** Mixing op summary (operations actually applied). */
  operations?: string[] | null
  /** M28 Priority G: the exact model identity + artifact provenance used. */
  modelIdentity?: AudioModelIdentity | null
  /** M28 Priority G: the deterministic ducking automation actually applied. */
  ducking?: AudioDuckingFacts | null
  /** M28 Priority G: segment timing facts (narration joins). */
  timelineFacts?: { segments: number; timingLevel: string } | null
  /** M28: honest master label (measured-master vs processed-audio). */
  masterLabel?: string | null
}

export interface AudioJobFailure {
  errorCode?: string | null
  errorMessage?: string | null
  errorClass?: string | null
  /** Segments completed before the failure (partial output preserved). */
  completedSegments?: number | null
  totalSegments?: number | null
  partialArtifactUrl?: string | null
}

export type AudioJobKind = 'speech-synthesis' | 'audio-transcription' | 'audio-conversion' | 'audio-production'

export interface AudioJobInput {
  userId: string
  product: 'gangzii'
  kind: AudioJobKind
  jobId: string
  conversationId?: string | null
  projectId?: string | null
  backendId?: string | null
  /** Bounded request description (the owner's own data). */
  requestPreview: string
}

const AUDIO_STEPS = [
  { kind: 'generation' as const, seq: 1, title: 'Audio generation' },
  { kind: 'verification' as const, seq: 2, title: 'Artifact validation' },
]

const TERMINAL_TASK_STATUSES = [
  'completed',
  'completed_with_limitations',
  'partially_completed',
  'failed',
  'cancelled',
] as const

/** Idempotent settlement guard — one receipt per job, late events refuse. */
async function jobReceiptAlreadySettled(jobId: string): Promise<boolean> {
  try {
    const rows = await db.trustTask.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    const task = rows[0]
    return task !== null && (TERMINAL_TASK_STATUSES as readonly string[]).includes(task.status)
  } catch {
    return false
  }
}

async function guard(method: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logger.warn('trust.record_failed', {
      method,
      product: 'audio',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function streamFactsNote(stream: AudioStreamFacts): string {
  return [
    stream.codec ? `codec=${stream.codec}` : null,
    stream.sampleRateHz ? `sampleRateHz=${stream.sampleRateHz}` : null,
    stream.channels ? `channels=${stream.channels}` : null,
    stream.durationSec !== undefined && stream.durationSec !== null ? `durationSec=${stream.durationSec}` : null,
    stream.container ? `container=${stream.container}` : null,
    `validatedBy=${stream.validatedBy ?? 'unknown'}`,
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * M28 Priority G: the SIX verification states, recorded structurally and
 * kept distinct — never collapsed into a generic `verified`.
 *  1. model-artifact-integrity        — provenance state of the exact model
 *                                       revision used (not-applicable for
 *                                       hosted engines; stated, not hidden)
 *  2. speech-generated                — the engine actually produced audio
 *  3. audio-technically-validated     — ffprobe stream facts measured
 *  4. audio-timeline-synchronized     — measured segment timing present
 *  5. user-listened-and-approved      — ALWAYS false from automation: only a
 *                                       human can set this (GANGZII review
 *                                       sheet / owner sign-off)
 *  6. aesthetic-quality-independent-verification — never performed by code
 */
export interface AudioVerificationStates {
  'model-artifact-integrity': string
  'speech-generated': boolean
  'audio-technically-validated': 'ffprobe-stream-facts' | 'not-run'
  'audio-timeline-synchronized': 'measured-segment-timing' | 'not-applicable'
  'user-listened-and-approved': false
  'aesthetic-quality-independent-verification': 'not-performed'
}

function sixStateVerification(result: AudioReceiptResult, input: AudioJobInput): AudioVerificationStates {
  const hosted = result.engine ? /hosted/i.test(result.engine) : false
  return {
    'model-artifact-integrity': hosted
      ? 'not-applicable (hosted gateway engine — no local artifact to verify)'
      : result.modelIdentity?.artifactProvenance ?? 'not-recorded',
    'speech-generated': input.kind === 'speech-synthesis' || input.kind === 'audio-production',
    'audio-technically-validated': result.stream?.validatedBy === 'ffprobe' ? 'ffprobe-stream-facts' : 'not-run',
    'audio-timeline-synchronized': result.timelineFacts ? 'measured-segment-timing' : 'not-applicable',
    'user-listened-and-approved': false,
    'aesthetic-quality-independent-verification': 'not-performed',
  }
}

function sixStateNote(states: AudioVerificationStates): string {
  return (
    `Verification states (kept distinct, never a generic "verified"): ` +
    `model-integrity=${states['model-artifact-integrity']}; ` +
    `speech-generated=${states['speech-generated']}; ` +
    `technically-validated=${states['audio-technically-validated']}; ` +
    `timeline-synchronized=${states['audio-timeline-synchronized']}; ` +
    `user-listened-and-approved=false (awaiting human review); ` +
    `aesthetic-quality=not-performed (automation cannot judge).`
  )
}

/**
 * Record the full receipt for a COMPLETED audio job and settle it honestly
 * from the actual result + the applicable validation.
 */
export async function recordAudioJobCompletion(input: AudioJobInput, result: AudioReceiptResult): Promise<void> {
  await guard('recordAudioJobCompletion', async () => {
    if (await jobReceiptAlreadySettled(input.jobId)) return
    const task = await createTrustTask({
      userId: input.userId,
      product: input.product,
      kind: input.kind,
      title: `${input.kind} — delivered audio`,
      requestPreview: input.requestPreview.slice(0, TRUST_LIMITS.requestPreview),
      jobId: input.jobId,
      conversationId: input.conversationId ?? undefined,
      projectId: input.projectId ?? undefined,
    })
    await planTrustSteps(task.id, AUDIO_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)

    const limitations: string[] = []
    const warnings = result.warnings ?? []

    // Generation step: what was actually produced (measured facts only).
    await updateTrustStepStatus(task.id, AUDIO_STEPS[0].seq, 'done', {
      detailJson: JSON.stringify({
        artifactUrl: result.artifactUrl ?? null,
        engine: result.engine ?? null,
        voice: result.voice ?? null,
        model: result.model ?? null,
        chunks: result.chunks ?? null,
        speed: result.speed ?? null,
        generationMs: result.generationMs ?? null,
        bytes: result.bytes ?? null,
        durationMs: result.durationMs ?? null,
        operations: result.operations ?? null,
        // M28 Priority G evidence: exact model identity + provenance, the
        // ducking automation that ran, timeline facts, master label.
        modelIdentity: result.modelIdentity ?? null,
        ducking: result.ducking ?? null,
        timelineFacts: result.timelineFacts ?? null,
        masterLabel: result.masterLabel ?? null,
        transcriptChars: result.transcript ? result.transcript.length : null,
        warnings,
      }).slice(0, TRUST_LIMITS.detailJson),
    })

    // M28 Priority G evidence: model identity + artifact provenance state
    // recorded as its own measurement row (the receipt shows WHAT produced
    // the audio and how trustworthy that artifact chain is).
    if (result.modelIdentity?.repo) {
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: result.modelIdentity.repo,
        title: 'Model identity and artifact provenance (M28)',
        note: [
          result.modelIdentity.revision ? `revision=${result.modelIdentity.revision}` : null,
          result.modelIdentity.dtype ? `dtype=${result.modelIdentity.dtype}` : null,
          `artifactProvenance=${result.modelIdentity.artifactProvenance ?? 'not-recorded'}`,
          result.modelIdentity.checksumSource ? `checksumSource=${result.modelIdentity.checksumSource}` : null,
          result.modelIdentity.canonicalCommitSha ? `canonicalCommit=${result.modelIdentity.canonicalCommitSha}` : null,
        ].filter(Boolean).join('; '),
        origin: 'extracted',
      })
    }
    if (result.ducking && result.ducking.regions.length > 0) {
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: input.jobId,
        title: 'Dynamic ducking automation applied (M28)',
        note: `${result.ducking.regions.length} region(s); duckTo=${result.ducking.config.duckTo}, attack=${result.ducking.config.attackMs} ms, release=${result.ducking.config.releaseMs} ms, ${result.ducking.config.curve} curve — timeline-driven (NOT sidechain compression)`,
        origin: 'extracted',
      })
    }

    // Evidence: the delivered artifact (reference, never a copy).
    if (result.artifactUrl) {
      await addTrustEvidence(task.id, {
        kind: 'artifact',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: result.artifactUrl.slice(0, TRUST_LIMITS.refChars),
        title: `Delivered ${input.kind.replace('-', ' ')} artifact`,
        note: [
          result.format ? `format=${result.format}` : null,
          result.bytes !== undefined ? `bytes=${result.bytes}` : null,
          result.engine ? `engine=${result.engine}` : null,
          result.voice ? `voice=${result.voice}` : null,
        ].filter(Boolean).join('; ') || undefined,
        origin: 'extracted',
      })
    }
    // Processing ops carry their source as evidence.
    if (result.sourceUrl) {
      await addTrustEvidence(task.id, {
        kind: 'artifact',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: result.sourceUrl.slice(0, TRUST_LIMITS.refChars),
        title: 'Source audio the operation started from',
        origin: 'extracted',
      })
    }
    // ASR carries the transcript (bounded) as the extracted result.
    if (result.transcript) {
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: input.jobId,
        title: 'Transcript extracted (bounded preview)',
        note: result.transcript.slice(0, TRUST_LIMITS.noteField),
        origin: 'extracted',
      })
    }

    // Validation: ffprobe stream facts are the applicable technical check.
    let verificationSummary: string
    let outcome: 'completed' | 'completed_with_limitations' = 'completed'
    // M28 Priority G: the six verification states are computed from the
    // ACTUAL result and recorded as evidence + appended to the summary.
    const states = sixStateVerification(result, input)
    await addTrustEvidence(task.id, {
      kind: 'measurement',
      stepSeq: AUDIO_STEPS[1].seq,
      ref: result.artifactUrl ?? input.jobId,
      title: 'Verification states (six distinct states — M28)',
      note: sixStateNote(states),
      origin: 'extracted',
    })

    if (result.stream && result.stream.validatedBy === 'ffprobe') {
      const stream = result.stream
      await updateTrustStepStatus(task.id, AUDIO_STEPS[1].seq, 'done', {
        detailJson: JSON.stringify(stream).slice(0, TRUST_LIMITS.detailJson),
      })
      await addTrustEvidence(task.id, {
        kind: 'measurement',
        stepSeq: AUDIO_STEPS[1].seq,
        ref: result.artifactUrl ?? input.jobId,
        title: 'ffprobe-measured stream facts',
        note: streamFactsNote(stream),
        origin: 'extracted',
      })
      if (result.loudness) {
        await addTrustEvidence(task.id, {
          kind: 'measurement',
          stepSeq: AUDIO_STEPS[1].seq,
          ref: result.artifactUrl ?? input.jobId,
          title: 'Measured loudness (EBUR128)',
          note: [
            result.loudness.integratedLufs !== null && result.loudness.integratedLufs !== undefined
              ? `integratedLufs=${result.loudness.integratedLufs}`
              : null,
            result.loudness.truePeakDbtp !== null && result.loudness.truePeakDbtp !== undefined
              ? `truePeakDbtp=${result.loudness.truePeakDbtp}`
              : null,
            `measuredBy=${result.loudness.measuredBy ?? 'unknown'}`,
          ].filter(Boolean).join('; '),
          origin: 'extracted',
        })
      }
      verificationSummary =
        `Audio persisted and validated with ffprobe stream measurements (${streamFactsNote(stream)})` +
        (result.loudness?.integratedLufs !== undefined && result.loudness?.integratedLufs !== null
          ? `; loudness measured at ${result.loudness.integratedLufs} LUFS integrated`
          : '') +
        '. This confirms a real, decodable audio file — it is NOT a claim that the speech content is correct or that the audio sounds good; no listening review was performed by automation. ' +
        sixStateNote(states)
    } else {
      await updateTrustStepStatus(task.id, AUDIO_STEPS[1].seq, 'skipped', {
        errorNote: 'no ffprobe stream facts were recorded for this artifact',
      })
      outcome = 'completed_with_limitations'
      limitations.push(
        'The audio file exists and was persisted, but no ffprobe stream validation was recorded for it; no technical-quality claim is made.',
      )
      verificationSummary = 'Audio persisted; automated validation did not run, so no technical-quality claim is made. ' + sixStateNote(states)
    }

    // Honest limitations: warnings (partial chunks, beep guard, engine
    // fallbacks) plus the standing "content quality is human judgment" rule.
    for (const w of warnings) {
      limitations.push(w.slice(0, TRUST_LIMITS.limitationChars))
    }
    if (input.kind === 'speech-synthesis') {
      limitations.push(
        'Speech intelligibility and pronunciation were not independently verified; listen before publishing.',
      )
    }
    if (outcome === 'completed_with_limitations' && limitations.length === 0) {
      limitations.push('Completed with limitations; see the verification summary for exactly what was and was not checked.')
    }

    await finalizeTrustTask(task.id, {
      outcome,
      outcomeSummary: `The ${input.kind} job delivered its audio${result.artifactUrl ? '' : ' (artifact URL not recorded)'}.`,
      verificationSummary: verificationSummary.slice(0, TRUST_LIMITS.summaryField),
      limitations: limitations.slice(0, TRUST_LIMITS.limitationsPerTask),
    })
  })
}

/**
 * Record a FAILED audio job. Partial outputs are recorded exactly: if
 * segments completed before the failure, the receipt says so and points at
 * the preserved partial artifact — never "nothing was produced".
 */
export async function recordAudioJobFailure(input: AudioJobInput, failure: AudioJobFailure): Promise<void> {
  await guard('recordAudioJobFailure', async () => {
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
    await planTrustSteps(task.id, AUDIO_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)

    const partial =
      typeof failure.completedSegments === 'number' && failure.completedSegments > 0
    await updateTrustStepStatus(task.id, AUDIO_STEPS[0].seq, 'failed', {
      errorNote: (
        failure.errorMessage ??
        failure.errorCode ??
        'the audio job failed before a complete artifact was produced'
      ).slice(0, TRUST_LIMITS.noteField),
      ...(partial
        ? {
            detailJson: JSON.stringify({
              completedSegments: failure.completedSegments,
              totalSegments: failure.totalSegments ?? null,
              partialArtifactUrl: failure.partialArtifactUrl ?? null,
              note: 'Partial segment audio was preserved and is available to the owner.',
            }).slice(0, TRUST_LIMITS.detailJson),
          }
        : {}),
    })
    if (partial && failure.partialArtifactUrl) {
      await addTrustEvidence(task.id, {
        kind: 'artifact',
        stepSeq: AUDIO_STEPS[0].seq,
        ref: failure.partialArtifactUrl.slice(0, TRUST_LIMITS.refChars),
        title: `Partial output preserved (${failure.completedSegments} segment(s) completed)`,
        origin: 'extracted',
      })
    }
    await updateTrustStepStatus(task.id, AUDIO_STEPS[1].seq, 'skipped')
    await failTrustTask(task.id, {
      failureNote: `${failure.errorCode ?? failure.errorClass ?? 'ERROR'}: ${
        failure.errorMessage ?? 'the audio job failed before a complete artifact was produced'
      }${partial ? ` — ${failure.completedSegments} segment(s) of audio were preserved as partial output.` : ''}`.slice(
        0,
        TRUST_LIMITS.summaryField,
      ),
      limitations: partial
        ? []
        : ['No complete audio artifact was delivered; nothing was persisted as a completed audio result.'],
    })
  })
}

/** Record a CANCELLED audio job (honest note; partial output preserved). */
export async function recordAudioJobCancelled(
  input: AudioJobInput,
  when: string,
  partial?: { completedSegments?: number | null; partialArtifactUrl?: string | null },
): Promise<void> {
  await guard('recordAudioJobCancelled', async () => {
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
    await planTrustSteps(task.id, AUDIO_STEPS.map((s) => ({ kind: s.kind, title: s.title })))
    await startTrustTask(task.id)
    if (partial?.completedSegments && partial.completedSegments > 0) {
      await updateTrustStepStatus(task.id, AUDIO_STEPS[0].seq, 'failed', {
        errorNote: `Cancelled by the user after ${partial.completedSegments} segment(s) had completed; that partial audio is preserved.`,
      })
      if (partial.partialArtifactUrl) {
        await addTrustEvidence(task.id, {
          kind: 'artifact',
          stepSeq: AUDIO_STEPS[0].seq,
          ref: partial.partialArtifactUrl.slice(0, TRUST_LIMITS.refChars),
          title: `Partial output preserved (${partial.completedSegments} segment(s))`,
          origin: 'extracted',
        })
      }
    } else {
      await updateTrustStepStatus(task.id, AUDIO_STEPS[0].seq, 'skipped')
    }
    await updateTrustStepStatus(task.id, AUDIO_STEPS[1].seq, 'skipped')
    await cancelTrustTask(
      task.id,
      `Audio generation cancelled by the user ${when} it completed${
        partial?.completedSegments ? ` (${partial.completedSegments} segment(s) preserved as partial output)` : ' (no artifact was delivered)'
      }.`.slice(0, TRUST_LIMITS.summaryField),
    )
  })
}
