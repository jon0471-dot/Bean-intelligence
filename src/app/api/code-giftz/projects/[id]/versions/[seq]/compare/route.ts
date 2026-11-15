/**
 * CODE GIFTZ — version comparison (M22, owner-only).
 *
 * GET /versions/<seq>/compare?target=<seq>|current
 * Compares THIS version (from) against another version or the live
 * workspace: added / modified / deleted / renamed files with real line
 * diffs (bounded) and honest truncation reporting.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { compareVersions, VersionError, type CompareTarget } from '@/lib/code/versioning'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; seq: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, seq } = await params
    const seqNum = Number(seq)
    if (!Number.isInteger(seqNum) || seqNum < 1) {
      throw new BeanApiError('VALIDATION_ERROR', 'Invalid version number.')
    }
    const targetRaw = new URL(request.url).searchParams.get('target') ?? 'current'
    let target: CompareTarget
    if (targetRaw === 'current') {
      target = 'current'
    } else {
      const targetSeq = Number(targetRaw)
      if (!Number.isInteger(targetSeq) || targetSeq < 1) {
        throw new BeanApiError('VALIDATION_ERROR', 'Invalid comparison target — use a version number or "current".')
      }
      target = { seq: targetSeq }
    }
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    try {
      const comparison = await compareVersions(id, { seq: seqNum }, target)
      return ok({ comparison })
    } catch (e) {
      if (e instanceof VersionError && e.code === 'NOT_FOUND') {
        throw new BeanApiError('NOT_FOUND', e.message)
      }
      throw e
    }
  })
}
