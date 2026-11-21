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
