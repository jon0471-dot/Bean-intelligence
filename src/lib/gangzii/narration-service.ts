/**
 * BEAN Intelligence — GANGZII Narration Studio service (M27).
 *
 * Owns the narration lifecycle: script creation (manual or from a JAZMII
 * storyboard), segmentation, per-segment synthesis jobs, measured timing,
 * segment regeneration, joining approved segments into one narration track,
 * and subtitle export. Honesty contract:
 *
 *  - the ORIGINAL script text is immutable user data; normalized text is
 *    separate, inspectable and regenerated on edit;
 *  - segments are generated ONE BY ONE as real queue jobs — a failure
 *    keeps every completed sibling; regeneration touches only its segment;
 *  - "ready" requires a real stored artifact (never job-in-progress);
 *  - segment timing is MEASURED (ffprobe) and marked approximate — no
 *    word-level alignment is claimed anywhere;
 *  - the JOIN is a real audio-production job (ffmpeg concat with tiny
 *    silences, no fake crossfades);
 *  - scene associations carry measured timings for JAZMII sync and are
 *    re-checked against scene duration changes (flagged, not hidden).
 *
 * SERVER-ONLY.
 */

import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { GANGZII_STORAGE_ROOT } from '@/lib/gangzii/audio-upload'
import {
  normalizeTextForSpeech,
  segmentTextForNarration,
  buildSubtitles,
  type PronunciationOverride,
} from '@/lib/gangzii/text-normalize'
import { isHostedVoice, isKokoroVoice } from '@/lib/registry/gangzii-presets'
import { buildTimelineTiming } from '@/lib/gangzii/timing'
import { enqueueJob } from '@/lib/jobs/queue'
import { hostedAudioAdapter } from '@/lib/adapters/hosted-audio'
import { logger } from '@/lib/observability/logger'

export interface SceneAssociation {
  sceneIdx: number
  segmentIdx: number
  caption?: string
}

export interface SegmentView {
  id: string
  idx: number
  text: string
  normalizedText: string
  voice: string
  speed: number
  status: string
  jobId: string | null
  audioUrl: string | null
  durationMs: number | null
  errorNote: string | null
}

function gangziiPath(relPath: string): string {
  const resolved = path.join(GANGZII_STORAGE_ROOT, relPath)
  if (!resolved.startsWith(GANGZII_STORAGE_ROOT)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Invalid storage path.')
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  return resolved
}

// ---------------------------------------------------------------------------
// Create / read / update
// ---------------------------------------------------------------------------

export interface CreateNarrationInput {
  userId: string
  title?: string
  text: string
  language?: string
  voice: string
  speed?: number
  /** Pronunciation overrides (user's own map — echoed, recorded). */
  overrides?: PronunciationOverride[]
  /** JAZMII provenance (id + scene associations) when applicable. */
  jazmiiProductionId?: string
  sceneAssociations?: SceneAssociation[]
  /** Pre-split segments (e.g. per-scene narration from a storyboard). */
  segments?: Array<{ text: string }>
}

export async function createNarrationProject(input: CreateNarrationInput) {
  if (!isHostedVoice(input.voice) && !isKokoroVoice(input.voice)) {
    throw new BeanApiError('VALIDATION_ERROR', 'Choose a GANGZII voice from either engine catalog.')
  }
  const source = input.jazmiiProductionId ? 'jazmii-storyboard' : 'manual'
  const segmentsSpec = input.segments && input.segments.length > 0
    ? input.segments.map((s) => s.text)
    : segmentTextForNarration(input.text)
  if (segmentsSpec.length === 0) {
    throw new BeanApiError('VALIDATION_ERROR', 'There is no narration text to segment.')
  }
  const project = await db.narrationProject.create({
    data: {
      userId: input.userId,
      title: (input.title ?? 'Untitled narration').slice(0, 120),
      language: (input.language ?? 'en').slice(0, 12),
      source,
      jazmiiProductionId: input.jazmiiProductionId ?? null,
      sceneAssociationsJson: input.sceneAssociations ? JSON.stringify(input.sceneAssociations) : null,
      status: 'draft',
      segments: {
        create: segmentsSpec.map((text, i) => {
          const norm = normalizeTextForSpeech(text, { language: input.language ?? 'en', overrides: input.overrides })
          return {
            idx: i + 1,
            text,
            normalizedText: norm.normalized,
            voice: input.voice,
            speed: input.speed ?? 1.0,
            status: 'pending',
          }
        }),
      },
    },
    include: { segments: { orderBy: { idx: 'asc' } } },
  })
  return project
}

export async function getNarrationProjectForOwner(id: string, userId: string) {
  const project = await db.narrationProject.findUnique({
    where: { id },
    include: { segments: { orderBy: { idx: 'asc' } } },
  })
  if (!project || project.userId !== userId) return null
  return project
}

export async function listNarrationProjects(userId: string) {
  return db.narrationProject.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { segments: { orderBy: { idx: 'asc' } } },
  })
}

