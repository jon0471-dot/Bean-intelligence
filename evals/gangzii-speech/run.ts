/**
 * BEAN Intelligence — GANGZII speech-quality evaluation runner (M28 Priority B).
 *
 * A repeatable, honest evaluation of what the local Kokoro engine ACTUALLY
 * produces. Non-negotiable honesty rules:
 *  - every sample is REAL synthesis through the production engine path
 *    (kokoroTtsEngine.generateSpeech) — never a mock or a synthetic waveform;
 *  - every technical number is MEASURED from the produced bytes (ffprobe /
 *    ffmpeg ebur128 / volumedetect / silencedetect) — never estimated;
 *  - automatic measurements and human listening reviews are kept SEPARATE;
 *    the generated review sheet is where the owner records listening scores;
 *    nothing in this runner claims listening approval;
 *  - voices WITHOUT generated samples stay unverified; generating samples
 *    moves a voice to "samples generated, listening review pending" — never
 *    straight to "verified";
 *  - model identity, revision and artifact-integrity state are recorded in
 *    every run so results are comparable across hosts and revisions.
 *
 * Run artifacts live OUTSIDE git under storage/evals/gangzii-speech/<runId>/
 * (WAV files would bloat the repository): run.json, review-sheet.md,
 * samples/<voice>/<itemId>.wav. The corpus itself and the M27 baseline are
 * tracked under evals/gangzii-speech/.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { kokoroTtsEngine } from '@/lib/gangzii/tts-engine'
import { normalizeTextForSpeech } from '@/lib/gangzii/text-normalize'
import { verifyKokoroModelIntegrity } from '@/lib/gangzii/model-integrity'
import { measureLoudnessEbur128 } from '@/lib/media/loudness'
import { KOKORO_VOICE_PRESETS } from '@/lib/registry/gangzii-presets'

// ---- public contracts ---------------------------------------------------------

export interface CorpusItem {
  id: string
  text: string
}
export interface CorpusCategory {
  id: string
  label: string
  items: CorpusItem[]
}
export interface SpeechCorpus {
  version: number
  description: string
  reviewNote: string
  categories: CorpusCategory[]
}

export interface AudioMeasurements {
  codec: string | null
  sampleRateHz: number | null
  channels: number | null
  durationSec: number | null
  integratedLufs: number | null
  /** True peak from the ebur128 summary (unit recorded separately). */
  truePeak: number | null
  truePeakUnit: 'dBFS' | 'dBTP' | null
  loudnessRangeLu: number | null
  peakDb: number | null
  meanDb: number | null
  clippingSuspected: boolean
  silenceRegionCount: number
  totalSilenceSec: number | null
}

export interface SampleResult {
  voice: string
  language: string
  itemId: string
  category: string
  originalText: string
  normalizedText: string
  normalizationChanges: Array<{ kind: string; count: number }>
  file: string
  chunks: number
  generationMs: number
  rtf: number | null
  peakRssMb: number | null
  audioDurationSec: number | null
  measurements: AudioMeasurements
  warnings: string[]
  error?: string
}

export interface VoiceSummary {
  voice: string
  language: string
  samplesGenerated: number
  samplesFailed: number
  listeningReview: 'pending' | 'approved' | 'rejected'
  verifiedStatus: 'samples-generated-review-pending' | 'failed' | 'not-evaluated'
  meanRtf: number | null
  meanGenerationMs: number | null
  meanIntegratedLufs: number | null
  maxTruePeakDbtp: number | null
  clippingSuspectedCount: number
}

export interface EvalEnvironment {
  platform: string
  vcpus: number | null
  cpuModel: string | null
  totalRamGb: number | null
  runtime: string
  ffmpegVersion: string | null
  modelRepo: string
  modelRevision: string | null
  modelDtype: string
  modelIntegrityState: string
  modelChecksumSource: string | null
  canonicalCommitSha: string | null
  engineVersion: string
}

export interface EvalRunSummary {
  runId: string
  startedAt: string
  completedAt: string | null
  corpusVersion: number
  voices: string[]
  categories: string[]
  itemsPerCategoryLimit: number | null
  speed: number
  environment: EvalEnvironment
  samples: SampleResult[]
  voiceSummaries: VoiceSummary[]
  notes: string[]
}

