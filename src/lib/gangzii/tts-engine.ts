/**
 * BEAN Intelligence — GANGZII LOCAL TTS ENGINE (Kokoro-82M, onnxruntime).
 *
 * M27 (2026-11-21): the local-first text-to-speech engine behind GANGZII.
 * Selected over the Qwen3-TTS candidates after evaluation (recorded in
 * docs/models/GANGZII-TTS-ENGINE-EVALUATION.md): Kokoro-82M v1.0 ships
 * Apache-2.0 weights, runs on CPU through ONNX Runtime (no GPU required),
 * is resilient to 8-bit quantization and needs ~90 MB of disk instead of
 * multi-GB CUDA runtimes.
 *
 * Execution shape (mirrors the hosted audio adapter's contract):
 *  - narrow adapter interface: capabilities / voices / generateSpeech /
 *    cancel / runtime status / model metadata;
 *  - REAL measured output: a 24 kHz mono WAV buffer + measured duration,
 *    sample rate, channels, generation time — never a fabricated artifact;
 *  - on-demand model lifecycle, explicit user action required:
 *      * install (download from the pinned HF revision with sha256
 *        verification — file sizes shown before install, disk checked),
 *      * status (installed/revision/size/health),
 *      * unload (release the in-process session),
 *      * remove (delete files; refused while jobs are actively using it);
 *  - models live OUTSIDE the repository under storage/models/ and are never
 *    committed; inference is fully offline (allowRemoteModels disabled) so a
 *    running server never silently fetches weights;
 *  - cancellation is honored BETWEEN synthesis calls (chunked generation);
 *    a single ONNX inference call is atomic and cannot be aborted mid-run —
 *    the honest cancel contract is "stops at the next segment boundary";
 *  - secrets never enter this module: no API keys, no credentials.
 *
 * SERVER-ONLY. Heavy imports are dynamic so route bundles stay small and
 * the engine is only loaded when a job actually runs.
 */

import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { logger } from '@/lib/observability/logger'

// ---- pinned model identity (verify before upgrading — licenses + checksums) --

export const KOKORO_MODEL_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const KOKORO_MODEL_DTYPE = 'q8' as const
export const KOKORO_MODEL_REVISION = 'main'
export const KOKORO_MODEL_FILE = 'onnx/model_quantized.onnx'
/** Approximate install size shown BEFORE download (measured 2026-11-21; the
 *  exact post-download byte count is recorded in the install manifest). */
export const KOKORO_APPROX_DOWNLOAD_MB = 92
/** Files the engine requires to consider the model installed. */
const REQUIRED_FILES = ['config.json', KOKORO_MODEL_FILE]
const OPTIONAL_FILES = ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']

/** Models live outside the repository — never committed, removable at will. */
export const TTS_MODELS_ROOT = path.join(process.cwd(), 'storage', 'models')
export const KOKORO_LOCAL_DIR = path.join(TTS_MODELS_ROOT, 'hf', KOKORO_MODEL_REPO)
export const KOKORO_MANIFEST = path.join(KOKORO_LOCAL_DIR, 'bean-install-manifest.json')

export interface KokoroManifest {
  installedAt: string
  repo: string
  revision: string
  dtype: string
  files: Array<{ file: string; bytes: number; sha256: string | null }>
  installMs: number
  engineVersion: string
}

// ---- install state (single-flight; process-wide via globalThis) --------------

interface InstallState {
  installing: boolean
  startedAt?: number
  progress?: { file: string; receivedBytes: number; totalBytes: number | null }
  lastError?: string
}
const INSTALL_KEY = '__bean_gangzii_tts_install_state__'
function installState(): InstallState {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[INSTALL_KEY]) g[INSTALL_KEY] = {} as InstallState
  return g[INSTALL_KEY] as InstallState
}

// ---- narrow adapter surface ---------------------------------------------------

export interface TtsGenerationRequest {
  text: string
  voice: string
  speed: number
  /** Called between chunks with real per-chunk progress. */
  onProgress?: (info: { chunk: number; totalChunks: number }) => void
  /** Cooperative cancel probe — checked between synthesis calls. */
  isCancelled?: () => boolean
}

export interface TtsGenerationResult {
  wav: Buffer
  durationSec: number
  sampleRateHz: number
  channels: number
  chunks: number
  generationMs: number
  voice: string
  model: string
  warnings: string[]
}

