/**
 * CODE GIFTZ — complete project export (M22, owner-only).
 *
 * Streams a verified ZIP of the whole project: full source tree, nested
 * folders, package manifest/lockfile when the project has them, README with
 * honest build instructions and a manifest.json describing exactly what
 * shipped and what was excluded.
 *
 * Security contract (src/lib/code/export.ts):
 *   - .env / secret-named / credential / cookie files are EXCLUDED by policy;
 *   - files whose CONTENT trips the secret scan are excluded (fail-closed);
 *   - node_modules / build outputs / logs are excluded;
 *   - every entry name is re-validated against path traversal;
 *   - the archive is REOPENED and verified (entry count, names, per-file
 *     SHA-256 vs manifest) before it is ever returned.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit, recordUsage } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { buildProjectZip, verifyExportZip } from '@/lib/code/export'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth first (this is a browser download; the session cookie rides along).
  const user = await requireUser().catch(() => null)
  const { id } = await params
  if (!user) return new Response('Unauthorized', { status: 401 })
  const project = await db.codeProject.findUnique({ where: { id } })
  if (!project || project.userId !== user.id) {
    return new Response('Not found', { status: 404 })
  }

  const files = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
  const versionCount = await db.codeVersion.count({ where: { projectId: id } })

  try {
    const built = await buildProjectZip(
      {
        title: project.title,
        description: project.description,
        framework: project.framework,
        language: project.language,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        currentVersion: project.currentVersion,
        versionCount,
      },
      files.map((f) => ({ path: f.path, content: f.content })),
      versionCount,
    )
    // Verify BEFORE shipping: reopen the archive, count entries, check every
    // name and content hash against the manifest.
    const verification = await verifyExportZip(built.zip, built.manifest)
    if (!verification.ok) {
      logger.error('giftz.export_verification_failed', { projectId: id, issues: verification.issues })
      return new Response('Export verification failed — the archive was not shipped.', { status: 500 })
    }
    await recordAudit({
      actorId: user.id,
      action: 'code-giftz.project_export',
      target: id,
      meta: { files: built.includedCount, excluded: built.excludedCount, entries: verification.entries },
    })
    await recordUsage({
      userId: user.id,
      product: 'code-giftz',
      backendId: null, // local archive build — no upstream backend involved
      kind: 'coding-task',
      durationMs: 0,
      success: true,
    })
    const safeName = (project.title.replace(/[^\w.\- ]+/g, '').trim() || 'project').slice(0, 60)
    return new Response(new Uint8Array(built.zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${encodeURIComponent(safeName)}.zip"`,
        'cache-control': 'no-store',
        'x-export-files': String(built.includedCount),
        'x-export-excluded': String(built.excludedCount),
      },
    })
  } catch (e) {
    // Bounded-export failures (no files / over budget) are client-honest 400s;
    // anything else stays an internal error with no internal detail leaked.
    const message = e instanceof Error ? e.message : 'Export failed.'
    if (/no exportable files|export limit|size budget/.test(message)) {
      return new Response(message, { status: 400 })
    }
    logger.error('giftz.export_failed', { projectId: id, message })
    return new Response('Export failed.', { status: 500 })
  }
}
