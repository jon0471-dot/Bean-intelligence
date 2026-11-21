/**
 * BEAN Intelligence — engine handler dispatch (task → real worker).
 *
 * The image/video handlers are the EXISTING product processors — unchanged
 * code that now runs under engine claims (durable queue, leases, recovery)
 * instead of fire-and-forget execution. Chat/coding handlers run the shared
 * product turn cores. Tasks with no wired processor fail honestly
 * (NO_BACKEND) — exactly the pre-engine behavior, preserved.
 */

import type { WorkerHandler } from './types'
import { processImageJob } from '@/lib/jobs/image-worker'
import { processEnhancementJob, processEditJob } from '@/lib/laxii/jobs'
import { isVideoPollerActive, processVideoJob } from '@/lib/jobs/video-worker'
import { processAudioJob } from '@/lib/jobs/audio-worker'
import { processProductionJob } from '@/lib/jobs/director-worker'
import { handleRiisheChatJob } from './riishe-chat-handler'
import { handleGiftzCodingJob } from './giftz-coding-handler'

/**
 * Legacy processors branch on the LEGACY vocabulary (video: 'queued' →
 * submit, 'running' → resume from the persisted provider task id). An
 * engine claim is ALWAYS a fresh execution, so claimed rows are presented
 * as 'queued' — never as 'running', which would wrongly trigger the resume
 * path before any provider task id exists (measured defect during the
 * engine acceptance run).
 */
function legacyRow(job: Parameters<typeof processVideoJob>[0]) {
  return { ...job, status: 'queued' as string }
}

export const engineHandlers: Record<string, WorkerHandler> = {
  'image-generation': async (job) => {
    await processImageJob(legacyRow(job))
    return { result: {} } // the legacy processor settles the row itself
  },
  'image-enhancement': async (job) => {
    await processEnhancementJob(legacyRow(job))
    return { result: {} }
  },
  'image-editing': async (job) => {
    await processEditJob(legacyRow(job))
    return { result: {} }
  },
  'video-generation': async (job) => {
    // ISSUES 1-2 REPAIR (2026-11-08): a live in-process poller already owns
    // this job (inline/recovery attach) — the engine settles nothing and
    // never double-executes. Measured without this guard: a re-claim raced
    // a live render and its finishCompleted clobbered the row with an
    // empty artifact while the real video was still rendering.
    if (isVideoPollerActive(job.id)) {
      return { noSettle: true }
    }
    await processVideoJob(legacyRow(job))
    return { result: {} } // the legacy processor settles the row itself
  },
  // JAZMII AUTO DIRECTOR (2026-11-20): one claimed production job
  // orchestrates scene generation jobs + local composition to a terminal
  // outcome; it settles its own row (same ownership contract as the video
  // worker). Checkpoint-resumable: delivered scene assets are never
  // re-generated on a re-claim (director-worker.ts).
  'video-production': async (job) => {
    await processProductionJob(job)
    return { result: {} } // the orchestrator settles the row itself
  },
  chat: handleRiisheChatJob,
  'coding-task': handleGiftzCodingJob,
  // GANGZII AUDIO PRODUCTION (M27, 2026-11-21): real speech synthesis
  // (local Kokoro-82M when installed, else the authorized hosted gateway —
  // voice-driven selection, never a silent swap), transcription, conversion
  // and audio production. Each handler validates its own artifact with
  // ffprobe and settles its own row + Trust receipt (same ownership
  // contract as the media workers).
  'speech-synthesis': async (job, ctx) => processAudioJob(job, ctx),
  'audio-transcription': async (job, ctx) => processAudioJob(job, ctx),
  'audio-conversion': async (job, ctx) => processAudioJob(job, ctx),
  'audio-production': async (job, ctx) => processAudioJob(job, ctx),
}
