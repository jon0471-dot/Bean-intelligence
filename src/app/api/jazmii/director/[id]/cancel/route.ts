import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { cancelProductionForOwner } from '@/lib/jazmii/director/service'

/**
 * JAZMII AUTO DIRECTOR — request cancellation (owner-scoped).
 *
 * Cooperative and honest: scene jobs get the existing stop-tracking cancel,
 * the orchestrator checks the durable flag between every stage, completed
 * scenes stay preserved, and the production settles as cancelled — nothing
 * is deleted and nothing is claimed aborted upstream.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const result = await cancelProductionForOwner(user.id, id)
    return ok(result)
  })
}
