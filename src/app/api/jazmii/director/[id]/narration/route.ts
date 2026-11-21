/**
 * JAZMII AUTO DIRECTOR — attach a GANGZII narration as the voiceover (M27).
 * POST { narrationProjectId } → server-side copy of the completed joined
 * narration master into the production workspace + measured scene-timing
 * metadata. Both sides are ownership-checked; the pipeline never narrates
 * on its own — this endpoint only attaches a narration the user generated
 * explicitly in the GANGZII Narration Studio.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { attachNarrationToProduction } from '@/lib/jazmii/director/service'

const schema = z.object({
  narrationProjectId: z.string().regex(/^[\w-]+$/).max(40),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema)
    const result = await attachNarrationToProduction(user.id, id, body.narrationProjectId)
    await recordAudit({
      actorId: user.id,
      action: 'jazmii.narration.attach',
      target: id,
      meta: { narrationProjectId: body.narrationProjectId, segments: result.segments },
    })
    return ok(
      {
        attached: result.attached,
        narrationProjectId: result.narrationProjectId,
        voiceover: result.voiceover,
        segments: result.segments,
        measuredTotalMs: result.measuredTotalMs,
        timingNote: result.timingNote,
      },
    )
  })
}
