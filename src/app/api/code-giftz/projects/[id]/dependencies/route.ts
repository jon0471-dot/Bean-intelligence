/**
 * CODE GIFTZ — dependency analysis (M22, owner-only).
 *
 * PURE static inspection of the project's files (package manager from the
 * lockfile, missing/unused/duplicate/unpinned dependencies, build-script
 * validation). No execution happens here — an actual install/build attempt
 * goes through the sandbox build route with explicit approval, and its real
 * result (including an honest failure from the sandbox's network isolation)
 * is recorded verbatim.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { analyzeDependencies } from '@/lib/code/dependency-analysis'

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
    const files = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
    const report = analyzeDependencies(files.map((f) => ({ path: f.path, content: f.content })))
    await recordAudit({ actorId: user.id, action: 'code-giftz.dependency_analysis', target: id })
    return ok({
      report: {
        ...report,
        // Honest context about the project's recorded metadata.
        framework: project.framework ?? null,
        language: project.language ?? null,
      },
    })
  })
}
