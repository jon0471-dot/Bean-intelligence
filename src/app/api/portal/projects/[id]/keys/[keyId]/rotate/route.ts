/**
 * BEAN Intelligence — POST /api/portal/projects/:id/keys/:keyId/rotate
 * (Phase 1 developer portal.)
 *
 * Rotate a project-scoped application API key through the SAME central
 * rotateApiKey() as the admin gateway: the previous hash is replaced
 * immediately (old key stops working) and the NEW complete key is returned
 * exactly once — never stored raw, never shown again. The project binding is
 * preserved. Cross-user or cross-project access is 404.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireOwnedProjectKey } from '@/lib/security/portal'
import { rotateApiKey } from '@/lib/security/api-keys'
import { recordAudit } from '@/lib/observability/metering'

export async function POST(request: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  return handle(async () => {
    const { id, keyId } = await context.params
    if (!id || !keyId) throw new BeanApiError('VALIDATION_ERROR', 'A project id and a key id are required.')
    const { principal } = await requireOwnedProjectKey(request, id, keyId)
    const rotated = await rotateApiKey(keyId, principal.userId)
    await recordAudit({ actorId: principal.userId, action: 'portal.project_key_rotated', target: keyId, meta: { projectId: id } })
    return ok({
      key: rotated.key,
      id: rotated.id,
      prefix: rotated.prefix,
      projectId: rotated.projectId,
      notice: 'Store this new key now — it is shown only once and cannot be retrieved again. The previous key no longer works.',
    })
  })
}
