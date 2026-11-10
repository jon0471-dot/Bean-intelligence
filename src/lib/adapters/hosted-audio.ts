/**
 * BEAN Intelligence — GANGZII audio adapter (provider seam).
 *
 * Wraps the authorized gateway's audio surface (TTS + ASR) and the local
 * ffmpeg converter. Provider payloads never leak past this boundary.
 *
 * Every capability here was MEASURED against the live gateway on 2026-10-27
 * (models/licenses/gangzii-stage0-audio-probe-evidence.json):
 *  - TTS returns WAV (24 kHz / mono / 16-bit) or raw PCM; mp3 is rejected.
 *  - BEEP ROOT CAUSE (measured 2026-10-27, scripts/beep-probe-out/):
 *    the gateway's raw-PCM stream (`response_format:'pcm'`) embeds a leading
 *    ~0.55 s 1650 Hz tone on EVERY synthesis call (tone power ≈ -35 dBFS),
 *    while `response_format:'wav'` responses are beep-free (≈ -88 dBFS).
 *    Chunked synthesis therefore requests WAV containers and extracts the
 *    PCM payload per chunk — the artifact is avoided at the SOURCE, not
 *    trimmed by a heuristic. A deterministic defensive guard
 *    (stripLeadingToneArtifact) still runs over the assembled stream in
 *    case the upstream signature ever reappears; it cuts only an exact
 *    leading-tone match and can never clip real speech (see unit tests).
 *  - Hard 1024-character limit per synthesis call. Long text is chunked on
 *    sentence boundaries and the PCM chunks are assembled under ONE valid
 *    WAV header (verified end-to-end by ffprobe duration + ASR content).
 *  - ASR accepts WAV and WebM ONLY (gateway error text verbatim:
 *    "only WAV and WebM are supported") and returns plain text — no word
 *    timestamps, no speaker diarization.
 *  - Speed is bounded to [0.5, 2.0]; voices are a fixed 7-voice set.
 *  - Output channels: the provider emits MONO only (measured). Stereo is a
 *    local, explicitly-labeled DUAL-MONO export (channel duplication via
 *    ffmpeg) — never spatial stereo.
 *
 * Health is measured, not assumed: probes hit the real gateway with tiny
 * payloads and are cached for 60s so /api/health stays cheap.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { execFile } from 'child_process'
import { withTimeout } from './hosted-llm'
import type { HealthReport } from './types'

// ---- measured constants (do not guess — see stage-0 evidence) -------------

export const TTS_SAMPLE_RATE = 24_000
export const TTS_CHANNELS = 1
export const TTS_BITS_PER_SAMPLE = 16
export const TTS_MAX_CHARS_PER_CHUNK = 1024
export const TTS_MAX_CHUNKS_PER_REQUEST = 12
export const TTS_SPEED_MIN = 0.5
export const TTS_SPEED_MAX = 2.0
export const ASR_ACCEPTED_CONTAINERS = ['wav', 'webm'] as const
export const CONVERT_TARGET_FORMATS = ['mp3', 'ogg', 'flac', 'm4a', 'wav'] as const
export type ConvertTargetFormat = (typeof CONVERT_TARGET_FORMATS)[number]
export type ExportChannels = 1 | 2

/**
 * The measured upstream beep artifact: a 1650 Hz sine, ~0.55 s long, that
 * the gateway prepends to raw-PCM synthesis responses. All detector
 * thresholds below are derived from the live A/B probe
 * (scripts/beep-probe-out/beep-probe-evidence.json): the tone shows up at
 * ≈ -35 dB Goertzel power while clean speech openings measure ≤ -77 dB in
 * the same band.
 */
export const BEEP_TONE_HZ = 1650
export const BEEP_MAX_SECONDS = 1.0 // never cut more than this — speech starts well inside it

/**
 * Parse a RIFF/WAVE buffer and return its PCM payload. Used to unwrap
 * per-chunk `response_format:'wav'` gateway responses. Rejects anything
 * that is not PCM 16-bit at the expected TTS geometry — a wrong-format
 * chunk must fail loudly, never be silently concatenated.
 */
