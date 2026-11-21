import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { approveProduction } from '@/lib/jazmii/director/service'

/**
 * JAZMII AUTO DIRECTOR — approve the storyboard proposal.
 *
 * Approval is the owner's explicit creative sign-off: the approved plan
 * (storyboard + engine preference + audio tracks) becomes the generation
 * contract, an orchestration job is queued on the durable engine, and the
 * production moves to 'generating'. Scene clips are bounded 3–12 s by the
 * existing video backend — the storyboard was validated against that before
 * approval.
 */
const approveSchema = z.object({
  engine: z.enum(['auto', 'hyperframes', 'ffmpeg']).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, approveSchema)
    const result = await approveProduction(user.id, id, { engine: body.engine })
    return ok({
      orchestrationJobId: result.orchestrationJobId,
      status: 'generating',
      enginePreference: result.plan.enginePreference,
    })
  })
}
