import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { clearProductionAudio, setProductionAudio } from '@/lib/jazmii/director/service'

/**
 * JAZMII AUTO DIRECTOR — set / clear a user-supplied audio track
 * (music bed or voiceover) while the storyboard is awaiting approval.
 *
 * Validation is by MAGIC BYTES, not extension or client claim; the file is
 * stored under the production's own workspace and never executed. Voiceover
 * is mixed ONLY from this explicit user-supplied track — the pipeline never
 * auto-narrates (BRAG rule, honored verbatim).
 */
const setSchema = z.object({
  role: z.enum(['music', 'voiceover']),
  dataUrl: z
    .string()
    .min(16)
    .max(36 * 1024 * 1024)
    .refine((v) => /^data:audio\//.test(v), 'dataUrl must be an audio/* base64 data URL.'),
  volume: z.number().min(0.05).max(1.0).optional(),
  attribution: z.string().max(200).optional(),
})

const clearSchema = z.object({
  role: z.enum(['music', 'voiceover']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, setSchema)
    const result = await setProductionAudio(user.id, id, body.role, {
      dataUrl: body.dataUrl,
      attribution: body.attribution,
      volume: body.volume,
    })
    return ok(result)
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, clearSchema)
    const result = await clearProductionAudio(user.id, id, body.role)
    return ok(result)
  })
}
