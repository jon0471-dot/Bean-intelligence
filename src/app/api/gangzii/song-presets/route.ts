import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { GANGZII_SONG_PRESETS } from '@/lib/registry/gangzii-presets'
import { getBackend } from '@/lib/registry/backends'

/**
 * GANGZII — song preset catalog (authenticated).
 *
 * Serves the shared song-preset registry with LIVE capability truth merged
 * from the private backend registry: with no deployed music worker every
 * preset reports generationAvailable:false plus the registry's own
 * truthful reason. Presets remain fully real for RIISHE lyric styling
 * (genre/mood/instrumentation hints), which IS a working capability.
 */
export async function GET() {
  return handle(async () => {
    await requireUser()
    const musicBackend = getBackend('bean-music-selfhosted-candidate')
    const reason =
      musicBackend?.unavailableReason ??
      'No music-generation backend is configured on this deployment.'

    return ok({
      // One availability block for the whole family: a music worker either
      // exists or it does not; per-preset availability cannot exceed it.
      generation: {
        available: Boolean(musicBackend?.enabled),
        reason,
        // Singing = a real singing/music model. This deployment has none,
        // so no preset may claim sung-vocal output today.
        singingAvailable: false,
      },
      presets: GANGZII_SONG_PRESETS.map((p) => ({
        ...p,
        generationAvailable: Boolean(musicBackend?.enabled),
        unavailableReason: musicBackend?.enabled ? undefined : reason,
      })),
    })
  })
}
