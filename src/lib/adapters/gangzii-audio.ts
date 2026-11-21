/**
 * BEAN Intelligence — GANGZII audio adapters (router seam).
 *
 * M27 (2026-11-21): the four GANGZII audio backends as TaskAdapter
 * implementations. The ROUTER uses these objects for gates + health;
 * the ACTUAL execution happens in the audio worker (src/lib/jobs/
 * audio-worker.ts) on the durable queue — the same split as the media
 * products. Every health report below is a REAL measured probe:
 *  - local Kokoro: model files on disk + ONNX session load (never assumed);
 *  - hosted TTS / ASR: the live gateway probes (measured since 2026-10-27);
 *  - ffmpeg tools: the local transcoder binary check.
 *
 * SERVER-ONLY.
 */

import { hostedAudioAdapter } from './hosted-audio'
import { kokoroTtsEngine } from '@/lib/gangzii/tts-engine'
import type { HealthReport, TaskAdapter } from './types'

/** GANGZII local-first TTS engine (Kokoro-82M ONNX, CPU). */
class LocalKokoroAdapter implements TaskAdapter {
  readonly backendId = 'bean-audio-tts-local-kokoro'

  async health(): Promise<HealthReport> {
    const h = await kokoroTtsEngine.health()
    return {
      healthy: h.healthy,
      checkedAt: new Date().toISOString(),
      latencyMs: h.latencyMs,
      detail: h.detail,
      failureCategory: h.healthy ? null : 'not-configured',
    }
  }
}

/** GANGZII authorized hosted gateway TTS. */
class HostedGangziiTtsAdapter implements TaskAdapter {
  readonly backendId = 'bean-audio-tts-hosted-primary'

  async health(): Promise<HealthReport> {
    const h = await hostedAudioAdapter.healthTts()
    return {
      healthy: h.healthy,
      checkedAt: h.checkedAt,
      latencyMs: h.latencyMs,
      detail: h.detail,
      failureCategory: h.healthy ? null : 'backend-error',
      cached: true,
    }
  }
}

/** GANGZII authorized hosted gateway ASR (WAV/WebM only — measured). */
class HostedGangziiAsrAdapter implements TaskAdapter {
  readonly backendId = 'bean-audio-asr-hosted-primary'

  async health(): Promise<HealthReport> {
    const h = await hostedAudioAdapter.healthAsr()
    return {
      healthy: h.healthy,
      checkedAt: h.checkedAt,
      latencyMs: h.latencyMs,
      detail: h.detail,
      failureCategory: h.healthy ? null : 'backend-error',
      cached: true,
    }
  }
}

/** GANGZII local ffmpeg tools (conversion + audio production). */
class LocalAudioToolsAdapter implements TaskAdapter {
  readonly backendId: string

  constructor(backendId: string) {
    this.backendId = backendId
  }

  async health(): Promise<HealthReport> {
    const h = await hostedAudioAdapter.healthFfmpeg()
    return {
      healthy: h.healthy,
      checkedAt: h.checkedAt,
      latencyMs: h.latencyMs,
      detail: h.detail,
      failureCategory: h.healthy ? null : 'unreachable',
      cached: true,
    }
  }
}

export const localKokoroAdapter = new LocalKokoroAdapter()
export const hostedGangziiTtsAdapter = new HostedGangziiTtsAdapter()
export const hostedGangziiAsrAdapter = new HostedGangziiAsrAdapter()
export const localAudioToolsAdapter = new LocalAudioToolsAdapter('bean-audio-tools-local-ffmpeg')
export const localAudioConvertAdapter = new LocalAudioToolsAdapter('bean-audio-convert-local-ffmpeg')
