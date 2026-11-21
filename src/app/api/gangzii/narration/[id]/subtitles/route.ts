/**
 * GANGZII — narration subtitles (M27).
 * GET ?format=srt|vtt → segment-level subtitles built from MEASURED segment
 * durations. Segments without measured audio are skipped (never estimated);
 * the response carries the approximation note the UI must display.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { narrationSubtitles } from '@/lib/gangzii/narration-service'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const format = new URL(request.url).searchParams.get('format') === 'vtt' ? 'vtt' : 'srt'
    const res = await narrationSubtitles(id, user.id, format)
    return ok({ format, ...res })
  })
}
