import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { getProduct } from '@/lib/registry/products'
import { getBackend } from '@/lib/registry/backends'
import { getSongPreset } from '@/lib/registry/gangzii-presets'

const schema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  /** Song preset the user selected — validated against the shared registry. */
  presetId: z.string().trim().max(64).optional(),
  /** 'sung' vocals or 'instrumental' — must be a mode the preset declares. */
  vocalMode: z.enum(['sung', 'instrumental']).optional(),
  /** Approved lyrics for singing submissions (never sent to TTS as a fake song). */
  lyrics: z.string().trim().max(6000).optional(),
})

/**
 * GANGZII — Song Studio music/singing generation.
 *
 * TRUTH POLICY: no music backend is deployed (the ACE-Step 1.5 candidate's
 * weight license is still under review and no GPU worker exists), so the
 * router rejects here with a clear, stable error. The rejected attempt is
 * recorded as `unsupported` for transparency — NEVER as queued/running/
 * completed — and no synthetic audio is fabricated. Spoken TTS is NEVER
 * returned as a fake song: lyrics stay in the lyrics editor and the only
 * audio derived from them is the explicitly-labeled spoken preview.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    // Validate the preset submission BEFORE recording the attempt so an
    // unknown preset or a mode the preset does not declare fails clearly.
    let presetMeta: { id: string; displayName: string; genre: string; mood: string } | null = null
    if (body.presetId) {
      const preset = getSongPreset(body.presetId)
      if (!preset) {
        return ok(
          {
            rejected: true,
            code: 'VALIDATION_ERROR',
            message:
              'Unknown song preset. Reload the Song Studio presets and pick one from the catalog — invalid preset submissions are not attempted.',
          },
          { status: 200 },
        )
      }
      if (body.vocalMode && !preset.vocalModes.includes(body.vocalMode)) {
        return ok(
          {
            rejected: true,
            code: 'VALIDATION_ERROR',
            message: `"${preset.displayName}" supports ${preset.vocalModes.join(' and ')} output only — the requested vocal mode is not part of this preset.`,
          },
          { status: 200 },
        )
      }
      presetMeta = { id: preset.id, displayName: preset.displayName, genre: preset.genre, mood: preset.mood }
    }

    try {
      await preflight(user.id, 'gangzii', 'music-generation')
      // Unreachable today: the registry entry is disabled, preflight throws.
    } catch {
      await db.generationJob.create({
        data: {
          userId: user.id,
          product: 'gangzii',
          task: 'music-generation',
          status: 'unsupported',
          progress: 0,
          paramsJson: JSON.stringify({
            prompt: body.prompt,
            presetId: presetMeta?.id ?? null,
            vocalMode: body.vocalMode ?? null,
            lyricsChars: body.lyrics?.length ?? 0,
          }),
          errorCode: 'NO_BACKEND',
          errorMessage:
            'GANGZII music generation is not operational: no GPU worker is deployed and the candidate checkpoint license is still under review.',
          finishedAt: new Date(),
        },
      })
      return ok(
        {
          rejected: true,
          code: 'NO_BACKEND',
          message:
            'Music generation is unavailable — it requires a self-hosted GPU worker (ACE-Step 1.5 candidate) whose model-weight license is still under review. BEAN does not simulate music and never returns spoken TTS as a song. Lyrics drafting, analysis and spoken previews here are real and fully functional.',
        },
        { status: 200 },
      )
    }

    // Defensive: if a backend is ever enabled without an implementation.
    return ok(
      { rejected: true, code: 'NO_BACKEND', message: 'Music backend has no adapter implementation.' },
      { status: 200 },
    )
  })
}

/** Music attempt history (shows truthful `unsupported` records). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'gangzii', task: 'music-generation' },
      orderBy: { queuedAt: 'desc' },
      take: 10,
    })
    const backend = getBackend('bean-music-selfhosted-candidate')
    const product = getProduct('gangzii')
    return ok({
      productAvailability: {
        available: false,
        reason: backend?.unavailableReason ?? 'No backend configured.',
        product: product?.name ?? 'GANGZII',
      },
      attempts: jobs.map((j) => {
        const params = JSON.parse(j.paramsJson) as { presetId?: string; vocalMode?: string }
        return {
          id: j.id,
          status: j.status,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          presetId: params.presetId ?? null,
          vocalMode: params.vocalMode ?? null,
          queuedAt: j.queuedAt,
        }
      }),
    })
  })
}
