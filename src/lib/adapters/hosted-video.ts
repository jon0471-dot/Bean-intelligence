/**
 * BEAN Intelligence — authorized hosted video adapter (JAZMII).
 *
 * REAL integration against the authorized gateway's async video API
 * (verified SDK surface, dist/index.d.ts):
 *   - `video.generations.create({ prompt, image_url?, quality, with_audio,
 *      watermark_enabled, size, fps, duration })` → `{ id, task_status }`
 *   - `async.result.query(taskId)` → `{ task_status, video_result?[{url}] }`
 *
 * TRUTH POLICY:
 *  - a submission returns a REAL provider task id, never a synthetic one;
 *  - polling reads the provider's own task status (PROCESSING/SUCCESS/FAIL);
 *  - the output is downloaded SERVER-SIDE and validated by container magic
 *    bytes (mp4 `ftyp` / webm EBML) before it is stored — a URL alone is
 *    never accepted as a completed video;
 *  - the provider's download URL is never exposed to the client (the media
 *    is re-served from BEAN storage under per-user authorization);
 *  - an observed HTTP 429 opens the `video` endpoint-class breaker (PHASE 1
 *    bounded escalating backoff) and fails fast while it is open;
 *  - the provider exposes NO cancel API in the SDK — cancellation in BEAN
 *    means "stop tracking", stated honestly wherever it happens.
 *
 * Health: the same honest two-layer contract as the image adapter — a cheap
 * read-only reachability probe (GET /models, redirect-manual) plus breaker
 * state. Health NEVER runs a generation.
 */
import ZAI from 'z-ai-web-dev-sdk'
import type { HealthFailureCategory, HealthReport, TaskAdapter } from './types'
import {
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  upstreamBreakerState,
  upstreamCoolingDown,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'

const BACKEND_ID = 'bean-video-hosted-primary'

export interface VideoSubmitRequest {
  prompt: string
  /** Image-to-video driver: https URL or data URL (provider-validated). */
  imageUrl?: string
  quality?: 'speed' | 'quality'
  withAudio?: boolean
  /** 'WxH' — format-validated by the route, pass-through to the provider. */
  size?: string
  /** Seconds (provider-validated; errors surface honestly). */
  durationSec?: number
  fps?: number
}

export interface VideoTaskHandle {
  /** Provider task id — PRIVATE; persisted in the job row, never exposed. */
  taskId: string
  providerStatus: string
}

export type VideoTaskState = 'processing' | 'success' | 'fail'

export interface VideoTaskStatus {
  state: VideoTaskState
  videoUrl: string | null
  /** Provider failure text when state=fail (already provider-sanitized). */
  providerMessage: string | null
}

export interface VideoDownload {
  bytes: Buffer
  format: 'mp4' | 'webm'
  bytesLength: number
  durationMs: number
}

/** Max accepted video payload (100 MB) — protects storage from abuse. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024

function classifyVideoError(e: unknown): { status: number | null; message: string } {
  const message = e instanceof Error ? e.message : String(e)
  const m = /\bstatus\s+(\d{3})\b|\bHTTP\s+(\d{3})\b/.exec(message)
  const status = m ? Number(m[1] ?? m[2]) : null
  return { status, message }
}

/** Fail fast (zero network) while the video-class breaker is open. */
function assertVideoGatewayOpen(): void {
  if (upstreamCoolingDown('video')) {
    noteUpstreamSkip('video')
    throw new UpstreamRateLimitError(
      'video',
      'video generation not attempted: the upstream gateway is rate-limited (HTTP 429 observed moments ago); ' +
        'request skipped to avoid worsening the throttle',
      false,
    )
  }
}

/** Submit a REAL asynchronous video-generation task. */
export async function submitVideoJob(req: VideoSubmitRequest): Promise<VideoTaskHandle> {
  assertVideoGatewayOpen()
  const zai = await ZAI.create()
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    quality: req.quality ?? 'quality',
    with_audio: req.withAudio ?? false,
    watermark_enabled: false,
  }
  if (req.imageUrl) body.image_url = req.imageUrl
  if (req.size) body.size = req.size
  if (req.durationSec) body.duration = req.durationSec
  if (req.fps) body.fps = req.fps
  let res: { id?: string; task_status?: string }
  try {
    res = (await zai.video.generations.create(body as never)) as {
      id?: string
      task_status?: string
    }
  } catch (e) {
    const { status, message } = classifyVideoError(e)
    if (status === 429) {
      noteUpstream429('video')
      throw new UpstreamRateLimitError(
        'video',
        `video generation is rate-limited upstream (HTTP 429): ${message.slice(0, 200)}`,
      )
    }
    throw e
  }
  if (!res?.id || typeof res.id !== 'string') {
    throw new Error('Upstream video submission returned no task id')
  }
  noteUpstreamSuccess('video')
  return { taskId: res.id, providerStatus: res.task_status ?? 'PROCESSING' }
}