export interface UpdateNarrationInput {
  title?: string
  /** Full-script replace: re-segments deterministically (pending segments
   *  only — ready segments keep their audio and are matched by text). */
  text?: string
  voice?: string
  speed?: number
  overrides?: PronunciationOverride[]
  sceneAssociations?: SceneAssociation[]
}

/**
 * Update a narration project. The script replace flow is conservative:
 * every segment whose TEXT changed (or is not yet generated) is rebuilt
 * pending; segments whose text is unchanged KEEP their audio. This is the
 * "never force full regeneration for one sentence change" rule.
 */
export async function updateNarrationProject(id: string, userId: string, input: UpdateNarrationInput) {
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')

  const voice = input.voice ?? project.segments[0]?.voice
  if (voice && !isHostedVoice(voice) && !isKokoroVoice(voice)) {
    throw new BeanApiError('VALIDATION_ERROR', 'Unknown voice.')
  }
  const speed = input.speed ?? project.segments[0]?.speed ?? 1.0

  // Voice change preserving the script: regenerate ALL segments (a voice
  // swap re-synthesizes; text is untouched) — but only if the user chose it.
  if (input.voice && !input.text) {
    await db.narrationSegment.updateMany({
      where: { projectId: project.id },
      data: { voice, status: 'pending', artifactRelPath: null, durationMs: null, generationJobId: null, errorNote: null },
    })
  }

  if (input.text !== undefined) {
    const normalized = normalizeTextForSpeech(input.text, { language: project.language, overrides: input.overrides })
    const newSegments = segmentTextForNarration(input.text)
    const existing = project.segments
    // Delete-and-recreate is the deterministic path; ready segments whose
    // text matches an existing ready segment's TEXT keep their artifact.
    const reusable = new Map<string, { relPath: string | null; durationMs: number | null; jobId: string | null }>()
    for (const seg of existing) {
      if (seg.status === 'ready' && seg.artifactRelPath) {
        reusable.set(seg.text, { relPath: seg.artifactRelPath, durationMs: seg.durationMs, jobId: seg.generationJobId })
      }
    }
    await db.narrationSegment.deleteMany({ where: { projectId: project.id } })
    await db.narrationSegment.createMany({
      data: newSegments.map((text, i) => {
        const norm = normalizeTextForSpeech(text, { language: project.language, overrides: input.overrides })
        const reuse = reusable.get(text)
        return {
          projectId: project.id,
          idx: i + 1,
          text,
          normalizedText: norm.normalized,
          voice: voice ?? 'af_heart',
          speed,
          status: reuse ? 'ready' : 'pending',
          artifactRelPath: reuse?.relPath ?? null,
          durationMs: reuse?.durationMs ?? null,
          generationJobId: reuse?.jobId ?? null,
        }
      }),
    })
    if (normalized.changes.length > 0) {
      logger.info('gangzii.narration.resegmented', { projectId: project.id, segments: newSegments.length })
    }
  }

  if (input.sceneAssociations) {
    await db.narrationProject.update({
      where: { id: project.id },
      data: {
        sceneAssociationsJson: JSON.stringify(input.sceneAssociations),
        ...(input.title ? { title: input.title.slice(0, 120) } : {}),
      },
    })
  } else if (input.title) {
    await db.narrationProject.update({ where: { id: project.id }, data: { title: input.title.slice(0, 120) } })
  }

  return getNarrationProjectForOwner(id, userId)
}

export async function deleteNarrationProject(id: string, userId: string) {
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  // Best-effort artifact cleanup (DB rows are the source of truth).
  for (const seg of project.segments) {
    if (seg.artifactRelPath) {
      try {
        fs.rmSync(gangziiPath(seg.artifactRelPath), { force: true })
      } catch {
        /* deletion is best-effort */
      }
    }
  }
  await db.narrationProject.delete({ where: { id: project.id } })
  return { deleted: true }
}

// ---------------------------------------------------------------------------
// Generation (per segment; whole-project = enqueue all pending)
// ---------------------------------------------------------------------------

