/**
 * CODE GIFTZ — manual workspace file management (M22).
 *
 * POST — editor Save. Owner-checked, path-safe, marked origin:"modified" so
 *   the UI shows an honest "edited by you" state (never confused with model
 *   output). M22 ADDITIVE: optimistic concurrency (optional
 *   `expectedUpdatedAt` — a save against a file that changed elsewhere is
 *   rejected honestly instead of silently clobbering) and an automatic
 *   `file-save` version recording the change.
 * DELETE — remove a file from the workspace (owner-checked, path-safe); the
 *   deletion is recorded in the change history and as a `file-delete` version.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { recordAudit } from '@/lib/observability/metering'
import { snapshotProjectVersion, VersionError } from '@/lib/code/versioning'

const saveSchema = z.object({
  path: z.string().min(1).max(200),
  content: z.string().max(400_000),
  /**
   * M22 optimistic concurrency: the file's updatedAt as the client loaded it.
   * Optional (the original single-writer flow stays valid); when provided and
   * stale, the save is refused with an honest conflict message.
   */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

const deleteSchema = z.object({
  path: z.string().min(1).max(200),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, saveSchema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    assertSafeProjectPath(body.path)
    const existing = await db.codeFile.findUnique({
      where: { projectId_path: { projectId: id, path: body.path } },
    })
    // Optimistic concurrency (when the client participates).
    if (existing && body.expectedUpdatedAt) {
      const expected = new Date(body.expectedUpdatedAt).getTime()
      if (Number.isFinite(expected) && existing.updatedAt.getTime() !== expected) {
        throw new BeanApiError(
          'VALIDATION_ERROR',
          'This file changed after you loaded it (another edit or generation landed first). Reload the file and try again — your edit was NOT applied.',
        )
      }
    }
    if (existing) {
      if (existing.content === body.content) {
        return ok({ file: { path: existing.path, origin: existing.origin, changed: false } })
      }
      await db.codeFile.update({
        where: { id: existing.id },
        data: { content: body.content, origin: 'modified' },
      })
    } else {
      await db.codeFile.create({
        data: { projectId: id, path: body.path, content: body.content, origin: 'modified' },
      })
    }
    // M22: record the change as a project version (best-effort; a versioning
    // failure never blocks the save).
    let versionSeq: number | null = null
    try {
      const snapshot = await snapshotProjectVersion({
        projectId: id,
        kind: 'file-save',
        summary: `Edited ${body.path}`,
      })
      versionSeq = snapshot.version?.seq ?? null
    } catch (e) {
      if (e instanceof VersionError && e.code === 'LIMIT') {
        // The history limit is a real user-facing condition — surface it.
        throw new BeanApiError('VALIDATION_ERROR', `${e.message} The file change itself was saved.`)
      }
    }
    await recordAudit({ actorId: user.id, action: 'code-giftz.file_save', target: id, meta: { path: body.path, versionSeq } })
    return ok({ file: { path: body.path, origin: 'modified', changed: true }, versionSeq })
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, deleteSchema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    assertSafeProjectPath(body.path)
    const existing = await db.codeFile.findUnique({
      where: { projectId_path: { projectId: id, path: body.path } },
    })
    if (!existing) {
      throw new BeanApiError('NOT_FOUND', `File ${body.path} is not part of this project.`)
    }
    await db.codeFile.delete({ where: { id: existing.id } })
    // Record the deletion as a version (best-effort, same contract as save).
    let versionSeq: number | null = null
    try {
      const snapshot = await snapshotProjectVersion({
        projectId: id,
        kind: 'file-delete',
        summary: `Deleted ${body.path}`,
      })
      versionSeq = snapshot.version?.seq ?? null
    } catch (e) {
      if (e instanceof VersionError && e.code === 'LIMIT') {
        throw new BeanApiError('VALIDATION_ERROR', `${e.message} The file itself was deleted.`)
      }
    }
    await recordAudit({ actorId: user.id, action: 'code-giftz.file_delete', target: id, meta: { path: body.path, versionSeq } })
    return ok({ deleted: body.path, versionSeq })
  })
}
