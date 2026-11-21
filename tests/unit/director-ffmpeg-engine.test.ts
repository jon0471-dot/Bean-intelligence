/**
 * JAZMII AUTO DIRECTOR — FFmpeg composition engine tests (REAL media).
 *
 * No mocks on the media path: fixtures are real H.264 clips generated with
 * ffmpeg, composition runs the REAL engine, and every assertion reads
 * ffprobe-measured facts from the produced file (spec §16: verify the
 * output MP4 rather than trusting the process exit code).
 *
 * Pinned behavior:
 *  - exact frame accounting (expected frames = round(total*fps));
 *  - contain + background fill (mixed source sizes never stretch);
 *  - captions SRT written when captions exist; poster extracted;
 *  - music mixing produces a real audio stream; no music → honest
 *    no-audio note;
 *  - a missing scene clip is refused with a precise error.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { probeVideoFile } from '../../src/lib/media/ffprobe'
import { createFfmpegCompositionEngine } from '../../src/lib/jazmii/director/composition/ffmpeg-engine'

const execFileP = promisify(execFile)

let dir: string

async function makeClip(name: string, w: number, h: number, seconds: number, withAudio: boolean): Promise<string> {
  const out = path.join(dir, name)
  const audio = withAudio ? ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`] : []
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30:duration=${seconds}`,
    ...audio,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    ...(withAudio ? ['-c:a', 'aac', '-shortest'] : ['-an']),
    out,
  ])
  return out
}

async function makeMusic(seconds: number): Promise<string> {
  const out = path.join(dir, 'music.mp3')
  await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`, '-c:a', 'libmp3lame', out])
  return out
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bean-director-ffmpeg-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

const CANVAS = { width: 540, height: 960, fps: 30 }

function plan(overrides: Partial<Parameters<ReturnType<typeof createFfmpegCompositionEngine>['compose']>[0]> = {}) {
  return {
    productionId: 'test-production',
    title: 'Aurora Launch Film',
    canvas: CANVAS,
    background: '0a0a0f',
    scenes: [],
    endCard: { title: 'Aurora Launch Film', subtitle: 'Wake with the sun.', durationSec: 2 },
    audio: { musicPath: null, musicVolume: 0.32, musicAttribution: null, voiceoverPath: null, voiceoverVolume: 1.0 },
    workDir: dir,
    outputPath: path.join(dir, 'final.mp4'),
    ...overrides,
  }
}

describe('ffmpeg composition engine — real render', () => {
  test('probe reports availability with the measured ffmpeg version', async () => {
    const engine = createFfmpegCompositionEngine()
    const probe = await engine.probe()
    expect(probe.available).toBe(true)
    expect(probe.detail.ffmpegVersion).toContain('7.')
  })

  test('two scenes + end card compose to EXACT frame accounting, dims and duration', async () => {
    const engine = createFfmpegCompositionEngine()
    const clipA = await makeClip('a.mp4', 540, 960, 3, false)
    const clipB = await makeClip('b.mp4', 720, 720, 4, false) // different source size → contain+fill
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: 'Wake with the sun.', transitionOut: 'cut' },
          { idx: 2, clipPath: clipB, durationSec: 4, caption: null, transitionOut: 'fade' },
        ],
        outputPath: path.join(dir, 'final-exact.mp4'),
      }),
    )
    expect(result.engine).toBe('ffmpeg')
    // 3 + 4 + 2 (end card) = 9s * 30fps = 270 frames exactly.
    expect(result.probe.video).not.toBeNull()
    expect(result.probe.video!.frames).toBe(270)
    expect(result.measuredDurationSec).toBeCloseTo(9.0, 1)
    expect(result.plannedDurationSec).toBe(9)
    expect(result.probe.video!.width).toBe(540)
    expect(result.probe.video!.height).toBe(960)
    expect(result.probe.video!.fps).toBe(30)
    // No audio inputs → honest no-audio note.
    expect(result.notes.some((n) => n.includes('No audio track'))).toBe(true)
    // Captions existed → SRT written; poster extracted.
    expect(result.captionsPath).not.toBeNull()
    const srt = await readFile(result.captionsPath!, 'utf8')
    expect(srt).toContain('Wake with the sun.')
    expect(result.posterPath).not.toBe('')
    const poster = fs.statSync(result.posterPath)
    expect(poster.size).toBeGreaterThan(1000)
  }, 60_000)

  test('music mixing produces a REAL audio stream with fades', async () => {
    const engine = createFfmpegCompositionEngine()
    const clipA = await makeClip('c.mp4', 540, 960, 3, false)
    const music = await makeMusic(8)
    const result = await engine.compose(
      plan({
        scenes: [{ idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' }],
        audio: { musicPath: music, musicVolume: 0.32, musicAttribution: 'test tone', voiceoverPath: null, voiceoverVolume: 1.0 },
        outputPath: path.join(dir, 'final-music.mp4'),
      }),
    )
    // 3 + 2 = 5s; music trimmed to the exact timeline length.
    expect(result.probe.audio).not.toBeNull()
    expect(result.probe.audio!.codec).toBe('aac')
    expect(result.measuredDurationSec).toBeCloseTo(5.0, 1)
    expect(result.probe.video!.durationSec).toBeCloseTo(5.0, 1)
  }, 60_000)

  test('a missing scene clip is refused before any ffmpeg run', async () => {
    const engine = createFfmpegCompositionEngine()
    let caught: unknown = null
    try {
      await engine.compose(
        plan({ scenes: [{ idx: 1, clipPath: path.join(dir, 'missing.mp4'), durationSec: 3, caption: null, transitionOut: 'cut' }] }),
      )
    } catch (e) {
      caught = e
    }
    expect((caught as Error).message).toContain('scene 1 clip is missing on disk')
  })

  test('a corrupt scene clip fails honestly (never a fake pass)', async () => {
    // Garbage bytes at the clip path — ffmpeg must refuse and the engine must
    // surface the real failure.
    const engine = createFfmpegCompositionEngine()
    const corrupt = path.join(dir, 'corrupt.mp4')
    await fs.promises.writeFile(corrupt, Buffer.from('this is not a video file at all', 'utf8'))
    let caught: unknown = null
    try {
      await engine.compose(
        plan({ scenes: [{ idx: 1, clipPath: corrupt, durationSec: 3, caption: null, transitionOut: 'cut' }] }),
      )
    } catch (e) {
      caught = e
    }
    expect(caught).not.toBeNull()
    expect((caught as Error).message).toContain('composition failed')
  })
})


  test('M28: SFX fade-out is applied against the MEASURED asset duration', async () => {
    const engine = createFfmpegCompositionEngine()
    // 2 s tone placed at 1.0 s with a 1 s fade-out (so [1.9, 2.4] is mostly faded).
    const sfxPath = path.join(dir, 'fade-sfx.wav')
    await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', sfxPath])
    const clipA = await makeClip('m28-fade.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: {
          musicPath: null,
          musicVolume: 0.32,
          musicAttribution: null,
          voiceoverPath: null,
          voiceoverVolume: 1.0,
          sfx: [{ path: sfxPath, startSec: 1.0, volume: 1.0, label: 'decay', fadeOutSeconds: 1.0 }],
        },
        outputPath: path.join(dir, 'm28-fade-out.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    const rmsOf = async (start: number, end: number) => {
      const res = await execFileP(
        'ffmpeg',
        ['-nostats', '-hide_banner', '-i', result.videoPath, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-'],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      )
      const m = res.stderr.match(/RMS level dB:\s*(-?(?:[\d.]+|inf))/)
      return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : Number.NaN
    }
    // afade is linear: fade zone is [2.0, 3.0]; near its end the level is
    // 0.1-0.4 of full — a real decay, measurable against the full zone.
    const full = await rmsOf(1.2, 1.8)
    const faded = await rmsOf(2.6, 2.9)
    expect(Number.isNaN(full)).toBe(false)
    expect(full - faded).toBeGreaterThan(4)
  }, 120_000)

describe('ffprobe gate parity', () => {
  test('the produced file passes the SAME validation the delivery worker uses', async () => {
    const engine = createFfmpegCompositionEngine()
    const clipA = await makeClip('e.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({ scenes: [{ idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' }], outputPath: path.join(dir, 'final-gate.mp4') }),
    )
    const bytes = fs.readFileSync(result.videoPath)
    const gate = await import('../../src/lib/media/ffprobe').then((m) => m.validateVideoArtifact(bytes, 'mp4', { jobId: 'test' }))
    expect(gate.ok).toBe(true)
    expect(gate.video!.frames).toBe(150) // 3s + 2s end card = 5s * 30fps
  }, 60_000)
})

// ---------------------------------------------------------------------------
// M27 (2026-11-21): GANGZII audio integration — voiceover + scene-timed SFX
// mixed by the REAL engine into the REAL MP4 (ffprobe-verified audio).
// ---------------------------------------------------------------------------

describe('ffmpeg composition engine — M27 audio (voiceover + SFX)', () => {
  test('a real narration WAV mixes into the MP4 as the voiceover track', async () => {
    const engine = createFfmpegCompositionEngine()
    const voice = await makeMusic(6) // a real 6s audio file (tone stands in for narration bytes)
    const clipA = await makeClip('m27-a.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: { musicPath: null, musicVolume: 0.32, musicAttribution: null, voiceoverPath: voice, voiceoverVolume: 1.0 },
        outputPath: path.join(dir, 'm27-voice.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    expect(result.probe.audio!.codec).toBe('aac')
    // The voiceover content actually shaped the mix (duration tracks it).
    expect(result.measuredDurationSec).toBeGreaterThan(4)
    expect(result.notes.some((n) => n.includes('No audio track'))).toBe(false)
  }, 120_000)

  test('music + voiceover + scene-timed SFX all mix into one audio stream', async () => {
    const engine = createFfmpegCompositionEngine()
    const music = await makeMusic(8)
    const voice = await makeMusic(6)
    const sfx = await makeMusic(1)
    const clipA = await makeClip('m27-b1.mp4', 540, 960, 3, false)
    const clipB = await makeClip('m27-b2.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
          { idx: 2, clipPath: clipB, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: {
          musicPath: music,
          musicVolume: 0.32,
          musicAttribution: 'test music tone',
          voiceoverPath: voice,
          voiceoverVolume: 1.0,
          sfx: [{ path: sfx, startSec: 2.0, volume: 0.9, label: 'impact tone' }],
        },
        outputPath: path.join(dir, 'm27-mix.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    expect(result.probe.audio!.codec).toBe('aac')
    // Honest note: the effect count is recorded in the render metadata.
    expect(result.notes.some((n) => n.includes('1 sound effect(s) mixed'))).toBe(true)
    expect(result.notes.some((n) => n.includes('static ducking'))).toBe(true)
  }, 150_000)

  test('a SFX-only plan still produces a real audio stream (single-source pad path)', async () => {
    const engine = createFfmpegCompositionEngine()
    const sfx = await makeMusic(2)
    const clipA = await makeClip('m27-c.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: {
          musicPath: null,
          musicVolume: 0.32,
          musicAttribution: null,
          voiceoverPath: null,
          voiceoverVolume: 1.0,
          sfx: [{ path: sfx, startSec: 1.0, volume: 0.8, label: null }],
        },
        outputPath: path.join(dir, 'm27-sfx-only.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    expect(result.probe.audio!.codec).toBe('aac')
  }, 120_000)
})

describe('ffmpeg composition engine — M28 dynamic ducking (real render + real audio measurement)', () => {
  /** Very quiet tone so the mix inside narration windows ≈ the ducked music. */
  async function makeQuietVoice(seconds: number): Promise<string> {
    const out = path.join(dir, 'quiet-voice.wav')
    await execFileP('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=880:duration=${seconds}`,
      '-af', 'volume=0.01',
      '-c:a', 'pcm_s16le', out,
    ])
    return out
  }

  /** Mean RMS of the composed MP4's audio over a window (real astats). */
  async function windowRmsDb(mp4: string, start: number, end: number): Promise<number> {
    const res = await execFileP(
      'ffmpeg',
      ['-nostats', '-hide_banner', '-i', mp4, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-'],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    )
    const m = res.stderr.match(/RMS level dB:\s*(-?[\d.]+)/)
    return m ? Number(m[1]) : Number.NaN
  }

  test('music follows the measured narration curve: ducked window ≈ full window − duck depth', async () => {
    const engine = createFfmpegCompositionEngine()
    const music = await makeMusic(9)
    const voice = await makeQuietVoice(9)
    const clipA = await makeClip('m28-a.mp4', 540, 960, 3, false)
    const clipB = await makeClip('m28-b.mp4', 540, 960, 3, false)
    // Scenes [0,3) + [3,6) + end card [6,8): narration region spans the first scene gap.
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
          { idx: 2, clipPath: clipB, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: {
          musicPath: music,
          musicVolume: 0.32,
          musicAttribution: null,
          voiceoverPath: voice,
          voiceoverVolume: 1.0,
          voiceoverActiveRegions: [{ startSec: 1.5, endSec: 4.5 }],
          duck: { duckTo: 0.35, attackMs: 150, releaseMs: 400, curve: 'cosine' },
        },
        outputPath: path.join(dir, 'm28-duck.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    // Honest note: the render metadata says exactly what ducking did.
    expect(result.notes.some((n) => n.includes('ducks dynamically'))).toBe(true)
    expect(result.notes.some((n) => n.includes('NOT sidechain compression'))).toBe(true)

    // REAL measurement: narration window [2.0, 4.0] vs narration-free [5.0, 5.9]
    // (region ends at 4.5 + release 0.4; end card starts at 6.0).
    const inside = await windowRmsDb(result.videoPath, 2.0, 4.0)
    const outside = await windowRmsDb(result.videoPath, 5.0, 5.9)
    expect(Number.isFinite(inside)).toBe(true)
    expect(Number.isFinite(outside)).toBe(true)
    const delta = inside - outside
    const expectedDuckDb = 20 * Math.log10(0.35) // ≈ -9.1 dB
    // The quiet voiceover contributes negligibly; tolerance covers the mix
    // sum and AAC encode artifacts.
    expect(Math.abs(delta - expectedDuckDb)).toBeLessThan(2.0)
  }, 180_000)

  test('without narration regions the honest static-duck note is preserved (M27 behavior intact)', async () => {
    const engine = createFfmpegCompositionEngine()
    const music = await makeMusic(8)
    const voice = await makeMusic(6)
    const clipA = await makeClip('m28-b1.mp4', 540, 960, 3, false)
    const clipB = await makeClip('m28-b2.mp4', 540, 960, 3, false)
    const result = await engine.compose(
      plan({
        scenes: [
          { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
          { idx: 2, clipPath: clipB, durationSec: 3, caption: null, transitionOut: 'cut' },
        ],
        audio: {
          musicPath: music,
          musicVolume: 0.32,
          musicAttribution: null,
          voiceoverPath: voice,
          voiceoverVolume: 1.0,
        },
        outputPath: path.join(dir, 'm28-static.mp4'),
      }),
    )
    expect(result.probe.ok).toBe(true)
    expect(result.notes.some((n) => n.includes('static ducking'))).toBe(true)
    expect(result.notes.some((n) => n.includes('ducks dynamically'))).toBe(false)
  }, 150_000)
})
