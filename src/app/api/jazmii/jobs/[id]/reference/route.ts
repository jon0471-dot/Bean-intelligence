import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/**
 * Reference image of an image-to-video job (owner-only).
 *
 * The driver image lives in GenerationJob.paramsJson (the authoritative copy
 * the provider actually used). This endpoint lets the OWNER re-attach it for
 * an honest regeneration — the payload is the user's own upload, it is never
 * exposed cross-user, and provider task ids stay private.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'jazmii') {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    let imageUrl: string | null = null
    try {
      const p = job.paramsJson ? (JSON.parse(job.paramsJson) as { imageUrl?: unknown }) : {}
      imageUrl = typeof p.imageUrl === 'string' ? p.imageUrl : null
    } catch {
      imageUrl = null
    }
    return ok({ referenceImageUrl: imageUrl })
  })
}
