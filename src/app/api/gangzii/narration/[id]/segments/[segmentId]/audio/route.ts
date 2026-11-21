/**
 * GANGZII — per-segment narration audio delivery (owner-checked).
 * Files live outside /public under storage/gangzii/<userId>/narration/…
 */
import fs from 'fs'
import path from 'path'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { GANGZII_STORAGE_ROOT, AUDIO_CONTENT_TYPES } from '@/lib/gangzii/audio-upload'
import { db } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; segmentId: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id, segmentId } = await params
    const seg = await db.narrationSegment.findUnique({ where: { id: segmentId } })
    if (!seg || seg.projectId !== id || seg.status !== 'ready' || !seg.artifactRelPath) {
      throw new BeanApiError('NOT_FOUND', 'Segment audio not found or not ready.')
    }
    const project = await db.narrationProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
    }
    const resolved = path.join(GANGZII_STORAGE_ROOT, seg.artifactRelPath)
    if (!resolved.startsWith(GANGZII_STORAGE_ROOT) || !resolved.includes(user.id)) {
      throw new BeanApiError('NOT_FOUND', 'Audio file not found.')
    }
    if (!fs.existsSync(resolved)) {
      throw new BeanApiError('NOT_FOUND', 'Audio file is no longer available.')
    }
    const bytes = fs.readFileSync(resolved)
    const download = new URL(_request.url).searchParams.get('download') === '1'
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': AUDIO_CONTENT_TYPES.wav ?? 'audio/wav',
        'content-length': String(bytes.length),
        ...(download ? { 'content-disposition': `attachment; filename="narration-segment-${seg.idx}.wav"` } : {}),
        'cache-control': 'private, max-age=60',
      },
    })
  })
}