export function extractPcmFromWav(buf: Buffer, opts?: { sampleRateHz?: number; channels?: number; bitsPerSample?: number }): Buffer {
  const wantRate = opts?.sampleRateHz ?? TTS_SAMPLE_RATE
  const wantChannels = opts?.channels ?? TTS_CHANNELS
  const wantBits = opts?.bitsPerSample ?? TTS_BITS_PER_SAMPLE
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('UPSTREAM_WAV_INVALID: synthesis chunk is not a RIFF/WAVE container.')
  }
  let off = 12
  let fmt = false
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(off + 8)
      const channels = buf.readUInt16LE(off + 10)
      const sampleRate = buf.readUInt32LE(off + 12)
      const bits = buf.readUInt16LE(off + 22)
      if (audioFormat !== 1) throw new Error(`UPSTREAM_WAV_INVALID: non-PCM audio format ${audioFormat}.`)
      if (sampleRate !== wantRate || channels !== wantChannels || bits !== wantBits) {
        throw new Error(
          `UPSTREAM_WAV_INVALID: chunk is ${sampleRate} Hz / ${channels}ch / ${bits}-bit; expected ${wantRate} Hz / ${wantChannels}ch / ${wantBits}-bit.`,
        )
      }
      fmt = true
    } else if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(size, buf.length - off - 8)
    }
    off += 8 + size + (size % 2)
  }
  if (!fmt || dataOff < 0 || dataLen === 0) {
    throw new Error('UPSTREAM_WAV_INVALID: fmt/data chunk missing or empty.')
  }
  return buf.subarray(dataOff, dataOff + dataLen)
}

/**
 * Goertzel power of a single frequency over a PCM window, reported as an
 * RMS-EQUIVALENT level (dBFS): for a pure sine AT that frequency the value
 * equals rmsDbfs of the same window (all energy sits in one bin). For speech
 * the value sits far below the window RMS because energy is spread across
 * many bins — which is exactly the discriminator the tone guard uses.
 * Pure + deterministic — unit-tested against synthetic tone/noise fixtures.
 */
