/**
 * GANGZII — per-capability availability, MEASURED on request.
 *
 * Probes are real (tiny TTS call, chained ASR call, ffmpeg binary check) and
 * TTL-cached inside the adapters (shared process-wide via globalThis) so this
 * endpoint is cheap on repeat loads. The LLM conversation probe is cached by
 * hostedLlmAdapter.health() itself (60s healthy / 10s rate-limited) — the
 * former route-level second cache layer was removed during the 2026-10-27
 * rate-limit incident: two divergent TTL layers let stale "unavailable"
 * reports outlive the adapter's fast-recovery window.
 * Music generation and the audio-tools family are reported from the private
 * registry: disabled backends are unavailable — with their truthful reason.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { hostedAudioAdapter } from '@/lib/adapters/hosted-audio'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { getBackend } from '@/lib/registry/backends'

export async function GET() {
  return handle(async () => {
    await requireUser()

    const [tts, asr, ffmpeg, llm] = await Promise.all([
      hostedAudioAdapter.healthTts(),
      hostedAudioAdapter.healthAsr(),
      hostedAudioAdapter.healthFfmpeg(),
      hostedLlmAdapter.health(),
    ])

    const musicBackend = getBackend('bean-music-selfhosted-candidate')
    const toolsBackend = getBackend('bean-audio-tools-selfhosted-candidate')

    const capabilities = {
      speechSynthesis: {
        available: tts.healthy,
        detail: tts.detail,
        latencyMs: tts.latencyMs,
        checkedAt: tts.checkedAt,
      },
      transcription: {
        available: asr.healthy,
        detail: asr.detail,
        latencyMs: asr.latencyMs,
        checkedAt: asr.checkedAt,
      },
      conversion: {
        available: ffmpeg.healthy,
        detail: ffmpeg.detail,
        latencyMs: ffmpeg.latencyMs,
        checkedAt: ffmpeg.checkedAt,
      },
      stereoExport: {
        available: ffmpeg.healthy,
        detail: ffmpeg.healthy
          ? 'Mono/stereo WAV & MP3 export ready. The speech source is mono (provider output); stereo is a dual-mono export — the mono signal duplicated to L/R, not spatial stereo. Every export is ffprobe-verified before it is labeled.'
          : 'Export requires the local ffmpeg transcoder, which is not usable right now.',
        latencyMs: ffmpeg.latencyMs,
        checkedAt: ffmpeg.checkedAt,
      },
      conversation: {
        available: llm.healthy,
        detail: llm.detail,
        latencyMs: llm.latencyMs,
        checkedAt: llm.checkedAt,
      },
      liveVoice: {
        available: tts.healthy && asr.healthy && llm.healthy,
        detail:
          tts.healthy && asr.healthy && llm.healthy
            ? 'Turn-based voice pipeline ready: speech recognition, the BEAN conversation model and speech synthesis are all responding.'
            : 'Live voice needs speech recognition, the conversation model and speech synthesis — at least one is not responding right now.',
        latencyMs: null as number | null,
        checkedAt: new Date().toISOString(),
      },
      musicGeneration: {
        available: false,
        detail: musicBackend?.unavailableReason ?? 'No music backend configured.',
        latencyMs: null as number | null,
        checkedAt: new Date().toISOString(),
      },
      audioTools: {
        available: false,
        detail: toolsBackend?.unavailableReason ?? 'No audio-tools backend configured.',
        latencyMs: null as number | null,
        checkedAt: new Date().toISOString(),
      },
    }

    const coreAvailable =
      capabilities.speechSynthesis.available ||
      capabilities.transcription.available ||
      capabilities.conversion.available

    return ok({
      product: 'gangzii',
      available: coreAvailable,
      // Partial = the product works but at least one registered capability
      // is not deployed (music generation, cloning/separation tools).
      partial: coreAvailable && !(capabilities.musicGeneration.available && capabilities.audioTools.available),
      capabilities,
    })
  })
}
