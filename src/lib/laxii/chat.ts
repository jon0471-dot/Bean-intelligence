/**
 * LAXII — conversational studio shared server helpers (2026-11-12).
 *
 * The chat route and the conversations routes both serialize messages the
 * same way: assistant "job" messages merge the LINKED GenerationJob row's
 * live state on every read. Nothing is cached, nothing invented — a job
 * that is queued renders as queued, a failure renders its genuine backend
 * errorMessage, and completed artifacts render their stored asset URLs
 * (unchanged /api/laxii/assets/<id> paths, so existing references keep
 * working).
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { loadAsset } from '@/lib/laxii/assets'
import { detectIntent, type IntentDecision } from './intent'

export interface SerializedJobView {
  id: string
  task: string
  mode: string | null
  status: string
  progress: number
  size: string | null
  errorCode: string | null
  errorMessage: string | null
  imageUrl: string | null
  originalUrl: string | null
  diffUrl: string | null
  report: Record<string, unknown> | null
  width: number | null
  height: number | null
  format: string | null
  bytes: number | null
  durationMs: number | null
  transparent: boolean
  queuedAt: string
}

export interface SerializedLaxiiMessage {
  id: string
  role: 'user' | 'assistant'
  kind: string
  text: string | null
  assetId: string | null
  assetUrl: string | null
  jobId: string | null
  maskAssetIds: string[]
  meta: Record<string, unknown>
  createdAt: string
  job: SerializedJobView | null
}

/** Engine states → the legacy product vocabulary (same mapping as the
 *  existing laxii routes; product contracts preserved). */
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

interface JobRowLike {
  id: string
  task: string
  status: string
  progress: number
  paramsJson: string
  resultJson: string | null
  errorCode: string | null
  errorMessage: string | null
  queuedAt: Date
}

/** Project a GenerationJob row into the message-thread view. */
export function jobViewOfRow(job: JobRowLike): SerializedJobView {
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
  const size =
    (typeof params.size === 'string' ? params.size : null) ??
    (typeof params.width === 'number' && typeof params.height === 'number'
      ? `${params.width}x${params.height}`
      : null)
  return {
    id: job.id,
    task: job.task,
    mode: typeof params.mode === 'string' ? params.mode : null,
    status: normalizeJobStatus(job.status),
    progress: job.progress,
    size,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    imageUrl: result && job.status === 'completed' ? ((result.assetUrl as string) ?? (result.imageUrl as string) ?? null) : null,
    originalUrl: (result?.originalUrl as string) ?? null,
    diffUrl: (result?.diffUrl as string) ?? null,
    report: (result?.report as Record<string, unknown>) ?? null,
    width: (result?.width as number) ?? null,
    height: (result?.height as number) ?? null,
    format: (result?.format as string) ?? null,
    bytes: (result?.bytes as number) ?? null,
    durationMs: (result?.durationMs as number) ?? null,
    transparent: result?.transparent === true,
    queuedAt: job.queuedAt.toISOString(),
  }
}

interface MessageRowLike {
  id: string
  role: string
  kind: string
  text: string | null
  assetId: string | null
  jobId: string | null
  maskAssetIds: string | null
  metaJson: string | null
  createdAt: Date
}

/** Serialize persisted messages, merging live job state for job messages. */
export async function serializeLaxiiMessages(rows: MessageRowLike[]): Promise<SerializedLaxiiMessage[]> {
  const jobIds = Array.from(new Set(rows.map((r) => r.jobId).filter((v): v is string => Boolean(v))))
  const jobs = jobIds.length
    ? await db.generationJob.findMany({ where: { id: { in: jobIds } } })
    : []
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  return rows.map((r) => {
    let meta: Record<string, unknown> = {}
    try {
      meta = r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : {}
    } catch {
      meta = {}
    }
    let maskAssetIds: string[] = []
    try {
      const parsed = r.maskAssetIds ? (JSON.parse(r.maskAssetIds) as unknown) : []
      if (Array.isArray(parsed)) maskAssetIds = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      maskAssetIds = []
    }
    const job = r.jobId ? jobById.get(r.jobId) : undefined
    return {
      id: r.id,
      role: r.role === 'user' ? 'user' : 'assistant',
      kind: r.kind,
      text: r.text,
      assetId: r.assetId,
      assetUrl: r.assetId ? `/api/laxii/assets/${r.assetId}` : null,
      jobId: r.jobId,
      maskAssetIds,
      meta,
      createdAt: r.createdAt.toISOString(),
      job: job ? jobViewOfRow(job) : null,
    }
  })
}

export interface ConversationImageRef {
  assetId: string
  sourceMessageId: string
}

/**
 * The most recent usable image in a conversation — a fresh upload from a
 * user message or a completed job's result asset — so follow-up messages
 * ("now make the sky darker") naturally reference the previous image.
 * Ownership is enforced by the caller's conversation check; the returned
 * assetId is re-validated by loadAsset before any job uses it.
 */
export async function resolveConversationImage(
  conversationId: string,
): Promise<ConversationImageRef | null> {
  const messages = await db.laxiiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const jobIds = Array.from(new Set(messages.map((m) => m.jobId).filter((v): v is string => Boolean(v))))
  const jobs = jobIds.length ? await db.generationJob.findMany({ where: { id: { in: jobIds } } }) : []
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  for (const m of messages) {
    if (m.role === 'user' && m.assetId) return { assetId: m.assetId, sourceMessageId: m.id }
    if (m.jobId) {
      const job = jobById.get(m.jobId)
      if (job && job.status === 'completed') {
        let result: Record<string, unknown> = {}
        try {
          result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : {}
        } catch {
          result = {}
        }
        const url = (result.assetUrl as string) ?? (result.imageUrl as string) ?? null
        const match = url ? /\/api\/laxii\/assets\/([\w-]+)$/.exec(url) : null
        if (match) return { assetId: match[1], sourceMessageId: m.id }
      }
    }
  }
  return null
}

/** Ownership-checked load of an image to run a job against (honest 404/400). */
export async function requireImageAsset(userId: string, assetId: string): Promise<void> {
  const asset = await loadAsset(userId, assetId)
  if (asset.kind !== 'original' && asset.kind !== 'result') {
    throw new BeanApiError('VALIDATION_ERROR', 'That asset is not an editable image.')
  }
}

/** Derive a short conversation title from the first user message. */
export function titleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return 'New image conversation'
  return t.length <= 48 ? t : `${t.slice(0, 45)}…`
}

export interface ChatTurn {
  userMessage: SerializedLaxiiMessage
  assistantMessage: SerializedLaxiiMessage
}

export type { IntentDecision }
export { detectIntent }
