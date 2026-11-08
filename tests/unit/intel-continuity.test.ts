/**
 * BEAN Intelligence — continuity engine unit tests.
 * Frame extraction runs REAL ffmpeg/ffprobe on a tiny synthetic video
 * (generated locally with lavfi — no network). Vision-dependent paths are
 * exercised only through their honest-unavailable contract here; the live
 * evaluation harness covers real vision calls.
 */
import { describe, test, expect } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { extractFrame } from '../../src/lib/intel/continuity'

const execFileP = promisify(execFile)

async function makeTinyVideo(seconds = 1): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'intel-test-video-'))
  const file = path.join(dir, 'tiny.mp4')
  await execFileP(
    'ffmpeg',
    ['-f', 'lavfi', '-i', `color=c=red:s=64x64:d=${seconds}:r=10`, '-pix_fmt', 'yuv420p', '-y', file],
    { timeout: 30_000 },
  )
  return file
}

describe('frame extraction (ffmpeg, deterministic)', () => {
  test('extracts the last frame of a real tiny mp4 as a data URL', async () => {
    const video = await makeTinyVideo(1)
    try {
      const f = await extractFrame(video, 'last')
      expect(f.dataUrl).not.toBeNull()
      expect(f.dataUrl!.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(f.dataUrl!.length).toBeGreaterThan(100)
      expect(f.reason).toBeNull()
    } finally {
      await rm(path.dirname(video), { recursive: true, force: true })
    }
  })

  test('extracts a mid-position frame', async () => {
    const video = await makeTinyVideo(1)
    try {
      const f = await extractFrame(video, 0.5)
      expect(f.dataUrl).not.toBeNull()
    } finally {
      await rm(path.dirname(video), { recursive: true, force: true })
    }
  })

  test('unsupported containers degrade honestly (never a fabricated frame)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'intel-test-video-'))
    const file = path.join(dir, 'fake.avi')
    await writeFile(file, Buffer.from([0, 1, 2, 3]))
    try {
      const f = await extractFrame(file, 'last')
      expect(f.dataUrl).toBeNull()
      expect(f.reason).toContain('unsupported container')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('missing file degrades honestly with the real tool error', async () => {
    const f = await extractFrame(path.join(tmpdir(), 'definitely-not-there.mp4'), 'last')
    expect(f.dataUrl).toBeNull()
    expect(f.reason).not.toBeNull()
  })
})

describe('image buffer helper', () => {
  test('imageBufferToDataUrl produces a valid jpeg data URL', async () => {
    const { imageBufferToDataUrl } = await import('../../src/lib/intel/continuity')
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const dataUrl = await imageBufferToDataUrl(buf)
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
  })
})
