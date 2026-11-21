/**
 * GANGZII — join approved narration segments (M27).
 * POST → one audio-production job concatenating every READY segment in
 * order. Refused when any segment is not ready — the joined track must
 * contain every segment (a silently partial narration is never delivered).
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { joinNarrationProject } from '@/lib/gangzii/narration-service'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const res = await joinNarrationProject(id, user.id)
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.narration.join',
      target: id,
      meta: { inputs: res.inputs, jobId: res.jobId },
    })
    return ok({ jobId: res.jobId, inputs: res.inputs, missing: res.missing }, { status: 202 })
  })
}
