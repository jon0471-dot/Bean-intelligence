import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { storeAsset, MAX_ASSET_BYTES, type AssetKind } from '@/lib/laxii/assets'
import { BeanApiError } from '@/lib/api/errors'

const KINDS: AssetKind[] = ['reference', 'original', 'mask']
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp']
/** Multipart overhead budget (boundaries + headers) on top of the file cap. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
/** Body cap for the strictest kind (mask, 8 MB) + one file + overhead. */
const BODY_CAP_BYTES = MAX_ASSET_BYTES + MULTIPART_OVERHEAD_BYTES

/**
 * LAXII — upload an asset (reference image, original for edit/enhance, or
 * brush mask). Multipart form: file=<binary>, kind=<reference|original|mask>.
 * Geometry is measured server-side; ownership is recorded on the row.
 *
 * M26 (audit S-9): oversized bodies are rejected BEFORE buffering — the
 * declared content-length is checked first (zero-copy), then the raw byte
 * count after the bounded read. A multi-GB multipart can no longer be
 * buffered into memory just to learn it is too large.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()

    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > BODY_CAP_BYTES) {
      throw new BeanApiError(
        'PAYLOAD_TOO_LARGE',
        `Assets are limited to ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB.`,
      )
    }
    // Bounded raw read: the body is cloned because formData() below needs the
    // stream; the clone is discarded. A chunked body without a declared
    // length is still fully buffered here (same residual as the riishe
    // documents route) — the declared pre-check above is the zero-copy gate.
    const raw = Buffer.from(await request.clone().arrayBuffer())
    if (raw.length > BODY_CAP_BYTES) {
      throw new BeanApiError(
        'PAYLOAD_TOO_LARGE',
        `Assets are limited to ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB.`,
      )
    }
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
