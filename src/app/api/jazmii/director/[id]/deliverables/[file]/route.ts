import fs from 'fs'
import path from 'path'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getProductionForOwner } from '@/lib/jazmii/director/service'
import { absoluteFromStorage } from '@/lib/jazmii/director/media'

/**
 * JAZMII AUTO DIRECTOR — serve one deliverable file (owner-scoped).
 *
 * Path safety: the requested file is a FIXED slug mapped through the
 * production's persisted deliverable manifest — the client never supplies
 * any path component, and the manifest path is storage-relative (validated
 * to stay inside the production workspace).
 */
const SLUGS: Record<string, { contentType: string; disposition: boolean }> = {
  video: { contentType: 'video/mp4', disposition: true },
  poster: { contentType: 'image/jpeg', disposition: true },
  captions: { contentType: 'text/plain; charset=utf-8', disposition: true },
  storyboard: { contentType: 'application/json; charset=utf-8', disposition: true },
  plan: { contentType: 'text/markdown; charset=utf-8', disposition: true },
  'share-copy': { contentType: 'text/plain; charset=utf-8', disposition: true },
  'render-metadata': { contentType: 'application/json; charset=utf-8', disposition: true },
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, file } = await params
    const meta = SLUGS[file]
    if (!meta) throw new BeanApiError('NOT_FOUND', 'Unknown deliverable.')
    const production = await getProductionForOwner(user.id, id)
    if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
    if (!production.deliverableJson) {
      throw new BeanApiError('NOT_FOUND', 'No deliverables yet — the production has not finished.')
    }
    let manifest: Record<string, string> = {}
    try {
      manifest = JSON.parse(production.deliverableJson) as Record<string, string>
    } catch {
      throw new BeanApiError('NOT_FOUND', 'The deliverable manifest is unreadable.')
    }
    const rel = manifest[file]
    if (!rel || typeof rel !== 'string') throw new BeanApiError('NOT_FOUND', 'That deliverable was not produced.')
    // Defense-in-depth: the manifest value must be a plain storage-relative
    // path (no traversal), and the resolved file must live inside the
    // production workspace.
    if (rel.includes('..') || path.isAbsolute(rel)) {
      throw new BeanApiError('NOT_FOUND', 'Invalid deliverable path.')
    }
    const abs = absoluteFromStorage(rel)
    const workspaceRoot = path.join(process.cwd(), 'storage', 'jazmii', user.id, 'productions', production.id)
    const resolvedRoot = path.resolve(workspaceRoot)
    if (!path.resolve(abs).startsWith(resolvedRoot + path.sep)) {
      throw new BeanApiError('NOT_FOUND', 'Invalid deliverable path.')
    }
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(abs)
    } catch {
      throw new BeanApiError('NOT_FOUND', 'The deliverable file is missing from storage.')
    }
    const ext = path.extname(abs)
    const headers: Record<string, string> = {
      'Content-Type': meta.contentType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    }
    if (meta.disposition) {
      const downloadName = `${file}${ext || ''}`.replace(/[^A-Za-z0-9._-]/g, '')
      headers['Content-Disposition'] = `attachment; filename="${production.id.slice(0, 8)}-${downloadName}"`
    }
    return new Response(new Uint8Array(bytes), { status: 200, headers })
  })
}
