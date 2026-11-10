/**
 * BEAN Intelligence — background job detail (owner-only).
 *
 * GET /api/ai/jobs/[id] — full status incl. the extended engine state, the
 * legacy-normalized status (so existing clients can reuse the shape), the
 * persisted result payload (artifact links) and the event-log cursor count.
 *
 * IDOR-safe: the row must belong to the caller. Provider/model identities
 * are never exposed here.
 */

import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { normalizeStatusForProduct, isTerminal } from '@/lib/ai-engine/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({
      where: { id },
      include: { _count: { select: { events: true } } },
    })
    if (!job || job.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    return ok({
      job: {
        id: job.id,
        product: job.product,
        task: job.task,
        capability: job.capability ?? job.task,
        status: job.status,
        legacyStatus: normalizeStatusForProduct(job.status),
        terminal: isTerminal(job.status),
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        errorClass: job.errorClass,
        cancelRequested: job.cancelRequested,
        result: job.resultJson ? safeParse(job.resultJson) : null,
        eventCount: job._count.events,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    })
  })
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}