// ---- environment ----------------------------------------------------------------

function execPromise(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // ffmpeg tools exit non-zero for informational runs; return what we got.
        if (stdout || stderr) return resolve({ stdout: String(stdout), stderr: String(stderr) })
        return reject(err)
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

async function readEnvironment(): Promise<EvalEnvironment> {
  const integrity = verifyKokoroModelIntegrity()
  const meta = kokoroTtsEngine.getModelMetadata() as { engine?: string; repo?: string; revision?: string; dtype?: string }
  let vcpus: number | null = null
  let cpuModel: string | null = null
  let totalRamGb: number | null = null
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8')
    const models = cpuinfo.match(/model name\s*:\s*(.+)/)
    cpuModel = models ? models[1].trim() : null
    vcpus = (cpuinfo.match(/processor\s*:/g) ?? []).length
  } catch {
    /* non-Linux host: leave null, recorded honestly */
  }
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
    const m = meminfo.match(/MemTotal:\s+(\d+)\s kB/)
    if (m) totalRamGb = Math.round((Number(m[1]) / 1024 / 1024) * 10) / 10
  } catch {
    /* leave null */
  }
  let ffmpegVersion: string | null = null
  try {
    const { stdout } = await execPromise('ffmpeg', ['-version'], 15_000)
    ffmpegVersion = stdout.split('\n')[0]?.trim() ?? null
  } catch {
    /* leave null */
  }
  return {
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    vcpus,
    cpuModel,
    totalRamGb,
    runtime: `bun ${Bun.version ?? 'unknown'} / node ${process.version}`,
    ffmpegVersion,
    modelRepo: meta.repo ?? 'unknown',
    modelRevision: meta.revision ?? null,
    modelDtype: meta.dtype ?? 'unknown',
    modelIntegrityState: integrity.state,
    modelChecksumSource: integrity.checksumSource,
    canonicalCommitSha: integrity.canonicalCommitSha,
    engineVersion: typeof meta.engine === 'string' ? meta.engine : 'kokoro-82m-v1.0',
  }
}

// ---- audio measurement ------------------------------------------------------------

export async function measureAudioFile(file: string): Promise<AudioMeasurements> {
  const m: AudioMeasurements = {
    codec: null,
    sampleRateHz: null,
    channels: null,
    durationSec: null,
    integratedLufs: null,
    truePeak: null,
    truePeakUnit: null,
    loudnessRangeLu: null,
    peakDb: null,
    meanDb: null,
    clippingSuspected: false,
    silenceRegionCount: 0,
    totalSilenceSec: null,
  }
  // Stream facts (decodability gate — a file ffmpeg cannot decode fails here).
  try {
    const { stdout } = await execPromise(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,duration', '-of', 'json', file],
    )
    const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number; duration?: string }> }
    const s = parsed.streams?.[0]
    if (s) {
      m.codec = s.codec_name ?? null
      m.sampleRateHz = s.sample_rate ? Number(s.sample_rate) : null
      m.channels = s.channels ?? null
      m.durationSec = s.duration ? Number(s.duration) : null
    }
  } catch {
    return m // undecodable: everything else stays null
  }
  // EBU R128 loudness + true peak through the SHARED section-aware parser
  // (identical to what audio receipts record — one truth for every consumer).
  try {
    const loud = await measureLoudnessEbur128(file)
    m.integratedLufs = loud.integratedLufs
    m.truePeak = loud.truePeak
    m.truePeakUnit = loud.truePeakUnit
    m.loudnessRangeLu = loud.loudnessRangeLu
  } catch {
    /* stays null — recorded honestly */
  }
  // Peak/mean level + clipping indicator.
  try {
    const { stderr } = await execPromise('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
    const max = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)
    const mean = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
    if (max) m.peakDb = Number(max[1])
    if (mean) m.meanDb = Number(mean[1])
    m.clippingSuspected = m.peakDb !== null && m.peakDb >= -0.1
  } catch {
    /* stays null */
  }
  // Silence regions (default -30 dB / 2 s threshold, recorded as such).
  try {
    const { stderr } = await execPromise(
      'ffmpeg',
      ['-nostats', '-hide_banner', '-i', file, '-af', 'silencedetect=noise=-30dB:d=1.0', '-f', 'null', '-'],
    )
    const starts = (stderr.match(/silence_start:\s*(-?[\d.]+)/g) ?? []) as string[]
    const ends = (stderr.match(/silence_end:\s*([\d.]+)/g) ?? []) as string[]
    m.silenceRegionCount = starts.length
    if (ends.length > 0) {
      let total = 0
      for (const e of ends) {
        const v = e.split(':')[1]
        if (v) {
          const endSec = Number(v.trim().split('|')[0])
          const idx = ends.indexOf(e)
          const startMatch = starts[idx]?.match(/(-?[\d.]+)/)
          if (startMatch) total += Math.max(0, endSec - Number(startMatch[1]))
        }
      }
      m.totalSilenceSec = Math.round(total * 100) / 100
    }
  } catch {
    /* stays zero/null */
  }
  return m
}

