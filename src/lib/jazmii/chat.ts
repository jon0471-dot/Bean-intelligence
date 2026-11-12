/**
 * JAZMII — conversational video studio shared server helpers (2026-11-12).
 *
 * The chat route and the conversations routes serialize messages the same
 * way: assistant "job" messages merge the LINKED GenerationJob row's live
 * state on every read. Nothing is cached, nothing invented — a job that is
 * queued renders as queued, a failure renders its genuine backend
 * errorMessage, and completed videos render their stored artifact URL
 * (/api/jazmii/jobs/<id>/media — unchanged path, so playback, download and
 * provider recovery keep working).
 */
import { db } from '@/lib/db'

export interface JazmiiJobView {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  videoUrl: string | null
  format: string | null
  bytes: number | null
  /** ffprobe-measured stream facts — REAL validation, never estimated. */
  width: number | null
  height: number | null
  durationSec: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean
  /** Continuity verification report from the worker (checked/defects). */
  continuity: Record<string, unknown> | null
  /** Composer settings that produced this job (from paramsJson — the
   *  authoritative copy). */
  size: string | null
  durationSecRequested: number | null
  quality: string | null
  withAudio: boolean
  hasReferenceImage: boolean
  queuedAt: string
  finishedAt: string | null
}

export interface JazmiiSerializedMessage {
  id: string
  role: 'user' | 'assistant'
  kind: string
  text: string | null
  jobId: string | null
  meta: Record<string, unknown>
  createdAt: string
  job: JazmiiJobView | null
}

/** Engine states → the legacy product vocabulary (same mapping as the
 *  existing jazmii routes; product contracts preserved). */
export function normalizeJobStatus(status: string): string {
  switch (status) {
    case 'starting':
    case 'running':
    case 'streaming':
    case 'finalizing':
      return 'running'
    case 'retry_wait':
      return 'queued'
    default:
      return status
  }
}

interface JazmiiJobRowLike {
  id: string
  status: string
  progress: number
  paramsJson: string
  resultJson: string | null
  errorCode: string | null
  errorMessage: string | null
  queuedAt: Date
  finishedAt: Date | null
}

/** Project a video GenerationJob row into the message-thread view. */
export function jazmiiJobViewOfRow(job: JazmiiJobRowLike): JazmiiJobView {
  let params: Record<string, unknown> = {}
  let result: Record<string, unknown> = {}
  try {
    params = job.paramsJson ? (JSON.parse(job.paramsJson) as Record<string, unknown>) : {}
  } catch {
    params = {}
  }
  try {
    result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : {}
  } catch {
    result = {}
  }
  const stream = (result.stream as Record<string, unknown> | undefined) ?? null
  const completed = job.status === 'completed'
  return {
    id: job.id,
    status: normalizeJobStatus(job.status),
    progress: job.progress,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    videoUrl: completed ? ((result.videoUrl as string) ?? null) : null,
    format: (result.format as string) ?? null,
    bytes: (result.bytes as number) ?? null,
    width: (stream?.width as number) ?? (result.width as number) ?? null,
    height: (stream?.height as number) ?? (result.height as number) ?? null,
    durationSec: (stream?.durationSec as number) ?? null,
    fps: (stream?.fps as number) ?? null,
    codec: (stream?.codec as string) ?? null,
    hasAudio: result.audio !== undefined,
    continuity: (result.continuity as Record<string, unknown>) ?? null,
    size: typeof params.size === 'string' ? params.size : null,
    durationSecRequested: typeof params.durationSec === 'number' ? params.durationSec : null,
    quality: typeof params.quality === 'string' ? params.quality : null,
    withAudio: params.withAudio === true,
    hasReferenceImage: typeof params.imageUrl === 'string',
    queuedAt: job.queuedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  }
}

interface JazmiiMessageRowLike {
  id: string
  role: string
  kind: string
  text: string | null
  jobId: string | null
  metaJson: string | null
  createdAt: Date
}

/** Serialize persisted messages, merging live job state for job messages. */
export async function serializeJazmiiMessages(rows: JazmiiMessageRowLike[]): Promise<JazmiiSerializedMessage[]> {
  const jobIds = Array.from(new Set(rows.map((r) => r.jobId).filter((v): v is string => Boolean(v))))
  const jobs = jobIds.length ? await db.generationJob.findMany({ where: { id: { in: jobIds } } }) : []
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  return rows.map((r) => {
    let meta: Record<string, unknown> = {}
    try {
      meta = r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : {}
    } catch {
      meta = {}
    }
    const job = r.jobId ? jobById.get(r.jobId) : undefined
    return {
      id: r.id,
      role: r.role === 'user' ? 'user' : 'assistant',
      kind: r.kind,
      text: r.text,
      jobId: r.jobId,
      meta,
      createdAt: r.createdAt.toISOString(),
      job: job ? jazmiiJobViewOfRow(job) : null,
    }
  })
}

/** Derive a short conversation title from the first user prompt. */
export function jazmiiTitleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return 'New video conversation'
  return t.length <= 48 ? t : `${t.slice(0, 45)}…`
}
