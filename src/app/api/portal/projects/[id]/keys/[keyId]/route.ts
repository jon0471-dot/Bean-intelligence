/**
 * BEAN Intelligence — DELETE /api/portal/projects/:id/keys/:keyId
 * (Phase 1 developer portal.)
 *
 * Revoke a project-scoped application API key. Same secure revocation
 * behavior as the admin gateway (immediate, permanent — verification rejects
 * the key on the next request), but ownership is portal-scoped: the key must
 * belong to the caller AND live in the caller's project (requireOwnedProjectKey),
 * else 404. API keys can never perform this (403); no session is 401.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireOwnedProjectKey } from '@/lib/security/portal'
import { revokeApiKey } from '@/lib/security/api-keys'
import { recordAudit } from '@/lib/observability/metering'

export async function DELETE(request: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  return handle(async () => {
    const { id, keyId } = await context.params
    if (!id || !keyId) throw new BeanApiError('VALIDATION_ERROR', 'A project id and a key id are required.')
    const { principal } = await requireOwnedProjectKey(request, id, keyId)
    await revokeApiKey(keyId, principal.userId)
    await recordAudit({ actorId: principal.userId, action: 'portal.project_key_revoked', target: keyId, meta: { projectId: id } })
    return ok({ revoked: true, id: keyId })
  })
}