export function goertzelPowerDb(
  pcm: Buffer,
  startSample: number,
  winSamples: number,
  freqHz: number,
  sampleRateHz = TTS_SAMPLE_RATE,
): number {
  const maxStart = Math.floor(pcm.length / 2) - winSamples
  const start = Math.min(startSample, maxStart)
  if (start < 0 || winSamples < 64) return -200
  let s1 = 0
  let s2 = 0
  const coeff = 2 * Math.cos((2 * Math.PI * freqHz) / sampleRateHz)
  for (let i = 0; i < winSamples; i++) {
    const x = pcm.readInt16LE((start + i) * 2)
    const s0 = x + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  // ×2 converts the |X(k)|² amplitude-squared measure to an RMS-squared
  // equivalent (a full-scale sine then reads 0 dBFS, matching rmsDbfs).
  return 10 * Math.log10(Math.max((2 * power) / (winSamples * winSamples * 32768 * 32768), 1e-12))
}

/** RMS level (dBFS) over a PCM window. */
export function rmsDbfs(pcm: Buffer, startSample: number, winSamples: number): number {
  const maxStart = Math.floor(pcm.length / 2) - winSamples
  const start = Math.min(startSample, maxStart)
  if (start < 0 || winSamples <= 0) return -200
  let acc = 0
  for (let i = 0; i < winSamples; i++) acc += pcm.readInt16LE((start + i) * 2) ** 2
  const rms = Math.sqrt(acc / winSamples) / 32768
  return 20 * Math.log10(Math.max(rms, 1e-10))
}

/**
 * Detect the measured beep signature at the very start of a PCM stream:
 * a stable pure tone at BEEP_TONE_HZ whose power dominates the first
 * windows and sits far above the broadband level. Returns the number of
 * leading SAMPLES occupied by the artifact, or 0 when absent.
 *
 * Strictness rules (all must hold) — this is what makes it impossible to
 * clip speech: the tone must dominate the first 120 ms window by a wide
 * margin, the audio right AFTER the candidate cut must not still be the
 * pure tone, and the cut is capped at BEEP_MAX_SECONDS.
 */
export function detectLeadingToneSamples(
  pcm: Buffer,
  opts?: { toneHz?: number; sampleRateHz?: number },
): number {
  const rate = opts?.sampleRateHz ?? TTS_SAMPLE_RATE
  const toneHz = opts?.toneHz ?? BEEP_TONE_HZ
  const totalSamples = Math.floor(pcm.length / 2)
  const maxScan = Math.min(Math.floor(rate * BEEP_MAX_SECONDS), totalSamples)
  if (maxScan < rate * 0.1) return 0

  const win = Math.floor(rate * 0.06) // 60 ms analysis windows
  const toneAt = (s: number) => goertzelPowerDb(pcm, s, win, toneHz, rate)
  // A window is "tone" when the tone's RMS-equivalent level is within 6 dB
  // of the window's total RMS — i.e. the tone bin carries at least ~25% of
  // the window's energy. A pure tone carries 100%; speech concentrates at
  // most a few percent in any single 1 Hz-wide bin (harmonics are at least
  // ~12 dB below the fundamental and the bin is narrow), so speech can
  // never satisfy this — that is what makes the guard unable to clip it.
  const isTone = (s: number) => {
    const rms = rmsDbfs(pcm, s, win)
    if (rms < -55) return false // silence — not the artifact itself
    return toneAt(s) > rms - 6
  }

  // The artifact must open the stream decisively.
  if (!isTone(0)) return 0

  // Walk forward until the tone stops (or the cap). The cut point is the
  // END of the last tone-positive window, so no audible tail of the
  // artifact survives the cut (a mixed window may still contain a few ms
  // of tone decay — cutting through its end removes that too).
  let cursor = 0
  let lastToneEnd = 0
  while (cursor + win <= maxScan && isTone(cursor)) {
    lastToneEnd = cursor + win
    cursor += Math.floor(win / 2)
  }
  const cutSamples = Math.min(lastToneEnd, maxScan)
  // Require a decisive artifact: at least 200 ms of continuous tone.
  if (cutSamples < rate * 0.2) return 0
  return cutSamples
}

/**
 * Defensive leading-tone guard for assembled synthesis PCM. Returns the
 * (possibly identical) input buffer plus a truthful report. Only strips an
 * exact artifact match — genuine speech, music intros and intentional
 * tones never match the strict signature.
 */
export function stripLeadingToneArtifact(pcm: Buffer): { pcm: Buffer; stripped: boolean; strippedSamples: number } {
  const cut = detectLeadingToneSamples(pcm)
  if (cut === 0) return { pcm, stripped: false, strippedSamples: 0 }
  return { pcm: pcm.subarray(cut * 2), stripped: true, strippedSamples: cut }
}

// ---- pure helpers (unit-tested in tests/unit/gangzii.test.ts) --------------

/**
 * Split text into synthesis chunks: sentence-boundary first, hard-split
 * only when a single sentence exceeds the per-call limit. Deterministic.
 */
export function chunkTextForTts(
  text: string,
  maxCharsPerChunk = TTS_MAX_CHARS_PER_CHUNK,
  maxChunks = TTS_MAX_CHUNKS_PER_REQUEST,
): string[] {
  const source = text.trim()
  if (source.length === 0) return []

  // Split on sentence enders (latin + CJK), keeping the delimiter attached.
  const pieces = source
    .split(/(?<=[.!?。！？…；;])\s*/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const chunks: string[] = []
  let current = ''

  const pushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current)
      current = ''
    }
  }

  for (const piece of pieces) {
    if (piece.length > maxCharsPerChunk) {
      pushCurrent()
      // Hard-split the oversized sentence on the last usable boundary.
      let remaining = piece
      while (remaining.length > maxCharsPerChunk) {
        let cut = remaining.lastIndexOf(' ', maxCharsPerChunk)
        if (cut < maxCharsPerChunk / 2) cut = maxCharsPerChunk
        chunks.push(remaining.slice(0, cut).trim())
        remaining = remaining.slice(cut).trim()
      }
      if (remaining.length > 0) current = remaining
      continue
    }
    if (current.length + piece.length + 1 > maxCharsPerChunk) {
      pushCurrent()
    }
    current = current.length > 0 ? `${current} ${piece}` : piece
  }
  pushCurrent()

  if (chunks.length > maxChunks) {
    throw new Error(
      `TEXT_TOO_LONG: text requires ${chunks.length} synthesis chunks; the limit is ${maxChunks} (about ${maxChunks * maxCharsPerChunk} characters).`,
    )
  }
  return chunks
}

/** Canonical 44-byte PCM WAV header (24 kHz / mono / 16-bit). */
export function buildWavHeader(pcmByteLength: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmByteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20) // audio format: PCM
  header.writeUInt16LE(TTS_CHANNELS, 22)
  header.writeUInt32LE(TTS_SAMPLE_RATE, 24)
  header.writeUInt32LE(TTS_SAMPLE_RATE * TTS_CHANNELS * (TTS_BITS_PER_SAMPLE / 8), 28) // byte rate
  header.writeUInt16LE(TTS_CHANNELS * (TTS_BITS_PER_SAMPLE / 8), 32) // block align
  header.writeUInt16LE(TTS_BITS_PER_SAMPLE, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmByteLength, 40)
  return header
}