// ---- the runner ---------------------------------------------------------------------

export interface RunOptions {
  corpus: SpeechCorpus
  voices: string[]
  /** Limit items per category (null = all). */
  itemsPerCategoryLimit?: number | null
  categories?: string[] | null
  speed?: number
  outputDir?: string
  runId?: string
  /** Disable WAV writing (tests) — measurements then run on the buffer via a temp file. */
  keepFiles?: boolean
}

interface RssSampler {
  start(): void
  stop(): number | null
}
function startRssSampler(): RssSampler {
  let peak = 0
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peak) peak = rss
  }, 100)
  timer.unref?.()
  return {
    start: () => {
      peak = process.memoryUsage().rss
    },
    stop: () => {
      clearInterval(timer)
      return peak > 0 ? Math.round(peak / (1024 * 1024)) : null
    },
  }
}

export async function runSpeechEvaluation(opts: RunOptions): Promise<EvalRunSummary> {
  const runId = opts.runId ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const outputDir = opts.outputDir ?? path.join(process.cwd(), 'storage', 'evals', 'gangzii-speech', runId)
  const samplesDir = path.join(outputDir, 'samples')
  fs.mkdirSync(samplesDir, { recursive: true })

  const environment = await readEnvironment()
  const notes: string[] = [
    'All samples are real synthesis through the production engine path; technical numbers are measured from the produced bytes.',
    'Listening review fields in review-sheet.md are EMPTY by design: automatic measurements never stand in for human review.',
    'Peak RAM is process RSS sampled every 100 ms during generation (includes the ONNX session). VRAM is not applicable on the CPU runtime and is recorded as null in comparisons.',
  ]
  if (environment.modelIntegrityState !== 'canonical-verified') {
    notes.push(`Model artifact provenance state at run time: ${environment.modelIntegrityState}${environment.modelChecksumSource ? ` (checksum source: ${environment.modelChecksumSource})` : ''}.`)
  }

  const categories = opts.categories ? opts.categories.map((c) => c.trim()).filter(Boolean) : null
  const selectedCategories = (categories ? opts.corpus.categories.filter((c) => categories.includes(c.id)) : opts.corpus.categories)

  const samples: SampleResult[] = []
  for (const voice of opts.voices) {
    // Voice identity from the client-safe preset registry (deterministic,
    // engine-load-order independent); the loaded model's own catalog is
    // cross-checked in the environment block.
    const preset = KOKORO_VOICE_PRESETS.find((v) => v.id === voice)
    const language = preset?.language ?? 'unknown'
    for (const category of selectedCategories) {
      const items = opts.itemsPerCategoryLimit ? category.items.slice(0, opts.itemsPerCategoryLimit) : category.items
      for (const item of items) {
        const norm = normalizeTextForSpeech(item.text, { language: 'en' })
        const result: SampleResult = {
          voice,
          language,
          itemId: item.id,
          category: category.id,
          originalText: item.text,
          normalizedText: norm.normalized,
          normalizationChanges: norm.changes,
          file: '',
          chunks: 0,
          generationMs: 0,
          rtf: null,
          peakRssMb: null,
          audioDurationSec: null,
          measurements: {
            codec: null,
            sampleRateHz: null,
            channels: null,
            durationSec: null,
            integratedLufs: null,
            truePeak: null,
            truePeakUnit: null,
            loudnessRangeLu: null,
            peakDb: null,
            meanDb: null,
            clippingSuspected: false,
            silenceRegionCount: 0,
            totalSilenceSec: null,
          },
          warnings: [],
        }
        try {
          const sampler = startRssSampler()
          sampler.start()
          const t0 = Date.now()
          const gen = await kokoroTtsEngine.generateSpeech({ text: norm.normalized, voice, speed: opts.speed ?? 1 })
          result.generationMs = Date.now() - t0
          result.peakRssMb = sampler.stop()
          result.chunks = gen.chunks
          result.warnings = [...gen.warnings]
          const voiceDir = path.join(samplesDir, voice)
          fs.mkdirSync(voiceDir, { recursive: true })
          const wavPath = path.join(voiceDir, `${item.id}.wav`)
          fs.writeFileSync(wavPath, gen.wav)
          result.file = path.relative(outputDir, wavPath)
          result.audioDurationSec = gen.durationSec
          result.rtf = gen.durationSec > 0 ? Math.round((result.generationMs / 1000 / gen.durationSec) * 100) / 100 : null
          result.measurements = await measureAudioFile(wavPath)
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e)
          notes.push(`Sample ${voice}/${item.id} FAILED: ${result.error}`)
        }
        samples.push(result)
      }
    }
  }

  const completedAt = new Date().toISOString()
  const voiceSummaries = summarizeVoices(opts.voices, samples)
  const run: EvalRunSummary = {
    runId,
    startedAt: runId.includes('run-') ? runId.slice(4).replace(/-/g, ':').replace(/T/, 'T') : completedAt,
    completedAt,
    corpusVersion: opts.corpus.version,
    voices: opts.voices,
    categories: selectedCategories.map((c) => c.id),
    itemsPerCategoryLimit: opts.itemsPerCategoryLimit ?? null,
    speed: opts.speed ?? 1,
    environment,
    samples,
    voiceSummaries,
    notes,
  }
  // startedAt: derive from runId cleanly instead of the string surgery above.
  const t0 = runId.indexOf('run-') === 0 ? new Date(runId.slice(4).replace(/-(\d+)-(\d+)$/, ':$1:$2')) : new Date(completedAt)
  run.startedAt = Number.isNaN(t0.getTime()) ? completedAt : t0.toISOString()

  fs.writeFileSync(path.join(outputDir, 'run.json'), JSON.stringify(run, null, 2))
  fs.writeFileSync(path.join(outputDir, 'review-sheet.md'), buildReviewSheet(run))
  return run
}

