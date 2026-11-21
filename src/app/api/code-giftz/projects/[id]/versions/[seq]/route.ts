/**
 * CODE GIFTZ — version detail (M22, owner-only).
 *
 * GET ?file=<path> returns ONE historical file's content (view an old file).
 * Without ?file, returns the version's full file list, recorded change list
 * and a live integrity validation result — a corrupt snapshot is reported,
 * never silently presented as intact.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getVersionDetail, getVersionFileContent, VersionError } from '@/lib/code/versioning'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'

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
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }

    const filePath = new URL(request.url).searchParams.get('file')
    if (filePath) {
      assertSafeProjectPath(filePath)
      try {
        const content = await getVersionFileContent(id, seqNum, filePath)
        return ok({ version: seqNum, file: { path: filePath, content } })
      } catch (e) {
        if (e instanceof VersionError) {
          throw new BeanApiError(e.code === 'CORRUPT' ? 'INTERNAL_ERROR' : 'NOT_FOUND', e.message)
        }
        throw e
      }
    }

    try {
      const detail = await getVersionDetail(id, seqNum)
      return ok({ version: detail })
    } catch (e) {
      if (e instanceof VersionError && e.code === 'NOT_FOUND') {
        throw new BeanApiError('NOT_FOUND', e.message)
      }
      throw e
    }
  })
}