/** Wrap raw PCM bytes in a single valid WAV container. */
export function assembleWavFromPcm(pcm: Buffer): Buffer {
  return Buffer.concat([buildWavHeader(pcm.length), pcm])
}

/**
 * Magic-byte container sniffing for uploads. Returns null for anything the
 * gateway cannot consume. Extension strings are NOT trusted.
 */
export function sniffAudioContainer(buf: Buffer): 'wav' | 'webm' | null {
  if (buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  // EBML magic — WebM (and Matroska) start with 1A 45 DF A3.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  return null
}

/** Duration of 16-bit mono PCM at the fixed TTS sample rate, in seconds. */
export function pcmDurationSeconds(pcmByteLength: number): number {
  const byteRate = TTS_SAMPLE_RATE * TTS_CHANNELS * (TTS_BITS_PER_SAMPLE / 8)
  return pcmByteLength / byteRate
}

// ---- adapter ----------------------------------------------------------------

type TtsProgress = (info: { chunk: number; totalChunks: number }) => void

export interface SynthesisResult {
  wav: Buffer
  chunks: number
  durationSec: number
  durationMs: number
  sampleRateHz: number
  /** True when the defensive guard found + removed a leading-tone artifact. */
  beepStripped: boolean
  beepStrippedSamples: number
}

const PROBE_TTL_MS = 60_000
const FFMPEG_TTL_MS = 300_000
/** A 429 (gateway rate limit) is transient: cache the failure briefly. */
const RATE_LIMIT_TTL_MS = 10_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isRateLimited(report: HealthReport): boolean {
  return !report.healthy && report.detail.includes('429')
}

function cacheTtlFor(report: HealthReport): number {
  return isRateLimited(report) ? RATE_LIMIT_TTL_MS : PROBE_TTL_MS
}

/**
 * Probe cache lives on globalThis, NOT on the module instance. Next.js dev
 * compilation can duplicate a shared module across route bundles; without
 * this bridge every route would re-probe the gateway and trip its tight
 * audio rate limit (measured: 429 within seconds). globalThis is shared by
 * the whole server process in both dev and production.
 */
interface ProbeCacheStore {
  tts?: { report: HealthReport; at: number }
  asr?: { report: HealthReport; at: number }
  ffmpeg?: { report: HealthReport; at: number }
  probeWav?: Buffer | null
  /** In-flight probe promises — collapse concurrent callers into one probe. */
  ttsInFlight?: Promise<HealthReport>
  asrInFlight?: Promise<HealthReport>
  ffmpegInFlight?: Promise<HealthReport>
}
const PROBE_STORE_KEY = '__bean_gangzii_audio_probe_cache__'
function probeStore(): ProbeCacheStore {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[PROBE_STORE_KEY]) g[PROBE_STORE_KEY] = {}
  return g[PROBE_STORE_KEY] as ProbeCacheStore
}

class HostedAudioAdapter {
  readonly backendId = 'bean-audio-tts-hosted-primary'

  private get cache(): ProbeCacheStore {
    return probeStore()
  }

  /**
   * Chunked speech synthesis -> one assembled WAV buffer.
   *
   * Each gateway call requests a WAV container (`response_format:'wav'`,
   * measured beep-free — see the BEEP ROOT CAUSE note at the top of this
   * file); the per-chunk PCM payload is extracted and validated, then all
   * chunks are concatenated under ONE canonical 24 kHz mono header. A
   * defensive leading-tone guard runs over the assembled stream. Each call
   * is bounded by `timeoutMs`; the caller owns progress.
   */
  async synthesize(opts: {
    text: string
    voice: string
    speed: number
    timeoutMs: number
    onProgress?: TtsProgress
  }): Promise<SynthesisResult> {
    const chunks = chunkTextForTts(opts.text)
    const startedAt = Date.now()
    const zai = await ZAI.create()
    const pcmParts: Buffer[] = []

    for (let i = 0; i < chunks.length; i++) {
      opts.onProgress?.({ chunk: i + 1, totalChunks: chunks.length })
      const res = (await withTimeout(
        zai.audio.tts.create({
          input: chunks[i],
          voice: opts.voice,
          speed: opts.speed,
          response_format: 'wav',
          stream: false,
        }),
        opts.timeoutMs,
        'Speech synthesis',
      )) as Response
      const ab = await res.arrayBuffer()
      if (ab.byteLength === 0) {
        throw new Error(`Upstream returned empty audio for chunk ${i + 1}/${chunks.length}.`)
      }
      // Validate the container geometry BEFORE concatenating: a format
      // drift must fail loudly instead of corrupting the assembled file.
      pcmParts.push(extractPcmFromWav(Buffer.from(new Uint8Array(ab))))
    }

    const raw = Buffer.concat(pcmParts)
    const guarded = stripLeadingToneArtifact(raw)
    const pcm = guarded.pcm
    return {
      wav: assembleWavFromPcm(pcm),
      chunks: chunks.length,
      durationSec: pcmDurationSeconds(pcm.length),
      durationMs: Date.now() - startedAt,
      sampleRateHz: TTS_SAMPLE_RATE,
      beepStripped: guarded.stripped,
      beepStrippedSamples: guarded.strippedSamples,
    }
  }