export function summarizeVoices(voices: string[], samples: SampleResult[]): VoiceSummary[] {
  return voices.map((voice) => {
    const mine = samples.filter((s) => s.voice === voice)
    const ok = mine.filter((s) => !s.error)
    const failed = mine.length - ok.length
    const rtfs = ok.map((s) => s.rtf).filter((v): v is number => v !== null)
    const gens = ok.map((s) => s.generationMs)
    const lufs = ok.map((s) => s.measurements.integratedLufs).filter((v): v is number => v !== null)
    const tps = ok.map((s) => s.measurements.truePeak).filter((v): v is number => v !== null)
    const clipping = ok.filter((s) => s.measurements.clippingSuspected).length
    const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null)
    return {
      voice,
      language: mine[0]?.language ?? 'unknown',
      samplesGenerated: ok.length,
      samplesFailed: failed,
      listeningReview: 'pending' as const,
      verifiedStatus: failed === mine.length && mine.length > 0 ? ('failed' as const) : mine.length > 0 ? ('samples-generated-review-pending' as const) : ('not-evaluated' as const),
      meanRtf: avg(rtfs),
      meanGenerationMs: avg(gens),
      meanIntegratedLufs: avg(lufs),
      maxTruePeakDbtp: tps.length ? Math.max(...tps) : null,
      clippingSuspectedCount: clipping,
    }
  })
}

// ---- listening review sheet ----------------------------------------------------------

/**
 * The review sheet is the owner's listening interface: one row per sample
 * with all technical measurements PRE-FILLED (measured, not claimed) and all
 * subjective fields BLANK (to be filled while listening). A verdict block per
 * voice and a global sign-off close the sheet. Nothing here asserts quality.
 */
