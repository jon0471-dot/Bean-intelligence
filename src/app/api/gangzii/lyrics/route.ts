import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { recordUsage } from '@/lib/observability/metering'
import { getSongPreset } from '@/lib/registry/gangzii-presets'

const schema = z.object({
  prompt: z.string().trim().min(4, 'Describe the song idea (at least 4 characters).').max(2000),
  style: z.string().trim().max(400).optional(),
  /** Song-preset id — its REAL genre/mood metadata steers RIISHE's draft. */
  presetId: z.string().trim().max(64).optional(),
  /** Free-form lyrics preferences (structure, rhyme, language feel…). */
  preferences: z.string().trim().max(400).optional(),
})

/**
 * RIISHE system role for GANGZII Song Studio lyric drafting. RIISHE writes
 * ORIGINAL lyrics only — never copyrighted text, never quoted songs.
 */
const SYSTEM_PROMPT = [
  'You are RIISHE, the BEAN Intelligence lyric-writing intelligence serving GANGZII Song Studio.',
  'Write original song lyrics from the user idea. Structure them with short section',
  'labels in square brackets like [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]',
  'when they serve the song. Keep the lyrics original: never reproduce copyrighted',
  'lyrics or quote existing songs. Match the requested style, genre and mood.',
  'Favor natural phrasing that is actually singable: balanced syllables, clean rhymes,',
  'concrete imagery, and a chorus that could carry a song. Answer with ONLY the',
  'lyrics text — no preamble, no explanations.',
].join(' ')

/**
 * GANGZII Song Studio — "Write Lyrics with RIISHE" (REAL capability).
 *
 * Uses the existing BEAN conversation-model adapter (the same adapter that
 * powers RIISHE, attributed here to GANGZII's own backend/quotas). RIISHE
 * receives the song idea plus any preset-derived genre/mood metadata and
 * free-form preferences, and returns original lyrics.
 *
 * Honesty rules: an empty or whitespace-only result is a hard failure
 * (LYRICS_EMPTY) — the UI never shows a fake success; the result is
 * generated text and is labeled as such; the spoken preview of lyrics is
 * TTS and is explicitly NOT singing.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    let presetContext: string | null = null
    if (body.presetId) {
      const preset = getSongPreset(body.presetId)
      if (!preset) {
        throw new BeanApiError(
          'VALIDATION_ERROR',
          'Unknown song preset. Reload the Song Studio presets and pick one from the catalog.',
        )
      }
      presetContext = `Style preset "${preset.displayName}": genre ${preset.genre}; mood ${preset.mood}; instrumentation such as ${preset.instrumentation.slice(0, 4).join(', ')}; energy ${preset.energy}/5. Lyric guidance: ${preset.lyricStyleHint}.`
    }

    const { backend, adapter, release } = await preflight(user.id, 'gangzii', 'chat')

    try {
      const userContent = [
        `Song idea: ${body.prompt}`,
        presetContext,
        body.style ? `Extra style/mood guidance: ${body.style}` : null,
        body.preferences ? `Lyrics preferences: ${body.preferences}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      const caps = assertChatRequest(backend, [{ role: 'user', content: userContent }])
      const result = await adapter.chat!({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        maxPromptChars: caps.maxPromptChars,
        maxHistoryMessages: caps.maxHistoryMessages,
        timeoutMs: backend.timeouts.requestMs,
      })

      const lyrics = result.content.trim()
      if (lyrics.length < 8) {
        // Never surface an empty draft as success.
        throw new BeanApiError(
          'BACKEND_FAILURE',
          'RIISHE returned no usable lyrics for this idea. Try rephrasing the song idea or the style hints, then send it again.',
        )
      }

      await recordUsage({
        userId: user.id,
        product: 'gangzii',
        backendId: backend.id,
        kind: 'chat',
        tokensIn: result.tokensInEst,
        tokensOut: result.tokensOutEst,
        durationMs: result.durationMs,
        success: true,
      })

      return ok({
        lyrics,
        writtenBy: 'RIISHE',
        durationMs: result.durationMs,
        note: 'Lyrics are AI-generated text written by RIISHE. The spoken preview is TTS — spoken, not sung.',
      })
    } finally {
      release()
    }
  })
}