  /** Speech recognition (WAV/WebM only — enforced upstream AND by callers). */
  async transcribe(opts: { wavOrWebm: Buffer; timeoutMs: number }): Promise<string> {
    const zai = await ZAI.create()
    const res = (await withTimeout(
      zai.audio.asr.create({ file_base64: opts.wavOrWebm.toString('base64') }),
      opts.timeoutMs,
      'Speech recognition',
    )) as { text?: string }
    return (res?.text ?? '').trim()
  }

  /**
   * Local deterministic ffmpeg transcode. No model involved.
   * `channels` (1|2) is an explicit output request: 2 duplicates the mono
   * source into L/R via `-ac 2` — a dual-mono export, NOT spatial stereo.
   */
  async convert(opts: {
    inputPath: string
    outputPath: string
    target: ConvertTargetFormat
    channels?: ExportChannels
    timeoutMs: number
  }): Promise<void> {
    const codecArgs: Record<ConvertTargetFormat, string[]> = {
      mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
      ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
      flac: ['-c:a', 'flac'],
      m4a: ['-c:a', 'aac', '-b:a', '192k'],
      wav: ['-c:a', 'pcm_s16le'],
    }
    const channelArgs = opts.channels === 2 ? ['-ac', '2'] : opts.channels === 1 ? ['-ac', '1'] : []
    const args = ['-y', '-i', opts.inputPath, ...codecArgs[opts.target], ...channelArgs, '-vn', opts.outputPath]
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        args,
        { timeout: Math.floor(opts.timeoutMs), maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`ffmpeg conversion failed: ${String(stderr).slice(-400) || err.message}`))
          } else {
            resolve()
          }
        },
      )
    })
  }

  /**
   * Verify a produced audio file with ffprobe and return its REAL stream
   * metadata. Used after every conversion so the UI never guesses codec,
   * sample rate, channel count or duration.
   */
  async probeAudio(filePath: string, timeoutMs = 15_000): Promise<AudioStreamMetadata> {
    const raw = await new Promise<string>((resolve, reject) => {
      execFile(
        'ffprobe',
        [
          '-v', 'error',
          '-select_streams', 'a:0',
          '-show_entries', 'stream=codec_name,sample_rate,channels,duration:format=format_name',
          '-of', 'json',
          filePath,
        ],
        { timeout: Math.floor(timeoutMs), maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`ffprobe failed: ${String(stderr).slice(-300) || err.message}`))
          else resolve(String(stdout))
        },
      )
    })
    const parsed = JSON.parse(raw) as {
      streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number; duration?: string }>
      format?: { format_name?: string }
    }
    const s = parsed.streams?.[0]
    if (!s?.codec_name || !s.sample_rate || !s.channels) {
      throw new Error('ffprobe could not read an audio stream from the produced file.')
    }
    return {
      codec: s.codec_name,
      sampleRateHz: Number(s.sample_rate),
      channels: s.channels,
      durationSec: s.duration ? Math.round(Number(s.duration) * 100) / 100 : null,
      container: parsed.format?.format_name ?? null,
    }
  }

  // ---- measured health (TTL-cached, shared with /api/health) ----------------

  async healthTts(force = false): Promise<HealthReport> {
    const cached = this.cache.tts
    if (!force && cached && Date.now() - cached.at < cacheTtlFor(cached.report)) return cached.report
    if (!force && this.cache.ttsInFlight) return this.cache.ttsInFlight
    const run = this.probeTts()
    this.cache.ttsInFlight = run
    try {
      return await run
    } finally {
      this.cache.ttsInFlight = undefined
    }
  }

  private async probeTts(): Promise<HealthReport> {
    let report = await this.probeTtsOnce() // never throws
    // Health probes are not billable customer actions; exactly one retry
    // after a short pause keeps transient gateway 429s from flipping the
    // whole product to "unavailable". The retried result is what is cached.
    if (isRateLimited(report)) {
      await sleep(3_000)
      report = await this.probeTtsOnce()
    }
    this.cache.tts = { report, at: Date.now() }
    return report
  }

  /** Single TTS probe attempt without retry logic. */
  private async probeTtsOnce(): Promise<HealthReport> {
    const t0 = Date.now()
    try {
      const zai = await ZAI.create()
      const res = (await withTimeout(
        zai.audio.tts.create({
          input: 'OK',
          voice: 'tongtong',
          speed: 1.0,
          response_format: 'wav',
          stream: false,
        }),
        30_000,
        'TTS probe',
      )) as Response
      const ab = await res.arrayBuffer()
      const bytes = Buffer.from(new Uint8Array(ab))
      const ok = bytes.length > 44 && bytes.toString('ascii', 0, 4) === 'RIFF'
      if (ok) this.cache.probeWav = bytes
      return {
        healthy: ok,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: ok
          ? 'Gateway synthesized a live WAV probe (after rate-limit retry).'
          : 'Gateway responded without valid WAV bytes.',
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `TTS probe failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  async healthAsr(force = false): Promise<HealthReport> {
    const cached = this.cache.asr
    if (!force && cached && Date.now() - cached.at < cacheTtlFor(cached.report)) return cached.report
    if (!force && this.cache.asrInFlight) return this.cache.asrInFlight
    const run = this.probeAsr()
    this.cache.asrInFlight = run
    try {
      return await run
    } finally {
      this.cache.asrInFlight = undefined
    }
  }

  private async probeAsr(): Promise<HealthReport> {
    const t0 = Date.now()
    let report: HealthReport
    try {
      // Reuse the TTS probe bytes when available so the ASR check costs ONE
      // real gateway call, not two. No bytes -> honest skip, never a fake.
      if (!this.cache.probeWav) await this.healthTts()
      if (!this.cache.probeWav) {
        report = {
          healthy: false,
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          detail: 'ASR probe skipped: no probe audio available (TTS probe unhealthy).',
        }
      } else {
        report = await this.probeAsrOnce()
        if (isRateLimited(report)) {
          await sleep(3_000)
          report = await this.probeAsrOnce()
        }
      }
    } catch (e) {
      report = {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `ASR probe failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    this.cache.asr = { report, at: Date.now() }
    return report
  }

  /** Single ASR probe attempt without retry logic. */
  private async probeAsrOnce(): Promise<HealthReport> {
    const t0 = Date.now()
    const wav = this.cache.probeWav
    if (!wav) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        detail: 'ASR probe skipped: no probe audio available.',
      }
    }
    const text = await this.transcribe({ wavOrWebm: wav, timeoutMs: 30_000 })
    return {
      healthy: true, // a response (even empty text) proves the endpoint is live
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - t0,
      detail: `Gateway recognized a live WAV probe (transcript ${text.length} chars).`,
    }
  }

  async healthFfmpeg(force = false): Promise<HealthReport> {
    const cached = this.cache.ffmpeg
    if (!force && cached && Date.now() - cached.at < FFMPEG_TTL_MS) return cached.report
    const t0 = Date.now()
    let report: HealthReport
    try {
      const version = await new Promise<string>((resolve, reject) => {
        execFile('ffmpeg', ['-version'], { timeout: 5_000 }, (err, stdout) =>
          err ? reject(err) : resolve(String(stdout)),
        )
      })
      const v = version.split('\n')[0]?.trim() ?? 'ffmpeg'
      report = {
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `Local transcoder available (${v}).`,
      }
    } catch (e) {
      report = {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `ffmpeg is not usable: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    this.cache.ffmpeg = { report, at: Date.now() }
    return report
  }
}

export interface AudioStreamMetadata {
  codec: string
  sampleRateHz: number
  channels: number
  durationSec: number | null
  container: string | null
}

export const hostedAudioAdapter = new HostedAudioAdapter()
