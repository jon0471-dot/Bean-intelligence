/**
 * ffprobe media validation tests — REAL binaries (ffmpeg/ffprobe present on
 * the host). The JAZMII completion gate depends on this module rejecting
 * degenerate payloads; these tests generate actual media with ffmpeg so the
 * gate's measurements are pinned against real decoder output.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { probeVideoBytes, MIN_DURATION_SEC, MIN_FRAMES } from '../../src/lib/media/ffprobe'

let dir: string
let realMp4: Buffer
let oneFrameMp4: Buffer

function ffmpeg(args: string[]): Buffer {
  const out = path.join(dir, `gen-${Math.random().toString(36).slice(2)}.mp4`)
  execFileSync('ffmpeg', [...args, '-y', out], { timeout: 60_000, stdio: 'ignore' })
  return readFileSync(out)
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bean-ffprobe-test-'))
  // A real 1-second H.264 clip (25 fps → ~25 frames).
  realMp4 = ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x96:rate=25', '-pix_fmt', 'yuv420p', '-c:v', 'libx264'])
  // A degenerate single-frame clip (the exact trap the gate exists for).
  oneFrameMp4 = ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=0.04:size=128x96:rate=25', '-pix_fmt', 'yuv420p', '-c:v', 'libx264'])
})

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

describe('probeVideoBytes (real ffprobe)', () => {
  test('a real 1s H.264 clip validates with measured stream facts', async () => {
    const probe = await probeVideoBytes(realMp4, 'mp4')
    expect(probe.ok).toBe(true)
    expect(probe.video?.codec).toBe('h264')
    expect(probe.video?.width).toBe(128)
    expect(probe.video?.height).toBe(96)
    expect(probe.video?.durationSec).toBeGreaterThanOrEqual(0.9)
    expect(probe.video?.frames).toBeGreaterThanOrEqual(MIN_FRAMES)
  })

  test('a single-frame clip is REJECTED (duration/frame minimums)', async () => {
    const probe = await probeVideoBytes(oneFrameMp4, 'mp4')
    expect(probe.ok).toBe(false)
    // A 0.04s clip trips the duration gate first — either honest rejection
    // (duration or frames) is the pinned behavior.
    expect(probe.error ?? '').toMatch(/frame|duration/)
  })

  test('garbage bytes that fake an MP4 header are rejected', async () => {
    const fake = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2048, 7)])
    const probe = await probeVideoBytes(fake, 'mp4')
    expect(probe.ok).toBe(false)
    expect(probe.error).toBeTruthy()
  })

  test('a text payload is rejected', async () => {
    const probe = await probeVideoBytes(Buffer.from('this is not a video at all'), 'mp4')
    expect(probe.ok).toBe(false)
  })
})

describe('constants', () => {
  test('the gate thresholds are the documented ones', () => {
    expect(MIN_DURATION_SEC).toBe(0.5)
    expect(MIN_FRAMES).toBe(8)
  })
})
