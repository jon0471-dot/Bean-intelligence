import { requireUser } from '@/lib/auth/session'
import { loadAsset } from '@/lib/laxii/assets'
import { BeanApiError } from '@/lib/api/errors'

/**
 * Authenticated asset delivery (reference images, originals, masks and
 * produced artifacts). Ownership is re-checked on EVERY request, same
 * contract as the job-artifact route.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser()
    const { id } = await params
    const asset = await loadAsset(user.id, id)
    return new Response(new Uint8Array(asset.data), {
      headers: {
        'content-type': asset.mime,
        'content-length': String(asset.data.length),
        'cache-control': 'private, max-age=3600',
        'content-disposition': `inline; filename="bean-laxii-asset-${id}"`,
      },
    })
  } catch (err) {
    if (err instanceof BeanApiError) return err.toResponse()
    return new BeanApiError('INTERNAL_ERROR', 'Could not load the asset.').toResponse()
  }
}
