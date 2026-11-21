import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { resumeProductionForOwner } from '@/lib/jazmii/director/service'

/**
 * JAZMII AUTO DIRECTOR — resume a production whose orchestration died
 * (worker OOM / WORKER_LOST / composition crash).
 *
 * Checkpoint resume (spec §13): delivered scene assets are KEPT — the new
 * orchestration skips every ffprobe-validated scene and re-runs only media
 * prep + composition + validation. Refuses honestly when an orchestration
 * is still active (it will continue on its own).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const result = await resumeProductionForOwner(user.id, id)
    return ok(result)
  })
}