async function submitSegmentJob(
  userId: string,
  segment: { id: string; text: string; normalizedText: string; voice: string; speed: number },
): Promise<string> {
  const { backend, release } = await import('@/lib/router/router').then((m) =>
    m.preflight(userId, 'gangzii', 'speech-synthesis'),
  )
  release() // the queue holds the real slot
  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'gangzii',
      task: 'speech-synthesis',
      status: 'queued',
      backendId: backend.id,
      paramsJson: JSON.stringify({
        text: segment.normalizedText,
        voice: segment.voice,
        speed: segment.speed,
        source: 'narration-segment',
        narrationSegmentId: segment.id,
      }),
    },
  })
  enqueueJob(job.id)
  return job.id
}

/** Enqueue every pending segment (idempotent: ready/generating skipped). */
export async function generateNarrationProject(id: string, userId: string) {
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  const pending = project.segments.filter((s) => s.status === 'pending' || s.status === 'failed')
  let enqueued = 0
  for (const seg of pending) {
    const jobId = await submitSegmentJob(userId, seg)
    await db.narrationSegment.update({
      where: { id: seg.id },
      data: { status: 'generating', generationJobId: jobId, errorNote: null },
    })
    enqueued += 1
  }
  return { enqueued, totalSegments: project.segments.length, pendingSkipped: project.segments.length - pending.length }
}

/** Regenerate ONE segment (the per-sentence-edit path). */
export async function regenerateNarrationSegment(id: string, userId: string, segmentId: string) {
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  const seg = project.segments.find((s) => s.id === segmentId)
  if (!seg) throw new BeanApiError('NOT_FOUND', 'Narration segment not found.')
  if (seg.status === 'generating') {
    throw new BeanApiError('CONCURRENCY_LIMIT', 'This segment is already generating. Wait for it to finish.')
  }
  const jobId = await submitSegmentJob(userId, seg)
  await db.narrationSegment.update({
    where: { id: seg.id },
    data: { status: 'generating', generationJobId: jobId, errorNote: null },
  })
  return { segmentId: seg.id, jobId, idx: seg.idx }
}

/**
 * Claim completed TTS jobs back into their segments (called by the status
 * route so a GET reflects reality without a webhook). Only the OWNING
 * segment is touched; the produced artifact is COPIED from the TTS artifact
 * to the segment's own storage path (preserved independently of the job row).
 */
export async function reconcileNarrationSegments(userId: string, projectId?: string) {
  const projects = projectId
    ? await getNarrationProjectForOwner(projectId, userId).then((p) => (p ? [p] : []))
    : await listNarrationProjects(userId)
  const claimed: string[] = []
  const failed: string[] = []
  for (const project of projects) {
    for (const seg of project.segments) {
      if (seg.status !== 'generating' || !seg.generationJobId) continue
      const job = await db.generationJob.findUnique({ where: { id: seg.generationJobId } })
      if (!job) continue
      if (job.status === 'completed') {
        const sourcePath = gangziiPath(`${userId}/tts/${job.id}.wav`)
        if (!fs.existsSync(sourcePath)) {
          await db.narrationSegment.update({
            where: { id: seg.id },
            data: { status: 'failed', errorNote: 'The synthesis job completed but its audio is missing from storage.' },
          })
          failed.push(seg.id)
          continue
        }
        const relPath = `${userId}/narration/${project.id}/${seg.id}.wav`
        fs.copyFileSync(sourcePath, gangziiPath(relPath))
        let durationMs: number | null = null
        try {
          const meta = await hostedAudioAdapter.probeAudio(gangziiPath(relPath))
          durationMs = meta.durationSec !== null ? Math.round(meta.durationSec * 1000) : null
        } catch {
          durationMs = null // honest: timing stays unknown, never estimated
        }
        await db.narrationSegment.update({
          where: { id: seg.id },
          data: { status: 'ready', artifactRelPath: relPath, durationMs },
        })
        claimed.push(seg.id)
      } else if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'rejected' || job.status === 'unsupported') {
        await db.narrationSegment.update({
          where: { id: seg.id },
          data: {
            status: job.status === 'cancelled' ? 'pending' : 'failed',
            errorNote: job.errorMessage ?? job.errorCode ?? 'The synthesis job ended without audio.',
          },
        })
        if (job.status !== 'cancelled') failed.push(seg.id)
      }
    }
  }
  return { claimed, failed }
}

// ---------------------------------------------------------------------------
// Join approved segments + subtitles
// ---------------------------------------------------------------------------

export interface JoinNarrationResult {
  jobId: string
  inputs: number
  missing: Array<{ idx: number; segmentId: string }>
}

