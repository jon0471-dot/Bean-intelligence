/**
 * CODE GIFTZ — duplicate project (M22).
 *
 * Deep copy of the owner's project: metadata, files, conversation messages
 * and an initial version snapshot on the copy. The original is untouched;
 * the copy gets a fresh identity ("Title (copy)"). Owner-only.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { snapshotProjectVersion } from '@/lib/code/versioning'

export async function POST(
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
    const files = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
    const messages = await db.codeMessage.findMany({ where: { projectId: id }, orderBy: { createdAt: 'asc' } })

    const copy = await db.codeProject.create({
      data: {
        userId: user.id,
        title: `${project.title} (copy)`.slice(0, 500),
        description: project.description,
        framework: project.framework,
        language: project.language,
        status: 'active',
      },
    })
    if (files.length > 0) {
      await db.codeFile.createMany({
        data: files.map((f) => ({
          projectId: copy.id,
          path: f.path,
          content: f.content,
          origin: f.origin,
        })),
      })
    }
    if (messages.length > 0) {
      await db.codeMessage.createMany({
        data: messages.map((m) => ({
          projectId: copy.id,
          role: m.role,
          content: m.content,
          metaJson: m.metaJson,
          createdAt: m.createdAt,
        })),
      })
    }
    // The copy records its own initial version (blob store is per project).
    let versionSeq: number | null = null
    try {
      const snapshot = await snapshotProjectVersion({
        projectId: copy.id,
        kind: 'initial',
        summary: `Duplicated from project "${project.title}"`,
      })
      versionSeq = snapshot.version?.seq ?? null
    } catch {
      // A snapshot failure never blocks the copy itself.
    }
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_duplicate', target: id, meta: { copyId: copy.id, files: files.length } })
    return ok({
      project: {
        id: copy.id,
        title: copy.title,
        files: files.length,
        messages: messages.length,
        versionSeq,
      },
    })
  })
}
