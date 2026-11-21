/**
 * GANGZII — per-capability availability, MEASURED on request.
 *
 * Probes are real (tiny TTS call, chained ASR call, ffmpeg binary check,
 * local ONNX model check) and TTL-cached inside the adapters (shared
 * process-wide via globalThis) so this endpoint is cheap on repeat loads.
 * The LLM conversation probe is cached by hostedLlmAdapter.health() itself
 * (60s healthy / 10s rate-limited) — the former route-level second cache
 * layer was removed during the 2026-10-27 rate-limit incident: two
 * divergent TTL layers let stale "unavailable" reports outlive the
 * adapter's fast-recovery window.
 * Music generation is reported from the private registry: disabled backends
 * are unavailable — with their truthful reason.
 * M27 (2026-11-21): the LOCAL engine (Kokoro-82M) and the audio-production
 * family are measured and reported; speechSynthesis aggregates BOTH engines
 * (served = local OR hosted), each carrying its own detail.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { hostedAudioAdapter } from '@/lib/adapters/hosted-audio'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { kokoroTtsEngine } from '@/lib/gangzii/tts-engine'
import { getBackend } from '@/lib/registry/backends'

export async function GET() {
  return handle(async () => {
    await requireUser()

    const [tts, asr, ffmpeg, llm, localTts] = await Promise.all([
      hostedAudioAdapter.healthTts(),
      hostedAudioAdapter.healthAsr(),
      hostedAudioAdapter.healthFfmpeg(),
      hostedLlmAdapter.health(),
      kokoroTtsEngine.health(),
    ])

    const musicBackend = getBackend('bean-music-selfhosted-candidate')

    const capabilities = {
      speechSynthesis: {
        available: tts.healthy || localTts.healthy,
        detail: localTts.healthy
          ? `Two engines serve speech: the local Kokoro-82M engine (${localTts.detail}) and the hosted gateway when you pick a hosted voice.`
          : tts.detail,
        latencyMs: tts.healthy ? tts.latencyMs : localTts.latencyMs,
        checkedAt: tts.healthy ? tts.checkedAt : new Date().toISOString(),
      },
      localTts: {
        available: localTts.healthy,
        detail: localTts.detail,
        latencyMs: localTts.latencyMs,
        checkedAt: new Date().toISOString(),
        installed: kokoroTtsEngine.getRuntimeStatus().installed,
        installing: kokoroTtsEngine.getRuntimeStatus().installing,
        installProgress: kokoroTtsEngine.getRuntimeStatus().installProgress,
        approxDownloadMb: 92,
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
      audioProduction: {
        available: ffmpeg.healthy,
        detail: ffmpeg.healthy
          ? 'Audio production ready: trim, fade, volume, static ducking, basic EQ, compression, limiting, one-pass loudness normalization and master export, with EBUR128 loudness measured on every result. A transcoded track is never labeled mastered unless a mastering operation ran.'
          : 'Audio production requires the local ffmpeg toolchain, which is not usable right now.',
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
        // M27 honesty: separation/denoise/cloning remain UNSUPPORTED — the
        // ffmpeg production family (trim/fade/duck/EQ/loudness) is a
        // DIFFERENT capability and is reported by audioProduction above.
        available: false,
        detail:
          'Source separation, denoising and voice cloning are not supported. Voice cloning is out of scope for this release and requires its own consent + rights design before any implementation.',
        latencyMs: null as number | null,
        checkedAt: new Date().toISOString(),
      },
    }

    const coreAvailable =
      capabilities.speechSynthesis.available ||
      capabilities.transcription.available ||
      capabilities.conversion.available ||
      capabilities.audioProduction.available

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
