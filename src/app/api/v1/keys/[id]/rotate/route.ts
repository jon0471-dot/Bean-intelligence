/**
 * BEAN Intelligence — POST /api/v1/keys/:id/rotate
 * Rotate an application API key (admin session only). The previous key hash
 * is replaced immediately (old key stops working) and the NEW complete key
 * is returned exactly once — never stored raw, never shown again.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireAdminPrincipal } from '@/lib/security/gateway-auth'
import { rotateApiKey } from '@/lib/security/api-keys'
import { recordAudit } from '@/lib/observability/metering'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdminPrincipal(request)
    const { id } = await context.params
    if (!id) throw new BeanApiError('VALIDATION_ERROR', 'A key id is required.')
    const rotated = await rotateApiKey(id, admin.userId)
    await recordAudit({ actorId: admin.userId, action: 'gateway.apikey_rotated', target: id })
    return ok({
      key: rotated.key,
      id: rotated.id,
      prefix: rotated.prefix,
      notice: 'Store this new key now — it is shown only once and cannot be retrieved again. The previous key no longer works.',
    })
  })
}
