/**
 * GANGZII — generate narration segments (M27).
 * POST → enqueue every pending/failed segment as a REAL speech-synthesis
 * job (one queue job per segment). Ready segments are never re-generated
 * (no duplicate side effects); the response states exactly what was queued.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { generateNarrationProject } from '@/lib/gangzii/narration-service'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const res = await generateNarrationProject(id, user.id)
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.narration.generate',
      target: id,
      meta: { enqueued: res.enqueued, total: res.totalSegments },
    })
    return ok(res)
  })
}

