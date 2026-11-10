import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import {
  GANGZII_VOICE_CATEGORIES,
  GANGZII_VOICE_PRESETS,
  GANGZII_VOICE_CONTROLS,
  GANGZII_LANGUAGE_COVERAGE,
} from '@/lib/registry/gangzii-presets'
import { TTS_SPEED_MIN, TTS_SPEED_MAX } from '@/lib/adapters/hosted-audio'
import { GANGZII_LIMITS } from '@/lib/registry/products'

/**
 * GANGZII — voice preset catalog (authenticated).
 *
 * The single served source of the voice registry: categorized presets,
 * per-voice preview text and the controls the provider GENUINELY supports.
 * The frontend renders THIS response (with the client-safe registry as a
 * render-before-fetch fallback); it never maintains its own voice list.
 */
export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({
      categories: GANGZII_VOICE_CATEGORIES,
      presets: GANGZII_VOICE_PRESETS.map((v) => ({
        id: v.id,
        displayName: v.displayName,
        providerVoiceId: v.providerVoiceId,
        category: v.category,
        description: v.description,
        previewText: v.previewText,
        languages: v.languages,
      })),
      controls: GANGZII_VOICE_CONTROLS,
      languageCoverage: GANGZII_LANGUAGE_COVERAGE,
      limits: {
        speedMin: TTS_SPEED_MIN,
        speedMax: TTS_SPEED_MAX,
        maxCharsPerRequest: GANGZII_LIMITS.maxCharsPerRequest,
        outputFormat: GANGZII_LIMITS.outputFormat,
        sampleRateHz: GANGZII_LIMITS.sampleRateHz,
        // Upstream truth: the speech provider emits mono. Stereo output is
        // a local dual-mono EXPORT (channel duplication), not a provider
        // capability — the UI labels it that way.
        sourceChannels: 1,
        stereoExport: 'dual-mono',
      },
    })
  })
}
