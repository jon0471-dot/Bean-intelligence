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
import { processVideoJob } from '@/lib/jobs/video-worker'
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
    await processVideoJob(legacyRow(job))
    return { result: {} }
  },
  chat: handleRiisheChatJob,
  'coding-task': handleGiftzCodingJob,
}
