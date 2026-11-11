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
import { ATTEMPT_FRESHNESS_MS } from './last-attempts'
import type { AttemptRecordLike } from '@/lib/registry/capabilities'

export type PersistedAttemptTask =
  | 'image-generation'
  | 'image-editing'
  | 'image-bg-removal'
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
 * RESTART-PROOF FAILURE EVIDENCE (OPERATIONAL-TRANSFORMATION, 2026-11-11):
 * the persisted store previously carried ONLY completed rows, so a server
 * restart legitimately erased every trace of a real upstream failure — a
 * capability with a fresh 401/429 yesterday and a success last week came
 * back "operational" after a deploy. Failed GenerationJob rows persist
 * `errorClass` (rate_limited | auth | billing | timeout | network | …), so
 * the same honest evidence the in-memory tracker holds is recoverable from
 * the database. Only UPSTREAM-class failures count as health evidence; a
 * request-specific rejection (content policy, cancellation, budget) is not
 * product-health evidence and stays out of the chain.
 */
function errorClassToCategory(errorClass: string | null): HealthFailureCategory | null {
  switch (errorClass) {
    case 'rate_limited':
      return 'rate-limited'
    case 'auth':
      return 'auth'
    case 'billing':
      return 'billing'
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'network'
    default:
      return null
  }
}

/**
 * CAPABILITY RECOVERY (2026-11-11): the persisted errorCode is a SECOND
 * honest record of the same failure — and for the hosted-edit /
 * background-removal paths it was the ONLY one: their failure writer did not
 * persist `errorClass` at all (measured live: the genuine 429 rows at
 * 2026-11-11T05:14:55Z / 05:15:00Z carry errorCode 'RATE_LIMITED' with
 * errorClass null), so the errorClass-only mapping silently dropped them and
 * the restart-proof chain was blind to those capabilities' real failures in
 * BOTH directions — after a restart a fresh 429 lost its evidence entirely,
 * and the failed row stopped being the last attempt, whitewashing the
 * capability back to an older success. Only unambiguous upstream-class codes
 * map to evidence; request-specific codes (VALIDATION_ERROR, CANCELLED,
 * BACKEND_FAILURE, malformed_response, …) stay non-evidence — same contract
 * as errorClassToCategory and the chat errorCode mapping above.
 */
function errorCodeToCategory(errorCode: string | null): HealthFailureCategory | null {
  switch (errorCode) {
    case 'RATE_LIMITED':
    case 'UPSTREAM_RATE_LIMITED':
      return 'rate-limited'
    case 'UPSTREAM_AUTH':
      return 'auth'
    case 'UPSTREAM_BILLING':
      return 'billing'
    case 'BACKEND_TIMEOUT':
    case 'UPSTREAM_TIMEOUT':
      return 'timeout'
    case 'UPSTREAM_NETWORK':
      return 'network'
    default:
      return null
  }
}

/** Category of a failed row: its errorClass, else its errorCode evidence. */
function failedRowCategory(row: { errorClass: string | null; errorCode: string | null }): HealthFailureCategory | null {
  return errorClassToCategory(row.errorClass) ?? errorCodeToCategory(row.errorCode)
}

/** Failed-row lookup shared by the evidence functions (bounded, indexed). */
async function latestFailedRow(
  where: Record<string, unknown>,
): Promise<{ finishedAt: Date | null; errorClass: string | null; errorCode: string | null } | null> {
  const row = await db.generationJob.findFirst({
    where: { ...where, status: 'failed' },
    orderBy: [{ finishedAt: 'desc' }, { queuedAt: 'desc' }],
    select: { finishedAt: true, errorClass: true, errorCode: true },
  })
  if (!row || !row.finishedAt) return null
  return { finishedAt: row.finishedAt, errorClass: row.errorClass, errorCode: row.errorCode }
}

/**
 * The most recent REAL FAILED attempt with an upstream error class, from
 * the persisted GenerationJob table — or null when none exists.
 */
export async function persistedUpstreamFailure(
  task: Exclude<PersistedAttemptTask, 'chat-completion'>,
): Promise<AttemptRecordLike | null> {
  try {
    if (task === 'image-generation') {
      const row = await latestFailedRow({
        product: 'laxii',
        task: 'image-generation',
        backendId: 'bean-image-hosted-primary',
      })
      if (!row) return null
      const category = failedRowCategory(row)
      return category
        ? { at: row.finishedAt!.toISOString(), ok: false, failureCategory: category, httpStatus: null }
        : null
    }
    if (task === 'image-editing') {
      // CAPABILITY ISOLATION (2026-11-11): background-removal rows are
      // image-editing rows with a dedicated mode marker; the conversational
      // editing chain must read ONLY its own attempts — measured live, the
      // newest completed hosted-edit row was a BACKGROUND-REMOVAL row, so
      // editing borrowed bg-removal's success evidence (and could equally
      // inherit its failures). Same `not contains` guard on completions and
      // failures keeps the two capabilities' persisted evidence separate.
      const row = await latestFailedRow({
        product: 'laxii',
        task: 'image-editing',
        backendId: 'bean-image-hosted-edit',
        paramsJson: { not: { contains: '"mode":"background-removal"' } },
      })
      if (!row) return null
      const category = failedRowCategory(row)
      return category
        ? { at: row.finishedAt!.toISOString(), ok: false, failureCategory: category, httpStatus: null }
        : null
    }
    if (task === 'image-bg-removal') {
      const row = await latestFailedRow({
        product: 'laxii',
        task: 'image-editing',
        backendId: 'bean-image-hosted-edit',
        paramsJson: { contains: '"mode":"background-removal"' },
      })
      if (!row) return null
      const category = failedRowCategory(row)
      return category
        ? { at: row.finishedAt!.toISOString(), ok: false, failureCategory: category, httpStatus: null }
        : null
    }
    // t2v / i2v: the latest failed video row of EITHER shape is evidence for
    // both capabilities — the shared account/endpoint rejects them alike.
    // The per-capability split matters for completions (who actually got an
    // artifact), not for credential-level rejections.
    const row = await latestFailedRow({ product: 'jazmii', task: 'video-generation' })
    if (!row) return null
    const category = errorClassToCategory(row.errorClass)
    return category
      ? { at: row.finishedAt!.toISOString(), ok: false, failureCategory: category, httpStatus: null }
      : null
  } catch {
    // Evidence lookup must never break the health payload.
    return null
  }
}

