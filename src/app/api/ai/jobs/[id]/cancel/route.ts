/**
 * BEAN Intelligence — cancel a background job (owner-only).
 *
 * POST /api/ai/jobs/[id]/cancel
 *
 * Queued/retry_wait jobs settle as CANCELLED immediately; running jobs get
 * the cooperative cancel flag and their worker unwinds at the next natural
 * checkpoint (between streamed deltas, before final persistence). Video
 * jobs additionally stop being tracked provider-side by their existing
 * cancel path. Honest semantics — a running provider call that cannot be
 * aborted mid-flight is reported as cancelled-after-signal, never faked.
 */

import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { requestCancel } from '@/lib/ai-engine/queue'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const outcome = await requestCancel(id, user.id)
    if (outcome === 'not_found') {
      throw new BeanApiError('NOT_FOUND', 'Job not found (or already finished).')
    }
    return ok({
      cancelled: outcome === 'cancelled',
      signalled: outcome === 'signalled',
      message:
        outcome === 'cancelled'
          ? 'Cancelled before processing started.'
          : 'Cancellation requested — the worker will stop at its next checkpoint.',
    })
  })
}
