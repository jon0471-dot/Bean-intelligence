/**
 * CODE GIFTZ — preview audit (M22, owner-only).
 *
 * Deterministic static audit behind the visual preview: which HTML entry can
 * render, missing assets, broken internal links and external references the
 * preview CSP will block. Runtime console errors are collected separately —
 * IN the browser — by the preview iframe's error bootstrap; this endpoint
 * never invents runtime observations.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { auditPreview } from '@/lib/code/preview-audit'

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
    const audit = auditPreview(files.map((f) => ({ path: f.path, content: f.content })))
    await recordAudit({ actorId: user.id, action: 'code-giftz.preview_check', target: id })
    return ok({
      audit: {
        ...audit,
        fileCount: files.length,
        // Honest scope statement: static audit + real in-browser console
        // capture; no compiler exists in this preview path by design.
        scope: [
          'Static structural audit of the project HTML (assets, internal links, external references).',
          'Runtime errors are NOT part of this audit — they are captured live in the preview iframe and shown in the workspace.',
          'This preview serves static HTML; there is no build step, so compilation errors do not exist in this path.',
        ],
      },
    })
  })
}
