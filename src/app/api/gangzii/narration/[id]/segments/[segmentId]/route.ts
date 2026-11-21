/**
 * GANGZII — regenerate ONE narration segment (M27).
 * POST → a real speech-synthesis job for this segment only. Sibling
 * segments and their audio are untouched (the per-sentence-edit rule).
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { regenerateNarrationSegment } from '@/lib/gangzii/narration-service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; segmentId: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, segmentId } = await params
    const res = await regenerateNarrationSegment(id, user.id, segmentId)
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.narration.regenerate_segment',
      target: id,
      meta: { segmentId, jobId: res.jobId, idx: res.idx },
    })
    return ok(res, { status: 202 })
  })
}