/**
 * HOTFIX (LAXII TEXT-TO-IMAGE RATE LIMITING, 2026-11-11): the FRESHNESS
 * contract the persisted failure must satisfy before it may steer a
 * capability state. `persistedUpstreamFailure` returns the latest failed row
 * of ANY age — that is correct for `persistedLastAttempt` (display evidence:
 * the newest record wins, a restart must never whiten a failure), but it is
 * NOT valid as the capability model's `freshUpstreamFailure` input, whose
 * documented contract is "fresh upstream-class failure or null" — the same
 * contract the in-memory tracker enforces with its 15-minute
 * ATTEMPT_FRESHNESS_MS window and last-write-wins ordering.
 *
 * Measured defect this closes (live 2026-11-11T03:39Z): a 24-HOUR-OLD
 * rate_limited T2I row (2026-11-10T03:24:28Z) was fed to
 * `generationCapability` as `freshUpstreamFailure`, whose branch outranks
 * `lastAttempt?.ok` — so a newer SUCCESSFUL real generation
 * (2026-11-11T03:09:16Z, artifact verified) could never lift the state, and
 * LAXII Text-to-Image (plus the product badge) rendered 'rate-limited'
 * forever, with the factually false note "the most recent real generation
 * attempt was rate-limited upstream". A persisted failure is FRESH evidence
 * here only when (a) it is inside the same freshness window the in-memory
 * chain uses and (b) no newer attempt record supersedes it (a success after
 * the failure invalidates "the most recent attempt failed"). Purely
 * ADDITIVE: existing functions and every existing caller are unchanged.
 */
export async function recentPersistedUpstreamFailure(
  task: Exclude<PersistedAttemptTask, 'chat-completion'>,
  opts: {
    /** Evaluation clock (tests pin it); default now. */
    now?: number
    /** The newest known attempt record of ANY outcome; a record NEWER than
     *  the failure supersedes it as evidence of what happened last. */
    supersededBy?: AttemptRecordLike | null
  } = {},
): Promise<AttemptRecordLike | null> {
  const failure = await persistedUpstreamFailure(task)
  if (!failure) return null
  const t = Date.parse(failure.at)
  if (Number.isNaN(t)) return null
  const now = opts.now ?? Date.now()
  if (now - t > ATTEMPT_FRESHNESS_MS) return null
  const newer = opts.supersededBy
  if (newer) {
    const nt = Date.parse(newer.at)
    if (!Number.isNaN(nt) && nt > t) return null
  }
  return failure
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
      // ISOLATION (2026-11-11): background-removal rows share this task and
      // backend — excluded by their mode marker so editing never borrows
      // bg-removal's completions (measured live: its newest "edit" success
      // WAS a bg-removal row).
      const row = await db.generationJob.findFirst({
        where: {
          product: 'laxii',
          task: 'image-editing',
          status: 'completed',
          backendId: 'bean-image-hosted-edit',
          paramsJson: { not: { contains: '"mode":"background-removal"' } },
        },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      })
      return recordFrom(row?.finishedAt ?? null)
    }
    if (task === 'image-bg-removal') {
      // Background-removal rows are image-editing rows whose params carry
      // the dedicated mode — matched by the persisted params JSON so the
      // capability's evidence stays separate from conversational editing's.
      const row = await db.generationJob.findFirst({
        where: {
          product: 'laxii',
          task: 'image-editing',
          status: 'completed',
          backendId: 'bean-image-hosted-edit',
          paramsJson: { contains: '"mode":"background-removal"' },
        },
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

/**
 * RESTART-PROOF EVIDENCE (OPERATIONAL-TRANSFORMATION, 2026-11-11): the
 * newest persisted record of ANY outcome — completed OR upstream-failed —
 * so a restart can never whiten a recent real failure into an old
 * success. The in-memory tracker always outranks this (its records are
 * newer by construction); this is the fallback evidence store.
 */
export async function persistedLastAttempt(
  task: Exclude<PersistedAttemptTask, 'chat-completion'>,
): Promise<AttemptRecordLike | null> {
  const [success, failure] = await Promise.all([persistedAttempt(task), persistedUpstreamFailure(task)])
  if (success && failure) return Date.parse(failure.at) > Date.parse(success.at) ? failure : success
  return failure ?? success
}
