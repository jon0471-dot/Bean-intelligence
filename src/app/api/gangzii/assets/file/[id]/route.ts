/**
 * GANGZII — owner-checked audio asset delivery (M27).
 * Files live outside /public; every byte served passes an ownership check.
 */
import fs from 'fs'
import path from 'path'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { GANGZII_STORAGE_ROOT, AUDIO_CONTENT_TYPES } from '@/lib/gangzii/audio-upload'
import { db } from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    if (!/^[\w-]+$/.test(id)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Invalid asset identifier.')
    }
    const asset = await db.gangziiAudioAsset.findUnique({ where: { id } })
    if (!asset || asset.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Asset not found.')
    }
    const resolved = path.join(GANGZII_STORAGE_ROOT, asset.relPath)
    if (!resolved.startsWith(GANGZII_STORAGE_ROOT) || !resolved.includes(user.id)) {
      throw new BeanApiError('NOT_FOUND', 'Audio file not found.')
    }
    if (!fs.existsSync(resolved)) {
      throw new BeanApiError('NOT_FOUND', 'Audio file is no longer available.')
    }
    const bytes = fs.readFileSync(resolved)
    const download = new URL(request.url).searchParams.get('download') === '1'
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': AUDIO_CONTENT_TYPES[asset.container] ?? 'application/octet-stream',
        'content-length': String(bytes.length),
        ...(download ? { 'content-disposition': `attachment; filename="${asset.displayName.replace(/[^a-zA-Z0-9._-]/g, '_')}"` } : {}),
        'cache-control': 'private, max-age=60',
      },
    })
  })
}
