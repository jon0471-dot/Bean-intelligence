import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')

/**
 * Serve a completed JAZMII video from BEAN storage (owner-only).
 *
 * - The provider's own download URL is NEVER used here or exposed — media is
 *   re-served from BEAN storage under per-user authorization.
 * - Path safety: the file name is the DB-verified job id (cuid) with the
 *   extension recorded at completion; no user input ever joins the path.
 * - Basic Range support so preview seeking works without proxying upstream.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'jazmii') {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    if (job.status !== 'completed') {
      throw new BeanApiError('NOT_FOUND', 'No video is available for this job yet.')
    }
    let meta: { format?: string } = {}
    try {
      meta = job.resultJson ? (JSON.parse(job.resultJson) as { format?: string }) : {}
    } catch {
      meta = {}
    }
    const ext = meta.format === 'webm' ? 'webm' : 'mp4'
    // Defense-in-depth: the id must be a plain opaque token — no separators.
    if (!/^[A-Za-z0-9_-]+$/.test(job.id)) {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    const filePath = path.join(STORAGE_ROOT, job.userId, `${job.id}.${ext}`)
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(filePath)
    } catch {
      throw new BeanApiError('NOT_FOUND', 'The video file is missing from storage.')
    }
    const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4'
    const range = request.headers.get('range')
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (m) {
        const start = m[1] ? Number(m[1]) : 0
        const end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1
        if (Number.isFinite(start) && start <= end && start < bytes.length) {
          const slice = bytes.subarray(start, end + 1)
          return new Response(new Uint8Array(slice), {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(slice.length),
              'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'private, no-store',
            },
          })
        }
      }
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
      },
    })
  })
}
