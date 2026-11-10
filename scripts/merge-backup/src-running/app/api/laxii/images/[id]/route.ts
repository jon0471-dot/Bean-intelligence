import { db } from '@/lib/db'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import fs from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'laxii')

/**
 * Authenticated image delivery. Files live outside /public on purpose —
 * every byte served passes an ownership check. Unknown files 404 cleanly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser()
    const { id } = await params

    // id must be the job id; verify ownership before touching the filesystem.
    if (!/^[\w-]+$/.test(id)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Invalid image identifier.')
    }
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'laxii' || job.status !== 'completed') {
      throw new BeanApiError('NOT_FOUND', 'Image not found or not ready.')
    }

    const file = path.join(STORAGE_ROOT, user.id, `${id}.jpg`)
    if (!file.startsWith(STORAGE_ROOT) || !fs.existsSync(file)) {
      throw new BeanApiError('NOT_FOUND', 'Image file is no longer available.')
    }
    const bytes = fs.readFileSync(file)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=3600',
        'content-disposition': `inline; filename="bean-laxii-${id}.jpg"`,
      },
    })
  } catch (err) {
    if (err instanceof BeanApiError) return err.toResponse()
    return new BeanApiError('INTERNAL_ERROR', 'Could not load the image.').toResponse()
  }
}
