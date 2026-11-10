import { db } from '@/lib/db'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { readGangziiFile, AUDIO_CONTENT_TYPES } from '@/lib/gangzii/audio-upload'

/**
 * Authenticated audio delivery for GANGZII artifacts (synthesized speech,
 * original uploads, converted files). Files live outside /public on purpose
 * — every byte served passes an ownership check.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser()
    const { id } = await params
    if (!/^[\w-]+$/.test(id)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Invalid audio identifier.')
    }
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'gangzii' || job.status !== 'completed') {
      throw new BeanApiError('NOT_FOUND', 'Audio not found or not ready.')
    }

    const result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null
    let relPath: string | null = null
    let ext = 'wav'

    if (job.task === 'speech-synthesis') {
      relPath = `${job.userId}/tts/${job.id}.wav`
      ext = 'wav'
    } else if (job.task === 'audio-transcription') {
      const p = JSON.parse(job.paramsJson) as { uploadRelPath?: string }
      relPath = p.uploadRelPath ?? null
      ext = relPath?.split('.').pop() ?? 'wav'
    } else if (job.task === 'audio-conversion') {
      const p = JSON.parse(job.paramsJson) as { target?: string }
      ext = p.target ?? 'wav'
      relPath = `${job.userId}/convert/${job.id}.${ext}`
    } else {
      // Live-voice spoken replies land here too (task speech-synthesis
      // with source 'live') — same artifact layout.
      const p = JSON.parse(job.paramsJson) as { source?: string }
      if (p.source === 'live') {
        relPath = `${job.userId}/tts/${job.id}.wav`
        ext = 'wav'
      }
    }

    if (!relPath) {
      throw new BeanApiError('NOT_FOUND', 'No audio artifact is attached to this job.')
    }

    const bytes = readGangziiFile(relPath, user.id)
    const download = new URL(request.url).searchParams.get('download') === '1'
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': AUDIO_CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=600',
        'content-disposition': `${download ? 'attachment' : 'inline'}; filename="bean-gangzii-${id}.${ext}"`,
        'accept-ranges': 'none',
      },
    })
  } catch (err) {
    if (err instanceof BeanApiError) return err.toResponse()
    return new BeanApiError('INTERNAL_ERROR', 'Could not load the audio.').toResponse()
  }
}

