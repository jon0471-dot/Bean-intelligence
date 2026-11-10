import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { storeAsset, type AssetKind } from '@/lib/laxii/assets'
import { BeanApiError } from '@/lib/api/errors'

const KINDS: AssetKind[] = ['reference', 'original', 'mask']
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * LAXII — upload an asset (reference image, original for edit/enhance, or
 * brush mask). Multipart form: file=<binary>, kind=<reference|original|mask>.
 * Geometry is measured server-side; ownership is recorded on the row.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? 'original') as AssetKind
    if (!(file instanceof File)) {
      throw new BeanApiError('VALIDATION_ERROR', 'A file field is required.')
    }
    if (!KINDS.includes(kind)) {
      throw new BeanApiError('VALIDATION_ERROR', 'kind must be reference, original or mask.')
    }
    const mime = file.type || 'image/png'
    if (!ALLOWED_MIMES.includes(mime)) {
      throw new BeanApiError('UNSUPPORTED_FORMAT', 'Upload PNG, JPEG or WebP images only.')
    }
    const data = Buffer.from(await file.arrayBuffer())
    const asset = await storeAsset(user.id, kind, mime, data)
    await recordAudit({
      actorId: user.id,
      action: 'laxii.asset_upload',
      target: asset.id,
      meta: { kind, bytes: asset.bytes, width: asset.width, height: asset.height },
    })
    return ok({ asset }, { status: 201 })
  })
}
