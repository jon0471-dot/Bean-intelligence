/**
 * BEAN Intelligence — DELETE /api/v1/keys/:id
 * Revoke an application API key (admin session only). Revocation is
 * immediate and permanent: verification rejects the key on the next request.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireAdminPrincipal } from '@/lib/security/gateway-auth'
import { revokeApiKey } from '@/lib/security/api-keys'
import { recordAudit } from '@/lib/observability/metering'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdminPrincipal(request)
    const { id } = await context.params
    if (!id) throw new BeanApiError('VALIDATION_ERROR', 'A key id is required.')
    await revokeApiKey(id, admin.userId)
    await recordAudit({ actorId: admin.userId, action: 'gateway.apikey_revoked', target: id })
    return ok({ revoked: true, id })
  })
}
