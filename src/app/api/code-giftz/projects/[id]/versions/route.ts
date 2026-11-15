/**
 * CODE GIFTZ — project version history (M22).
 *
 * GET  — list recorded versions (newest first): seq, kind, summary, real
 *        change list vs the previous version, file count, integrity hash.
 * POST — manual snapshot of the CURRENT workspace ("Save a version" action).
 *        A snapshot of an unchanged workspace is an honest no-op.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { listVersions, snapshotProjectVersion, VersionError } from '@/lib/code/versioning'

const snapshotSchema = z.object({
  summary: z.string().max(500).optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const versions = await listVersions(id)
    return ok({
      project: { id, title: project.title, currentVersion: project.currentVersion },
      versions,
    })
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, snapshotSchema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    try {
      const snapshot = await snapshotProjectVersion({
        projectId: id,
        kind: 'manual',
        summary: body.summary ?? 'Manual snapshot',
      })
      if (snapshot.created) {
        await recordAudit({
          actorId: user.id,
          action: 'code-giftz.version_snapshot',
          target: id,
          meta: { seq: snapshot.version?.seq, kind: 'manual' },
        })
      }
      return ok({
        created: snapshot.created,
        skipped: snapshot.skipped ?? null,
        version: snapshot.version,
      })
    } catch (e) {
      if (e instanceof VersionError && e.code === 'LIMIT') {
        throw new BeanApiError('VALIDATION_ERROR', e.message)
      }
      throw e
    }
  })
}
