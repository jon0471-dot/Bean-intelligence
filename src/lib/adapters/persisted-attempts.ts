/**
 * BEAN Intelligence — persisted real-attempt evidence (server-side).
 *
 * FINAL CAPABILITY FIX (2026-11-07): the real-attempt tracker
 * (last-attempts.ts) is process memory — a dev-server restart legitimately
 * empties it, and the capability rows then downgraded REAL completed work
 * (measured: JAZMII's real T2V and I2V completions rendered "wired but
 * unverified" after a restart) even though the evidence is PERSISTED: every
 * real generation writes a completed GenerationJob row with its artifact.
 *
 * This module reads that persisted evidence so the capability model never
 * forgets a real completion that the database still proves. Honesty rules:
 *  - ONLY `status: 'completed'` rows count (a completed row is written by
 *    the worker only after real output was validated — magic bytes for
 *    media, sandbox exit codes for code);
 *  - the record carries the row's own finishedAt — the age of the evidence
 *    stays visible in the payload, never refreshed or faked;
 *  - in-memory records (this process's own attempts, failures included)
 *    always outrank the persisted record — a fresh failure must keep
 *    outweighing an old success, and every real attempt in this process is
 *    ALSO persisted, so the newer of the two is the same event anyway;
 *  - nothing here fabricates a success: a row that does not exist yields
 *    null and the capability stays honestly unverified.
 */
import { db } from '@/lib/db'
import type { HealthFailureCategory } from './types'
import type { AttemptRecordLike } from '@/lib/registry/capabilities'

export type PersistedAttemptTask =
  | 'image-generation'
  | 'image-editing'
  | 'video-generation-t2v'
  | 'video-generation-i2v'
  // CHAT-RECOVERY (2026-11-10): the quota-free chat health probe reads the
  // persisted chat UsageRecord rows as its restart-surviving evidence — the
  // in-memory attempt tracker (last-attempts.ts) empties on restart, and a
  // recent upstream-class chat failure must keep the status honest until a
  // real success follows (never a fabricated recovery from an empty store).
  | 'chat-completion'

/** Map a persisted chat errorCode to its honest health failure category. */
function chatErrorCodeCategory(errorCode: string | null): HealthFailureCategory | null {
  switch (errorCode) {
    case 'UPSTREAM_RATE_LIMITED':
    case 'RATE_LIMITED':
      return 'rate-limited'
    case 'UPSTREAM_AUTH':
      return 'auth'
    case 'UPSTREAM_BILLING':
      return 'billing'
    case 'UPSTREAM_TIMEOUT':
      return 'timeout'
    case 'UPSTREAM_NETWORK':
      return 'network'
    default:
      return 'backend-error'
  }
}

function recordFrom(finishedAt: Date | null): AttemptRecordLike | null {
  if (!finishedAt) return null
  return {
    at: finishedAt.toISOString(),
    ok: true,
    failureCategory: null,
    httpStatus: null,
  }
}

/**
 * The most recent REAL COMPLETED attempt for a capability, from the
 * persisted GenerationJob table — or null when none exists.
 */
export async function persistedAttempt(task: PersistedAttemptTask): Promise<AttemptRecordLike | null> {
  try {
    if (task === 'chat-completion') {
      // Chat evidence lives in UsageRecord (every real chat turn writes one,
      // success or failure — recordUsage). The MOST RECENT row of either
      // chat product is the newest truth; a success proves the class served,
      // a failure carries its honest category. httpStatus is not persisted
      // on usage rows, so it stays null (never guessed).
      const row = await db.usageRecord.findFirst({
        where: { kind: 'chat', product: { in: ['riishe', 'code-giftz'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, success: true, errorCode: true },
      })
      if (!row) return null
      if (row.success) {
        return { at: row.createdAt.toISOString(), ok: true, failureCategory: null, httpStatus: null }
      }
      return {
        at: row.createdAt.toISOString(),
        ok: false,
        failureCategory: chatErrorCodeCategory(row.errorCode),
        httpStatus: null,
      }
    }
    if (task === 'image-generation') {
      const row = await db.generationJob.findFirst({
        where: { product: 'laxii', task: 'image-generation', status: 'completed', backendId: 'bean-image-hosted-primary' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      })
      return recordFrom(row?.finishedAt ?? null)
    }
    if (task === 'image-editing') {
      // Hosted conversational edits only (the local Diffusers worker has its
      // own registry gate; strict-preserve is enhancement, not editing).
      const row = await db.generationJob.findFirst({
        where: { product: 'laxii', task: 'image-editing', status: 'completed', backendId: 'bean-image-hosted-edit' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      })
      return recordFrom(row?.finishedAt ?? null)
    }
    // t2v / i2v: classify completed video jobs by the persisted params
    // (i2v carries the image_url driver field). Bounded scan: the last 25
    // completed jobs are far more than enough to find the latest of either.
    const rows = await db.generationJob.findMany({
      where: { product: 'jazmii', task: 'video-generation', status: 'completed' },
      orderBy: { finishedAt: 'desc' },
      take: 25,
      select: { finishedAt: true, paramsJson: true },
    })
    for (const row of rows) {
      let imageUrl: unknown = null
      try {
        imageUrl = (JSON.parse(row.paramsJson) as Record<string, unknown>).imageUrl ?? null
      } catch {
        imageUrl = null
      }
      const isI2v = typeof imageUrl === 'string' && imageUrl.length > 0
      if (task === 'video-generation-i2v' ? isI2v : !isI2v) {
        return recordFrom(row.finishedAt)
      }
    }
    return null
  } catch {
    // Evidence lookup must never break the health payload — absence of
    // evidence yields null (honest unverified), never an error.
    return null
  }
}
