/**
 * BEAN Intelligence — per-job append-only event log.
 *
 * Workers stream partial chat/coding text, progress, stages and notices
 * here. The SSE endpoint replays events after any cursor so a client can
 * disconnect and reattach without losing anything, and a user who never
 * watches still finds the finished artifact in the job result.
 *
 * Sequencing: each event gets the next per-job seq under a transaction so
 * concurrent writers (worker + cancel + recovery) can never collide — the
 * (jobId, seq) unique constraint is the final guard.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import type { JobEventData, JobEventType } from './types'

export interface StoredJobEvent {
  seq: number
  type: JobEventType
  data: JobEventData
  createdAt: string
}

/** Is this Prisma error a unique-constraint violation (P2002)? */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
}

/**
 * Append one event; returns its sequence number.
 * Interactive-transaction-free (2026-11-07, measured): per-delta $transactions
 * contend for the single SQLite connection under concurrent pools; a
 * read-max + create with unique-violation retry gives the same per-job
 * monotonic guarantee without holding a pooled transaction.
 */
export async function appendJobEvent(
  jobId: string,
  type: JobEventType,
  data: JobEventData,
): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const last = await db.jobEvent.findFirst({
      where: { jobId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    const seq = (last?.seq ?? -1) + 1
    try {
      await db.jobEvent.create({
        data: { jobId, seq, type, dataJson: JSON.stringify(data ?? {}) },
      })
      return seq
    } catch (e) {
      if (isUniqueViolation(e)) continue // another writer appended first — retry with the new max
      throw e
    }
  }
  logger.warn('engine.event_seq_exhausted', { jobId, type })
  throw new Error('job event sequence contention exceeded')
}

/** Best-effort append — never throws into a worker's hot path. */
export async function appendJobEventSafe(
  jobId: string,
  type: JobEventType,
  data: JobEventData,
): Promise<number | null> {
  try {
    return await appendJobEvent(jobId, type, data)
  } catch {
    return null
  }
}

/** All events after a cursor (exclusive), oldest first. */
export async function getEventsSince(jobId: string, sinceSeq: number): Promise<StoredJobEvent[]> {
  const rows = await db.jobEvent.findMany({
    where: { jobId, seq: { gt: sinceSeq } },
    orderBy: { seq: 'asc' },
    take: 2_000,
  })
  return rows.map((r) => ({
    seq: r.seq,
    type: r.type as JobEventType,
    data: safeParse(r.dataJson),
    createdAt: r.createdAt.toISOString(),
  }))
}

/** Latest event sequence for a job (or -1). */
export async function latestEventSeq(jobId: string): Promise<number> {
  const last = await db.jobEvent.findFirst({
    where: { jobId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  return last?.seq ?? -1
}

function safeParse(json: string): JobEventData {
  try {
    return JSON.parse(json) as JobEventData
  } catch {
    return {}
  }
}

/**
 * Delete events of terminal jobs older than the retention window. The job
 * row (status/result/artifacts) is the permanent record; the event log is a
 * transport that does not need to outlive its usefulness.
 */
export async function pruneOldJobEvents(retentionHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 3_600_000)
  const res = await db.jobEvent.deleteMany({
    where: {
      job: {
        status: { in: ['completed', 'failed', 'cancelled', 'rejected', 'unsupported'] },
        finishedAt: { lt: cutoff },
      },
    },
  })
  return res.count
}
