/**
 * BEAN Intelligence — Trust Engine execution receipt (owner-only).
 *
 * GET /api/trust/tasks/[id]/receipt — the composed, digest-stamped execution
 * receipt: the ledger composition (steps + evidence + approvals + checkpoints)
 * plus a sha-256 receiptDigest over its canonical content. The receipt always
 * reflects the real ledger because it IS the ledger — nothing is copied.
 *
 * Contains no secrets by construction: trust rows never store secrets.
 */

import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { composeTrustReceipt } from '@/lib/trust/receipt'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const receipt = await composeTrustReceipt(id, user.id)
    if (!receipt) {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }
    return ok({ receipt })
  })
}