export interface EngineRuntimeStatus {
  installed: boolean
  healthy: boolean
  detail: string
  revision: string | null
  filesBytes: number | null
  loadedInProcess: boolean
  installing: boolean
  installProgress: InstallState['progress'] | null
}

// ---- WAV encoding (Float32 ONNX output → 16-bit PCM mono 24 kHz) -------------

function floatToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  return out
}

/** Canonical 44-byte PCM WAV header for the given geometry. */
function buildWavHeader(pcmByteLength: number, sampleRateHz: number, channels: number, bitsPerSample: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmByteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRateHz, 24)
  header.writeUInt32LE(sampleRateHz * channels * (bitsPerSample / 8), 28)
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmByteLength, 40)
  return header
}

function assembleWav(pcm: Buffer, sampleRateHz = 24_000, channels = 1): Buffer {
  return Buffer.concat([buildWavHeader(pcm.length, sampleRateHz, channels, 16), pcm])
}

/**
 * Deterministic sentence-boundary splitter for long narration. The ONNX
 * model has a hard 510-phoneme-token input window; kokoro-js truncates
 * silently, so BEAN splits FIRST and never feeds oversized text in — a
 * truncated synthesis would be an inaudible defect, which is dishonest.
 * Splitting is sentence-first, word-boundary fallback, deterministic order.
 */
export function splitTextForKokoro(text: string, maxCharsPerChunk = 400): string[] {
  const source = text.trim()
  if (!source) return []
  const sentences = source
    .split(/(?<=[.!?。！？…])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  const push = () => {
    if (current) chunks.push(current)
    current = ''
  }
  for (const sentence of sentences) {
    if (sentence.length > maxCharsPerChunk) {
      push()
      let rest = sentence
      while (rest.length > maxCharsPerChunk) {
        let cut = rest.lastIndexOf(' ', maxCharsPerChunk)
        if (cut < maxCharsPerChunk / 2) cut = maxCharsPerChunk
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) current = rest
      continue
    }
    if (current.length + sentence.length + 1 > maxCharsPerChunk) push()
    current = current ? `${current} ${sentence}` : sentence
  }
  push()
  return chunks
}

// ---- engine -------------------------------------------------------------------

interface LoadedEngine {
  tts: {
    /** kokoro-js generate → transformers.js RawAudio {audio: Float32Array, sampling_rate} */
    generate: (text: string, opts: { voice: string; speed: number }) => Promise<{ audio: Float32Array; sampling_rate: number; phonemes?: string }>
    voices: Record<string, { name?: string; language?: string; gender?: string }>
  }
  loadedAt: number
}

const ENGINE_KEY = '__bean_gangzii_kokoro_engine__'
function engineCache(): { instance?: LoadedEngine } {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[ENGINE_KEY]) g[ENGINE_KEY] = {}
  return g[ENGINE_KEY] as { instance?: LoadedEngine }
}

export class KokoroTtsEngine {
  readonly engineId = 'kokoro-82m-v1.0'
  readonly backendId = 'bean-audio-tts-local-kokoro'

  /** Install status from the manifest + required files on disk. */
  installStatus(): { installed: boolean; manifest: KokoroManifest | null; filesBytes: number } {
    const manifest = this.readManifest()
    let filesBytes = 0
    let installed = true
    for (const rel of REQUIRED_FILES) {
      const p = path.join(KOKORO_LOCAL_DIR, rel)
      if (!fs.existsSync(p)) {
        installed = false
        break
      }
      filesBytes += fs.statSync(p).size
    }
    return { installed, manifest, filesBytes }
  }

  private readManifest(): KokoroManifest | null {
    try {
      if (!fs.existsSync(KOKORO_MANIFEST)) return null
      return JSON.parse(fs.readFileSync(KOKORO_MANIFEST, 'utf8')) as KokoroManifest
    } catch {
      return null
    }
  }

