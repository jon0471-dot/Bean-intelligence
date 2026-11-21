/**
 * BEAN Intelligence — Trust Engine task resume (owner-only).
 *
 * GET  /api/trust/tasks/[id]/resume — read-only eligibility: what a resume
 *                                      would do, or the honest reason it
 *                                      cannot.
 * POST /api/trust/tasks/[id]/resume — consume the newest valid checkpoint and
 *                                     record the recovery in the ledger; the
 *                                     response is the resume plan the
 *                                     executor continues from.
 *
 * Honesty: only registered task kinds are resumable; a task with no valid
 * checkpoint is refused (`no_valid_checkpoint`), never "resumed" from
 * nothing; a pending approval is never bypassed; terminal tasks are never
 * resumed.
 */

import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import {
  planTrustResume,
  resumeTrustTask,
  TrustResumeRejectionError,
  type TrustResumeRejection,
} from '@/lib/trust/resume'
import type { BeanErrorCode } from '@/lib/api/errors'

const REASON_CODES: Record<TrustResumeRejection, { code: BeanErrorCode; status: number }> = {
  not_found: { code: 'NOT_FOUND', status: 404 },
  already_settled: { code: 'VALIDATION_ERROR', status: 400 },
  not_started: { code: 'VALIDATION_ERROR', status: 400 },
  waiting_for_approval: { code: 'VALIDATION_ERROR', status: 400 },
  kind_not_resumable: { code: 'CAPABILITY_UNSUPPORTED', status: 422 },
  no_valid_checkpoint: { code: 'VALIDATION_ERROR', status: 400 },
  invalid_checkpoint: { code: 'VALIDATION_ERROR', status: 400 },
  checkpoint_ledger_mismatch: { code: 'VALIDATION_ERROR', status: 400 },
  checkpoint_already_consumed: { code: 'CONCURRENCY_LIMIT', status: 429 },
}

function toApiError(err: unknown): BeanApiError {
  if (err instanceof TrustResumeRejectionError) {
    const mapping = REASON_CODES[err.reason]
    return new BeanApiError(mapping.code, err.message)
  }
  throw err
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    let plan
    try {
      plan = await planTrustResume(id, user.id)
    } catch (err) {
      throw toApiError(err)
    }
    return ok({ resumable: true, plan })
  })
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    let plan
    try {
      plan = await resumeTrustTask(id, user.id)
    } catch (err) {
      throw toApiError(err)
    }
    return ok({
      resumed: true,
      plan,
      note: 'The task stays active; the executor continues from plan.nextSeq and settles the task with a truthful verification summary. The recovery step is now part of the append-only ledger and appears in the receipt.',
    })
  })
}
