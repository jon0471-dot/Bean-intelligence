/**
 * CODE GIFTZ — version rollback (M22, owner-only).
 *
 * Restores the workspace to a recorded version BY CREATING A NEW VERSION —
 * history is append-only and never rewritten. The target's integrity is
 * validated first; a corrupt/partial snapshot is refused, never applied.
 * The response reports the real change list the rollback produced.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { rollbackToVersion, VersionError } from '@/lib/code/versioning'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; seq: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, seq } = await params
    const seqNum = Number(seq)
    if (!Number.isInteger(seqNum) || seqNum < 1) {
      throw new BeanApiError('VALIDATION_ERROR', 'Invalid version number.')
    }
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    try {
      const result = await rollbackToVersion(id, seqNum)
      await recordAudit({
        actorId: user.id,
        action: 'code-giftz.version_rollback',
        target: id,
        meta: { restoredFrom: seqNum, newVersion: result.newVersion?.seq ?? null },
      })
      return ok({
        rollback: {
          restoredFrom: result.restoredVersion,
          newVersion: result.newVersion,
          changes: result.changes,
        },
      })
    } catch (e) {
      if (e instanceof VersionError) {
        throw new BeanApiError(
          e.code === 'CORRUPT' ? 'INTERNAL_ERROR' : e.code === 'LIMIT' ? 'VALIDATION_ERROR' : 'NOT_FOUND',
          e.message,
        )
      }
      throw e
    }
  })
}