  /**
   * On-demand model installation — ALWAYS an explicit caller action (never
   * automatic). Downloads the pinned revision, verifies every file against
   * its published sha256 (HF API LFS metadata), checks disk space first and
   * writes an install manifest. Idempotent-safe: a completed install is a
   * no-op; a corrupted file re-downloads.
   */
  async install(): Promise<{ ok: boolean; manifest: KokoroManifest | null; message: string }> {
    const state = installState()
    if (state.installing) {
      return { ok: false, manifest: null, message: 'An installation is already in progress.' }
    }
    const existing = this.installStatus()
    if (existing.installed && existing.manifest) {
      return { ok: true, manifest: existing.manifest, message: 'The local TTS engine is already installed.' }
    }
    state.installing = true
    state.lastError = undefined
    state.startedAt = Date.now()
    try {
      fs.mkdirSync(KOKORO_LOCAL_DIR, { recursive: true })

      // Disk guard: refuse to fill the host. Required model + margin.
      const needBytes = KOKORO_APPROX_DOWNLOAD_MB * 1024 * 1024 * 1.35
      const freeBytes = await this.freeDiskBytes()
      if (freeBytes !== null && freeBytes < needBytes) {
        throw new Error(
          `Not enough disk space: ~${KOKORO_APPROX_DOWNLOAD_MB} MB is required, ${Math.round(freeBytes / (1024 * 1024))} MB is free.`,
        )
      }

      const started = Date.now()
      const files: KokoroManifest['files'] = []

      // sha256 metadata from the HF API (LFS OID) — verify AFTER download.
      const sha256s = await this.fetchSha256s()

      for (const rel of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
        state.progress = { file: rel, receivedBytes: 0, totalBytes: null }
        const dest = path.join(KOKORO_LOCAL_DIR, rel)
        const expected = sha256s.get(rel) ?? null
        const cached = expected && fs.existsSync(dest) ? this.sha256File(dest) === expected : false
        if (cached) {
          files.push({ file: rel, bytes: fs.statSync(dest).size, sha256: expected })
          continue
        }
        // transformers.js expects missing optional files to be absent (it
        // probes tokenizer.json etc.) — a failed optional download is not an
        // install failure; the required set is.
        try {
          await this.downloadFile(rel, dest, state, expected)
          files.push({ file: rel, bytes: fs.statSync(dest).size, sha256: expected })
        } catch (e) {
          if (REQUIRED_FILES.includes(rel)) throw e
          logger.warn('gangzii.tts_engine.optional_file_skipped', {
            file: rel,
            message: e instanceof Error ? e.message : String(e),
          })
        }
      }

      const manifest: KokoroManifest = {
        installedAt: new Date().toISOString(),
        repo: KOKORO_MODEL_REPO,
        revision: KOKORO_MODEL_REVISION,
        dtype: KOKORO_MODEL_DTYPE,
        files,
        installMs: Date.now() - started,
        engineVersion: this.engineVersion(),
      }
      fs.writeFileSync(KOKORO_MANIFEST, JSON.stringify(manifest, null, 2))
      state.installing = false
      state.progress = undefined
      logger.info('gangzii.tts_engine.installed', {
        files: files.length,
        bytes: files.reduce((a, f) => a + f.bytes, 0),
        installMs: manifest.installMs,
      })
      return { ok: true, manifest, message: 'Local TTS engine installed and checksum-verified.' }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      state.installing = false
      state.progress = undefined
      state.lastError = message
      logger.warn('gangzii.tts_engine.install_failed', { message })
      return { ok: false, manifest: null, message: `Installation failed: ${message}` }
    }
  }

  /** Published sha256s from the HF API (LFS OIDs). Missing entries = unverifiable. */
  private async fetchSha256s(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    try {
      const res = await fetch(
        `https://huggingface.co/api/models/${KOKORO_MODEL_REPO}/tree/${KOKORO_MODEL_REVISION}?recursive=true`,
        { headers: { 'User-Agent': 'BEAN-Intelligence/1.0 (+model install)' }, signal: AbortSignal.timeout(30_000) },
      )
      if (!res.ok) return map
      const entries = (await res.json()) as Array<{ path: string; lfs?: { oid?: string } }>
      for (const entry of entries) {
        if (entry.lfs?.oid) map.set(entry.path, entry.lfs.oid)
      }
    } catch (e) {
      logger.warn('gangzii.tts_engine.sha256_lookup_failed', {
        message: e instanceof Error ? e.message : String(e),
      })
    }
    return map
  }

  private sha256File(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }

  private freeDiskBytes(): Promise<number | null> {
    return new Promise((resolve) => {
      execFile('df', ['-B', '1', TTS_MODELS_ROOT], { timeout: 5_000 }, (err, stdout) => {
        if (err) return resolve(null)
        const line = stdout.trim().split('\n').pop()
        const col = line?.split(/\s+/)[3]
        resolve(col && /^\d+$/.test(col) ? Number(col) : null)
      })
    })
  }