/** Poll one REAL provider task. Never fabricates a state. */
export async function queryVideoJob(taskId: string): Promise<VideoTaskStatus> {
  const zai = await ZAI.create()
  const res = (await zai.async.result.query(taskId)) as {
    task_status?: string
    video_result?: Array<{ url?: string }>
    video_url?: string
    url?: string
    video?: string
    error?: string | { message?: string }
  }
  const raw = String(res?.task_status ?? 'PROCESSING').toUpperCase()
  const state: VideoTaskState = raw === 'SUCCESS' ? 'success' : raw === 'FAIL' ? 'fail' : 'processing'
  let videoUrl: string | null = null
  if (state === 'success') {
    const fromList = res.video_result?.find((v) => typeof v?.url === 'string')?.url
    videoUrl =
      (typeof fromList === 'string' && fromList) ||
      (typeof res.video_url === 'string' && res.video_url) ||
      (typeof res.url === 'string' && res.url) ||
      (typeof res.video === 'string' && res.video) ||
      null
    if (!videoUrl) {
      // Provider declared success without a retrievable URL — an honest FAIL
      // for retrieval purposes (never a fake completion).
      return { state: 'fail', videoUrl: null, providerMessage: 'Provider reported SUCCESS but returned no video URL.' }
    }
  }
  let providerMessage: string | null = null
  if (state === 'fail') {
    providerMessage =
      typeof res.error === 'string'
        ? res.error.slice(0, 300)
        : typeof res.error?.message === 'string'
          ? res.error.message.slice(0, 300)
          : 'The provider reported the video task as failed.'
  }
  return { state, videoUrl, providerMessage }
}

/** Validate a downloaded payload is a real media container by magic bytes. */
export function detectVideoContainer(bytes: Buffer): 'mp4' | 'webm' | null {
  if (bytes.length < 12) return null
  // mp4: bytes 4..8 are the 'ftyp' box type.
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  // webm/matroska: EBML header 0x1A 0x45 0xDF 0xA3.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  return null
}

/** Download the provider output SERVER-SIDE and validate it. */
export async function downloadVideo(url: string, timeoutMs = 120_000): Promise<VideoDownload> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`video download failed with HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) throw new Error('video download returned an empty payload')
    if (buf.length > VIDEO_MAX_BYTES) throw new Error('video payload exceeds the storage size limit')
    const format = detectVideoContainer(buf)
    if (!format) throw new Error('downloaded payload is not a recognizable video container (mp4/webm)')
    return { bytes: buf, format, bytesLength: buf.length, durationMs: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cheap read-only reachability probe (GET /models, redirect-manual) — the
 * SAME gateway host as the image adapter. Generation capability is NEVER
 * claimed from this probe; real completions come from real jobs only.
 */
async function probeGatewayReachability(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ reachable: boolean; status: number | null; latencyMs: number; error: string | null; redirected: boolean }> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      redirect: 'manual',
    })
    await res.arrayBuffer().catch(() => undefined)
    const redirected = res.status >= 300 && res.status < 400
    return { reachable: true, status: res.status, latencyMs: Date.now() - t0, error: null, redirected }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      reachable: false,
      status: null,
      latencyMs: Date.now() - t0,
      error: aborted ? `no response within ${timeoutMs}ms` : e instanceof Error ? e.message : String(e),
      redirected: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

export const hostedVideoAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    try {
      const zai = await ZAI.create()
      const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string } }).config
      const baseUrl = cfg?.baseUrl
      const apiKey = cfg?.apiKey
      const checkedAt = new Date().toISOString()
      if (!baseUrl || !apiKey) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: Date.now() - t0,
          httpStatus: null,
          failureCategory: 'misconfigured' as HealthFailureCategory,
          detail: 'Misconfigured: gateway client has no baseUrl/apiKey — the video endpoint cannot be reached.',
        }
      }
      const breaker = upstreamBreakerState('video')
      if (breaker.coolingDown) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: null,
          httpStatus: 429,
          failureCategory: 'rate-limited',
          detail: `Video gateway deferred: the video endpoint class is rate-limited (breaker open, ${Math.round(breaker.remainingMs / 1000)}s remaining) — no network call was made.`,
        }
      }
      const reach = await probeGatewayReachability(baseUrl, apiKey, 5_000)
      if (!reach.reachable) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: null,
          failureCategory: reach.error?.startsWith('no response within') ? 'timeout' : 'unreachable',
          detail: `Video backend UNREACHABLE: the configured gateway host answered no request (${reach.error}).`,
        }
      }
      if (reach.redirected) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'redirected',
          detail: `Video backend health NOT verified: the gateway host answered the probe with an HTTP ${reach.status} redirect (never followed).`,
        }
      }
      if (reach.status === 401 || reach.status === 403) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'auth',
          detail: `Video backend misconfigured: gateway reachable (HTTP ${reach.status}) but it rejected the configured credentials.`,
        }
      }
      if (reach.status === 429) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'rate-limited',
          detail: 'Video backend rate-limited: gateway reachable (HTTP 429) and currently throttling requests.',
        }
      }
      if (reach.status !== 404 && (reach.status === null || reach.status < 200 || reach.status > 299)) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'backend-error',
          detail: `Video backend health NOT verified: gateway answered HTTP ${reach.status} (only 2xx or the known-absent metadata route 404 counts as verified).`,
        }
      }
      return {
        healthy: true,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: reach.status,
        failureCategory: null,
        detail:
          'Video gateway reachable and configured. This probe does NOT run a generation — completed real jobs are the capability evidence.',
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: null,
        failureCategory: 'backend-error',
        detail: `Video gateway init failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },
}