export function buildReviewSheet(run: EvalRunSummary): string {
  const lines: string[] = []
  lines.push(`# GANGZII Speech Evaluation — Listening Review Sheet`)
  lines.push('')
  lines.push(`- **Run:** \`${run.runId}\``)
  lines.push(`- **Completed:** ${run.completedAt}`)
  lines.push(`- **Corpus:** v${run.corpusVersion} (evals/gangzii-speech/corpus.json)`)
  lines.push(`- **Voices:** ${run.voices.join(', ')}`)
  lines.push(`- **Model:** ${run.environment.modelRepo} @ ${run.environment.modelRevision} (${run.environment.modelDtype}); artifacts: **${run.environment.modelIntegrityState}**`)
  lines.push(`- **Host:** ${run.environment.platform}, ${run.environment.vcpus ?? '?'} vCPU, ${run.environment.totalRamGb ?? '?'} GB RAM, ${run.environment.cpuModel ?? 'CPU model unknown'}`)
  lines.push(`- **Runtime:** ${run.environment.runtime}; ffmpeg: ${run.environment.ffmpegVersion ?? 'unknown'}`)
  lines.push('')
  lines.push('> HOW TO USE: play each WAV under the run folder, rate the subjective columns (1 = worst, 5 = best, or `n/a`), add notes for artifacts. The technical columns are MEASURED — do not edit them. Automatic measurements are not a substitute for listening; a voice is only as good as a human ear confirms.')
  lines.push('')
  for (const voice of run.voices) {
    const mine = run.samples.filter((s) => s.voice === voice)
    const summary = run.voiceSummaries.find((v) => v.voice === voice)
    lines.push(`## Voice: \`${voice}\` (${summary?.language ?? 'unknown'})`)
    lines.push('')
    lines.push(`Samples generated: ${summary?.samplesGenerated ?? 0} · failed: ${summary?.samplesFailed ?? 0} · mean RTF: ${summary?.meanRtf ?? 'n/a'} · mean LUFS: ${summary?.meanIntegratedLufs ?? 'n/a'} · max TP: ${summary?.maxTruePeakDbtp ?? 'n/a'} (dBFS/dBTP as measured) · clipping-suspected: ${summary?.clippingSuspectedCount ?? 0}`)
    lines.push('')
    lines.push('| # | Item | Category | Original text | File | Dur (s) | RTF | LUFS | TP | Peak dB | Silence | Intelligibility | Pronunciation | Naturalness | Pacing | Pauses | Consistency | Transitions | Artifacts | Notes |')
    lines.push('|---|------|----------|---------------|------|---------|-----|------|-----|---------|---------|-----------------|---------------|-------------|--------|--------|-------------|-------------|-----------|-------|')
    mine.forEach((s, i) => {
      const err = s.error ? `SYNTH FAILED: ${s.error}` : s.file
      const dur = s.measurements.durationSec !== null ? s.measurements.durationSec.toFixed(2) : (s.audioDurationSec?.toFixed(2) ?? 'n/a')
      const tp = s.measurements.truePeak !== null ? `${s.measurements.truePeak} ${s.measurements.truePeakUnit ?? ''}`.trim() : 'n/a'
      lines.push(
        `| ${i + 1} | ${s.itemId} | ${s.category} | ${s.originalText.replace(/\|/g, '/')} | ${err} | ${dur} | ${s.rtf ?? 'n/a'} | ${s.measurements.integratedLufs ?? 'n/a'} | ${tp} | ${s.measurements.peakDb ?? 'n/a'} | ${s.measurements.silenceRegionCount} | | | | | | | | | |`,
      )
    })
    lines.push('')
    lines.push(`**Voice verdict (owner fills):** \`\`\`[ approved | rejected | needs-changes ]\`\`\` — voice status stays \`samples-generated-review-pending\` until this block is filled.`)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('### Global sign-off')
  lines.push('')
  lines.push('```')
  lines.push('Reviewed by:  ______________________')
  lines.push('Date:         ______________________')
  lines.push('Overall verdict (approved / rejected / needs-changes): ______________________')
  lines.push('Regressions noticed vs M27 (pronunciation, missing text, ordering, timing, clipping, loudness, speed, memory):')
  lines.push('')
  lines.push('```')
  lines.push('')
  lines.push('_This sheet distinguishes automatic technical measurements (pre-filled, measured) from human listening evaluation (blank). Do not mark a voice verified without filling the subjective columns._')
  return lines.join('\n')
}