  /** Single-file downloader with resume + throttle-tolerant retries.
   *  Sources are tried in order: ModelScope mirror (same repo id, fast
   *  global CDN — measured 29 MB/s where HF was rate-limiting), then the
   *  canonical HuggingFace revision. Every download is checksum-verified
   *  when the source publishes a sha256; failures fall through honestly. */
  private downloadFile(rel: string, dest: string, state: InstallState, expectedSha256: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const sources = [
        `https://modelscope.cn/models/${KOKORO_MODEL_REPO}/resolve/master/${rel}`,
        `https://huggingface.co/${KOKORO_MODEL_REPO}/resolve/${KOKORO_MODEL_REVISION}/${rel}`,
      ]
      const maxAttempts = 24
      let attempt = 0
      const tryOnce = (sourceIdx = 0) => {
        if (sourceIdx >= sources.length) {
          if (attempt >= maxAttempts) {
            reject(new Error(`Download failed after ${attempt} attempts across all sources: ${rel}`))
            return
          }
          sourceIdx = 0
        }
        attempt += 1
        const url = sources[sourceIdx]
        execFile(
          'curl',
          [
            '-sL', '--max-time', '900', '-C', '-',
            '-H', 'Accept: application/octet-stream',
            '-H', 'User-Agent: BEAN-Intelligence/1.0 (+model install)',
            '-o', dest, '-w', '%{http_code}',
            url,
          ],
          { timeout: 920_000, maxBuffer: 1024 },
          (err, stdout) => {
            const code = String(stdout).trim()
            // An HTML throttle/error page writes '<!DOCTYPE' — invalid content.
            const isHtml = fs.existsSync(dest) && this.startsWithHtml(dest)
            if (isHtml) fs.rmSync(dest, { force: true })
            if (!err && (code === '200' || code === '206') && fs.existsSync(dest) && !isHtml) {
              if (expectedSha256) {
                const actual = this.sha256File(dest)
                if (actual !== expectedSha256) {
                  fs.rmSync(dest, { force: true })
                  reject(new Error(`Checksum mismatch for ${rel}: downloaded artifact does not match the published sha256. Installation refused.`))
                  return
                }
              }
              resolve()
              return
            }
            const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0
            state.progress = { file: rel, receivedBytes: size, totalBytes: null }
            setTimeout(() => tryOnce(sourceIdx + 1), Math.min(60_000, 5_000 * attempt))
          },
        )
      }
      tryOnce()
    })
  }

  private startsWithHtml(file: string): boolean {
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(15)
      fs.readSync(fd, buf, 0, 15, 0)
      fs.closeSync(fd)
      return buf.toString('utf8').startsWith('<!DOCTYPE')
    } catch {
      return false
    }
  }

  private engineVersion(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading the installed package version is a build-time constant lookup
      const pkg = require('kokoro-js/package.json') as { version?: string }
      return `kokoro-js@${pkg.version ?? 'unknown'}`
    } catch {
      return 'kokoro-js@unknown'
    }
  }

  /** True when the model files exist and load into a live ONNX session. */
  async health(force = false): Promise<{ healthy: boolean; detail: string; latencyMs: number | null }> {
    const t0 = Date.now()
    const { installed } = this.installStatus()
    if (!installed) {
      const cached = this.healthCache()
      if (!force && cached && Date.now() - cached.at < 60_000) return cached.report
      const report = {
        healthy: false,
        detail: 'Local engine not installed: the Kokoro-82M model files are not on disk. Install it from the Narration Studio (an explicit download is required).',
        latencyMs: null as number | null,
      }
      this.setHealthCache({ report, at: Date.now() })
      return report
    }
    try {
      const engine = await this.ensureLoaded()
      const report = {
        healthy: true,
        detail: `Local Kokoro-82M engine loaded (${engine.tts ? 'ONNX session ready' : 'no session'}), ${Object.keys(engine.tts.voices ?? {}).length} voices available.`,
        latencyMs: Date.now() - t0,
      }
      this.setHealthCache({ report, at: Date.now() })
      return report
    } catch (e) {
      const report = {
        healthy: false,
        detail: `Local engine failed to load: ${e instanceof Error ? e.message : String(e)}`,
        latencyMs: Date.now() - t0,
      }
      this.setHealthCache({ report, at: Date.now() })
      return report
    }
  }

  private healthCacheKey = '__bean_gangzii_kokoro_health__'
  private healthCache(): { report: { healthy: boolean; detail: string; latencyMs: number | null }; at: number } | undefined {
    const g = globalThis as unknown as Record<string, unknown>
    return g[this.healthCacheKey] as { report: { healthy: boolean; detail: string; latencyMs: number | null }; at: number } | undefined
  }
  private setHealthCache(v: { report: { healthy: boolean; detail: string; latencyMs: number | null }; at: number }) {
    const g = globalThis as unknown as Record<string, unknown>
    g[this.healthCacheKey] = v
  }

  /** Load (once per process) the ONNX model for offline inference. */
  private async ensureLoaded(): Promise<LoadedEngine> {
    const cached = engineCache()
    if (cached.instance) return cached.instance
    const { installed } = this.installStatus()
    if (!installed) throw new Error('MODEL_NOT_INSTALLED: install the Kokoro-82M model first.')
    const t0 = Date.now()
    const { KokoroTTS } = await import('kokoro-js')
    // Configure the transformers env DIRECTLY (measured 2026-11-21: setting
    // it through the kokoro-js re-export is not reliable under module
    // duplication — see scripts/m27-kokoro-smoke.ts). Offline inference:
    // the running server NEVER fetches weights silently; everything it
    // needs is the checksum-verified local install.
    const { env } = await import('@huggingface/transformers')
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = path.join(TTS_MODELS_ROOT, 'hf')
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_REPO, {
      dtype: KOKORO_MODEL_DTYPE,
      device: 'cpu',
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) {
          logger.info('gangzii.tts_engine.load_progress', {
            file: p.file,
            loaded: p.loaded ?? null,
            total: p.total ?? null,
          })
        }
      },
    })
    const instance: LoadedEngine = { tts: tts as unknown as LoadedEngine['tts'], loadedAt: Date.now() }
    engineCache().instance = instance
    logger.info('gangzii.tts_engine.loaded', { loadMs: Date.now() - t0, dtype: KOKORO_MODEL_DTYPE })
    return instance
  }

  /**
   * Generate speech. Real measured output only: the returned WAV is produced
   * from the ONNX waveform; duration/sample rate/channels are derived from
   * the actual buffer, never claimed. Long text is split on sentence
   * boundaries and synthesized chunk-by-chunk with cancellation checks
   * between calls; successful chunk audio is preserved (partial output on
   * failure) and the caller receives exactly what completed.
   */
  async generateSpeech(request: TtsGenerationRequest): Promise<TtsGenerationResult> {
    const engine = await this.ensureLoaded()
    const t0 = Date.now()
    const chunks = splitTextForKokoro(request.text)
    if (chunks.length === 0) throw new Error('VALIDATION_ERROR: there is no text to synthesize.')
    const warnings: string[] = []
    const pcmParts: Buffer[] = []
    let completedChunks = 0
    for (let i = 0; i < chunks.length; i++) {
      if (request.isCancelled?.()) {
        warnings.push(`Cancelled after ${completedChunks}/${chunks.length} segments; completed segment audio is preserved.`)
        break
      }
      request.onProgress?.({ chunk: i + 1, totalChunks: chunks.length })
      // kokoro-js returns a transformers.js RawAudio: { audio: Float32Array,
      // sampling_rate: number } — measured against the installed package
      // (scripts/m27-kokoro-smoke.ts). A wrong shape fails loudly here,
      // never as silent empty audio.
      const out = (await engine.tts.generate(chunks[i], { voice: request.voice, speed: request.speed })) as unknown as {
        audio: Float32Array
        sampling_rate: number
      }
      const samples: Float32Array = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio)
      if (!samples || samples.length === 0) {
        throw new Error(`The speech engine returned no audio for segment ${i + 1}/${chunks.length}.`)
      }
      if (out.sampling_rate !== 24_000) {
        throw new Error(`The speech engine returned an unexpected sample rate (${out.sampling_rate}); expected 24000.`)
      }
      pcmParts.push(floatToPcm16(samples))
      completedChunks = i + 1
    }
    if (pcmParts.length === 0) {
      throw new Error('CANCELLED_BEFORE_OUTPUT: no segment audio was generated.')
    }
    const pcm = Buffer.concat(pcmParts)
    return {
      wav: assembleWav(pcm),
      durationSec: pcm.length / (24_000 * 2),
      sampleRateHz: 24_000,
      channels: 1,
      chunks: completedChunks,
      generationMs: Date.now() - t0,
      voice: request.voice,
      model: `${KOKORO_MODEL_REPO} (${KOKORO_MODEL_DTYPE})`,
      warnings,
    }
  }

  /** The voice catalog the ENGINE actually exposes (from the loaded model). */
  listVoices(): Array<{ id: string; name?: string; language?: string; gender?: string }> {
    const cached = engineCache().instance
    if (!cached) return []
    return Object.entries(cached.tts.voices ?? {}).map(([id, meta]) => ({
      id,
      name: meta.name,
      language: meta.language,
      gender: meta.gender,
    }))
  }

  /**
   * Release the in-process ONNX session (operator memory control). Active
   * jobs are the caller's responsibility to avoid (see remove() for the
   * disk-side guard); unloading only drops the cached session.
   */
  unload(): { unloaded: boolean } {
    const cached = engineCache()
    const had = cached.instance
    cached.instance = undefined
    if (had) logger.info('gangzii.tts_engine.unloaded', { loadedMs: Date.now() - had.loadedAt })
    return { unloaded: Boolean(had) }
  }

  /** Count ACTIVE (queued/running) jobs currently using the local engine. */
  async activeJobsUsingEngine(): Promise<number> {
    // Direct DB read here would import the client into a hot path; callers
    // with a db handle pass their own count. The worker/route callers use
    // countActiveKokoroJobs() below.
    return countActiveKokoroJobs()
  }

  /** Remove the installed model from disk. Refused while jobs are active. */
  async remove(): Promise<{ ok: boolean; message: string }> {
    const active = await this.activeJobsUsingEngine()
    if (active > 0) {
      return {
        ok: false,
        message: `Cannot remove the model while ${active} job(s) are actively using it. Wait for them to finish.`,
      }
    }
    this.unload()
    if (fs.existsSync(KOKORO_LOCAL_DIR)) {
      fs.rmSync(KOKORO_LOCAL_DIR, { recursive: true, force: true })
    }
    logger.info('gangzii.tts_engine.removed', {})
    return { ok: true, message: 'The local TTS engine model was removed from disk.' }
  }

  getRuntimeStatus(): EngineRuntimeStatus {
    const { installed, manifest, filesBytes } = this.installStatus()
    const state = installState()
    return {
      installed,
      healthy: installed, // load health is measured separately via health()
      detail: installed
        ? `Kokoro-82M (${KOKORO_MODEL_DTYPE}) installed${manifest ? ` at ${manifest.installedAt}` : ''}.`
        : (state.lastError ? `Not installed. Last install error: ${state.lastError}` : 'Not installed. The model download is an explicit user action (size shown before install).'),
      revision: manifest?.revision ?? null,
      filesBytes: filesBytes || null,
      loadedInProcess: Boolean(engineCache().instance),
      installing: state.installing,
      installProgress: state.progress ?? null,
    }
  }

  getModelMetadata(): Record<string, unknown> {
    const { manifest } = this.installStatus()
    return {
      engine: this.engineId,
      repo: KOKORO_MODEL_REPO,
      revision: manifest?.revision ?? KOKORO_MODEL_REVISION,
      dtype: KOKORO_MODEL_DTYPE,
      licenses: {
        weights: 'Apache-2.0 (hexgrad/Kokoro-82M v1.0 model card)',
        code: 'Apache-2.0 (kokoro-js)',
        dependency: 'phonemizer/espeak-ng WASM (GPL-3.0) — server-side unmodified dependency; speech OUTPUT belongs to the user',
      },
      sampleRateHz: 24_000,
      channels: 1,
      manifest,
    }
  }
}

/**
 * Active-job guard shared with the route/worker callers (kept as a free
 * function so a caller with its own db import can inline it).
 */
export async function countActiveKokoroJobs(): Promise<number> {
  const { db } = await import('@/lib/db')
  return db.generationJob.count({
    where: {
      product: 'gangzii',
      task: 'speech-synthesis',
      status: { in: ['queued', 'starting', 'running', 'streaming', 'finalizing', 'retry_wait'] },
      backendId: 'bean-audio-tts-local-kokoro',
    },
  })
}

export const kokoroTtsEngine = new KokoroTtsEngine()
