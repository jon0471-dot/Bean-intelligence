import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { regenerateScene } from '@/lib/jazmii/director/service'

/**
 * JAZMII AUTO DIRECTOR — regenerate ONE failed scene.
 *
 * Only a FAILED scene can be regenerated, and only when its previous
 * generation attempt has fully settled (no duplicate provider submission).
 * Delivered scenes are never touched: when the production already settled,
 * a fresh orchestration job re-opens it and checkpoint resume re-composes
 * from the surviving assets.
 */
const regenerateSchema = z.object({
  idx: z.number().int().min(1).max(8),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, regenerateSchema)
    const result = await regenerateScene(user.id, id, body.idx)
    return ok({
      scene: { idx: body.idx, status: result.scene.status, attempts: result.scene.attempts },
      orchestrationJobId: result.orchestrationJobId,
    })
  })
}