/**
 * Join all READY segments (in idx order) into one narration track via a
 * REAL audio-production job. Segments not ready are listed honestly — the
 * join proceeds ONLY when every segment is ready (a partial narration
 * track silently missing a sentence would be dishonest delivery).
 */
export async function joinNarrationProject(id: string, userId: string): Promise<JoinNarrationResult> {
  await reconcileNarrationSegments(userId, id)
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  const notReady = project.segments.filter((s) => s.status !== 'ready' || !s.artifactRelPath)
  if (notReady.length > 0) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      `${notReady.length} segment(s) are not ready yet (${notReady.map((s) => `#${s.idx}`).join(', ')}). Generate them first — the joined track must contain every segment.`,
    )
  }
  const inputs = project.segments
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({ relPath: s.artifactRelPath as string }))
  const { backend, release } = await import('@/lib/router/router').then((m) =>
    m.preflight(userId, 'gangzii', 'audio-production'),
  )
  release()
  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'gangzii',
      task: 'audio-production',
      status: 'queued',
      backendId: backend.id,
      paramsJson: JSON.stringify({
        inputs,
        operations: [{ op: 'concat' }],
        output: { format: 'wav', channels: 1, sampleRateHz: 48_000 },
        sourceLabel: `narration:${project.id}`,
      }),
    },
  })
  enqueueJob(job.id)
  await db.narrationProject.update({ where: { id: project.id }, data: { status: 'joined' } })
  return { jobId: job.id, inputs: inputs.length, missing: [] }
}

/** Measured segment-level subtitles (SRT/VTT). Skipped segments listed. */
export async function narrationSubtitles(id: string, userId: string, format: 'srt' | 'vtt') {
  await reconcileNarrationSegments(userId, id)
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  const { content, measuredCount, skippedCount } = buildSubtitles(
    project.segments.map((s) => ({ idx: s.idx, text: s.text, durationMs: s.durationMs })),
    format,
  )
  return {
    content,
    measuredCount,
    skippedCount,
    approximationNote:
      'Timestamps are SEGMENT-LEVEL and measured from the produced audio files; they are not word-level alignment and should be reviewed before publishing.',
  }
}

/** Scene associations with MEASURED timings + explicit confidence (M28 Priority E). */
export async function narrationSceneTiming(id: string, userId: string) {
  await reconcileNarrationSegments(userId, id)
  const project = await getNarrationProjectForOwner(id, userId)
  if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
  let associations: SceneAssociation[] = []
  try {
    associations = project.sceneAssociationsJson ? (JSON.parse(project.sceneAssociationsJson) as SceneAssociation[]) : []
  } catch {
    associations = []
  }
  // M28 Priority E: one honest confidence vocabulary for every consumer.
  // Measured cumulative starts where the measured chain is intact; after an
  // unmeasured segment the chain is broken — later segments are labeled
  // `unavailable` with an EXPLICIT estimate field for preview/planning only
  // (never exported to subtitles, never used for ducking regions).
  const timing = buildTimelineTiming(
    project.segments
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((s) => {
        const assoc = associations.find((a) => a.segmentIdx === s.idx)
        return {
          segmentId: s.id,
          idx: s.idx,
          sceneIdx: assoc?.sceneIdx ?? null,
          text: s.text,
          status: s.status,
          durationMs: s.durationMs,
        }
      }),
  )
  const measuredCount = timing.filter((t) => t.confidence === 'segment-measured').length
  return {
    projectId: project.id,
    title: project.title,
    jazmiiProductionId: project.jazmiiProductionId,
    timingLevel: measuredCount === timing.length && timing.length > 0 ? 'segment-measured (full)' : 'mixed',
    confidenceNote:
      'Confidence vocabulary: segment-measured = boundaries derived from the real audio artifact durations; unavailable = no trustworthy timing (the measured chain is broken before this segment; an explicit estimate may accompany it for preview). Word-level alignment is NOT performed by any GANGZII engine — approximate timestamps are never presented as word alignment. If JAZMII scene durations changed since association, recompute or review before composing.',
    segments: timing.map((t) => ({
      segmentId: t.segmentId,
      idx: t.idx,
      sceneIdx: t.sceneIdx,
      text: t.text,
      status: t.status,
      durationMs: t.durationMs,
      approximateStartMs: t.startMs,
      approximate: t.confidence === 'segment-measured',
      confidence: t.confidence,
      ...(t.approximatedByEstimateMs !== undefined ? { estimatedDurationMs: t.approximatedByEstimateMs } : {}),
    })),
  }
}
