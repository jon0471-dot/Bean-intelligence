/**
 * JAZMII M28 Priority D — HyperFrames scene-timed SFX, REAL renders.
 *
 * The M27 limitation ("SFX not applied by the HyperFrames engine") is closed
 * in M28 by generating timed <audio> elements on the runtime's VERIFIED
 * contract (data-start / data-duration / data-volume / data-fade-* — read
 * from the shipped hyperframes@0.9.72 runtime, not guessed). These tests
 * render REAL compositions and verify the audio stream with ffprobe +
 * actual level analysis, because a copied asset file is never proof that a
 * sound was mixed:
 *   - the audio stream exists in the rendered MP4;
 *   - the expected time region contains the sound (RMS jumps in the window);
 *   - the volume behavior matches volume × known tone amplitude (tolerance);
 *   - overlapping effects both land (RMS rises further, no phase tricks);
 *   - duration/frame accounting is IDENTICAL with and without SFX;
 *   - no unexpected clipping.
 *
 * The suite skips honestly when the pinned runtime's browser is absent
 * (an offline host must not fake a render pass).
 */
import { describe, test, expect, afterAll } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHyperframesCompositionEngine, HYPERFRAMES_VERSION } from '../../src/lib/jazmii/director/composition/hyperframes-engine'

const execFileP = promisify(execFile)

const dir = await mkdtemp(path.join(tmpdir(), 'bean-m28-hf-sfx-'))
const engine = createHyperframesCompositionEngine()
const probe = await engine.probe()

async function makeClip(name: string, seconds: number): Promise<string> {
  const out = path.join(dir, name)
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=540x960:rate=30:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-an', out,
  ])
  return out
}

/** Real tone asset at a known amplitude (the volume-tolerance ground truth). */
async function makeTone(name: string, freq: number, seconds: number, amplitude: number): Promise<string> {
  const out = path.join(dir, name)
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
    '-af', `volume=${amplitude}`,
    '-c:a', 'pcm_s16le', out,
  ])
  return out
}

async function windowRmsDb(mp4: string, start: number, end: number): Promise<{ rmsDb: number; maxDb: number }> {
  const res = await execFileP(
    'ffmpeg',
    ['-nostats', '-hide_banner', '-i', mp4, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level`, '-f', 'null', '-'],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  )
  const num = (s: string | undefined): number => (s === undefined ? Number.NaN : s === '-inf' ? -Infinity : Number(s))
  const rms = res.stderr.match(/RMS level dB:\s*(-?(?:[\d.]+|inf))/)
  const max = res.stderr.match(/Peak level dB:\s*(-?(?:[\d.]+|inf))/)
  if (!rms) console.warn(`[hf-sfx-test] no astats match for window ${start}–${end}; stderr tail: ${res.stderr.split('\n').filter(Boolean).slice(-6).join(' | ')}`)
  return { rmsDb: num(rms?.[1]), maxDb: num(max?.[1]) }
}

function basePlan(outputName: string, scenes: Array<{ idx: number; clipPath: string; durationSec: number; caption: string | null; transitionOut: 'cut' | 'fade' }>, extra: Record<string, unknown> = {}) {
  return {
    productionId: 'm28-hf-sfx-test',
    title: 'HyperFrames SFX Verification',
    canvas: { width: 540, height: 960, fps: 30 },
    background: '0a0a0f',
    scenes,
    endCard: { title: 'HyperFrames SFX Verification', subtitle: null, durationSec: 2 },
    audio: { musicPath: null, musicVolume: 0.32, musicAttribution: null, voiceoverPath: null, voiceoverVolume: 1.0 },
    workDir: dir,
    outputPath: path.join(dir, outputName),
    ...extra,
  }
}

describe.skipIf(!probe.available)(`HyperFrames ${HYPERFRAMES_VERSION} — M28 SFX real renders`, () => {
  test('baseline: a no-audio composition renders with the exact planned duration/frames', async () => {
    const clipA = await makeClip('hf-a.mp4', 3)
    const clipB = await makeClip('hf-b.mp4', 3)
    const plan = basePlan('hf-baseline.mp4', [
      { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
      { idx: 2, clipPath: clipB, durationSec: 3, caption: null, transitionOut: 'cut' },
    ])
    const result = await engine.compose(plan)
    expect(result.probe.ok).toBe(true)
    // No audio requested → honest no-audio note (probe.audio is whatever the
    // container carries; the note is the contract).
    expect(result.notes.some((n) => n.includes('No audio track'))).toBe(true)
    expect(Math.abs(result.measuredDurationSec - 8)).toBeLessThan(0.35)
  }, 240_000)

  test('two timed SFX land in the mix: presence, placement, volume tolerance, no clipping', async () => {
    const clipA = await makeClip('hf-a.mp4', 3)
    const clipB = await makeClip('hf-b.mp4', 3)
    // Known ground truth: 0.5 amplitude tones at 0.8/0.9 volume.
    const sfx1 = await makeTone('sfx1.wav', 330, 1.0, 0.5) // plays at 2.0s, volume 0.8
    const sfx2 = await makeTone('sfx2.wav', 660, 1.0, 0.5) // plays at 4.5s, volume 0.9
    const plan = basePlan('hf-sfx.mp4', [
      { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
      { idx: 2, clipPath: clipB, durationSec: 3, caption: null, transitionOut: 'cut' },
    ], {
      audio: {
        musicPath: null,
        musicVolume: 0.32,
        musicAttribution: null,
        voiceoverPath: null,
        voiceoverVolume: 1.0,
        sfx: [
          { path: sfx1, startSec: 2.0, volume: 0.8, label: 'impact' },
          { path: sfx2, startSec: 4.5, volume: 0.9, label: 'whoosh' },
        ],
      },
    })
    const result = await engine.compose(plan)
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    expect(result.probe.audio!.codec).toBe('aac')
    // Honest note: WHAT was mixed (positions + volumes), not a bare count.
    expect(result.notes.some((n) => n.includes('2 sound effect(s) mixed as timed audio elements'))).toBe(true)
    expect(result.notes.some((n) => n.includes('2.00s@0.80'))).toBe(true)
    // Duration/frame accounting unchanged vs the 8 s plan.
    expect(Math.abs(result.measuredDurationSec - 8)).toBeLessThan(0.35)

    // MEASURED runtime gain staging (recorded 2026-11-21 on 0.9.72): the
    // WebAudio render graph applies a constant ≈ −18.1 dB offset vs source
    // unity, while data-volume itself is linear (Δ −6.02 dB measured for a
    // ×0.5 change). The tolerance therefore anchors on the naive level PLUS
    // the measured offset — the behavior under test is linearity + placement,
    // not the runtime's internal headroom.
    const measuredPipelineOffsetDb = -18.1
    const naive = (a: number) => 20 * Math.log10(a / Math.SQRT2)

    // BEFORE the first effect: silence-ish (video has no audio, music absent).
    const before = await windowRmsDb(result.videoPath, 0.4, 1.6)
    // INSIDE effect 1 (2.0–2.9): naive −11.0 dB + pipeline offset.
    const inside1 = await windowRmsDb(result.videoPath, 2.05, 2.9)
    // INSIDE effect 2 (4.5–5.4): naive −10.9 dB + offset.
    const inside2 = await windowRmsDb(result.videoPath, 4.55, 5.4)
    // BETWEEN the effects (3.2–4.2): back to silence-ish.
    const between = await windowRmsDb(result.videoPath, 3.2, 4.2)

    expect(Number.isNaN(before.rmsDb)).toBe(false)
    expect(Number.isNaN(inside1.rmsDb)).toBe(false)
    // Silence-safe level deltas (−Infinity = digital silence after atrim).
    const d = (a: number, b: number) => (a === b ? 0 : Math.abs(a) === Infinity || Math.abs(b) === Infinity ? (a === -Infinity ? -999 : 999) : a - b)
    expect(d(inside1.rmsDb, before.rmsDb)).toBeGreaterThan(8) // the sound IS there
    expect(d(between.rmsDb, inside1.rmsDb)).toBeLessThan(-8) // placement did not smear: between-effects window is silent-ish
    const expected1 = naive(0.5 * 0.8) + measuredPipelineOffsetDb
    const expected2 = naive(0.5 * 0.9) + measuredPipelineOffsetDb
    expect(Math.abs(inside1.rmsDb - expected1)).toBeLessThan(2.0)
    expect(Math.abs(inside2.rmsDb - expected2)).toBeLessThan(2.0)
    // Linearity: the two volumes differ by exactly 20log10(0.9/0.8) ≈ 1.03 dB.
    expect(Math.abs((inside2.rmsDb - inside1.rmsDb) - 20 * Math.log10(0.9 / 0.8))).toBeLessThan(1.0)
    expect(inside1.maxDb).toBeLessThan(-0.1)
    expect(inside2.maxDb).toBeLessThan(-0.1)
  }, 300_000)

  test('overlapping SFX both land: the overlap window is louder than either alone', async () => {
    const clipA = await makeClip('hf-a.mp4', 3)
    const sfxA = await makeTone('ov-a.wav', 330, 1.5, 0.4)
    const sfxB = await makeTone('ov-b.wav', 660, 1.5, 0.4)
    const plan = basePlan('hf-overlap.mp4', [
      { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
    ], {
      audio: {
        musicPath: null,
        musicVolume: 0.32,
        musicAttribution: null,
        voiceoverPath: null,
        voiceoverVolume: 1.0,
        sfx: [
          { path: sfxA, startSec: 1.0, volume: 1.0, label: 'a' },
          { path: sfxB, startSec: 1.5, volume: 1.0, label: 'b' },
        ],
      },
    })
    const result = await engine.compose(plan)
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    // Solo window (0.2–0.9): only effect A is active (starts at 1.0 — wait,
    // nothing before 1.0). Use [1.05, 1.45] = A alone, [1.55, 2.4] = A+B.
    const aAlone = await windowRmsDb(result.videoPath, 1.05, 1.45)
    const overlap = await windowRmsDb(result.videoPath, 1.6, 2.4)
    expect(Number.isNaN(aAlone.rmsDb)).toBe(false)
    expect(Number.isNaN(overlap.rmsDb)).toBe(false)
    // Two distinct-frequency tones add power → the overlap window is louder.
    expect(overlap.rmsDb).toBeGreaterThan(aAlone.rmsDb + 1.5)
    expect(overlap.maxDb).toBeLessThan(-0.1)
  }, 300_000)


  test('SFX fade-out is honored: the effect decays before its media end', async () => {
    const clipA = await makeClip('hf-fade.mp4', 3)
    const sfx = await makeTone('fade-sfx.wav', 440, 2.0, 0.5) // 2 s tone at 1.0s, fade-out 1.0
    const plan = basePlan('hf-fade-out.mp4', [
      { idx: 1, clipPath: clipA, durationSec: 3, caption: null, transitionOut: 'cut' },
    ], {
      audio: {
        musicPath: null,
        musicVolume: 0.32,
        musicAttribution: null,
        voiceoverPath: null,
        voiceoverVolume: 1.0,
        sfx: [{ path: sfx, startSec: 1.0, volume: 1.0, label: 'decay', fadeOutSeconds: 1.0 }],
      },
    })
    const result = await engine.compose(plan)
    expect(result.probe.ok).toBe(true)
    expect(result.probe.audio).not.toBeNull()
    expect(result.notes.some((n) => n.includes('with requested fades'))).toBe(true)
    // Full-level zone [1.1, 1.6] vs late-fade zone [2.6, 2.9] (the 1 s
    // fade-out spans [2.0, 3.0]; afade/data-fade-out are linear, so the
    // late-fade level is 0.1-0.4 of full — a real, measurable decay).
    const full = await windowRmsDb(result.videoPath, 1.1, 1.6)
    const faded = await windowRmsDb(result.videoPath, 2.6, 2.9)
    expect(Number.isNaN(full.rmsDb)).toBe(false)
    expect(Number.isNaN(faded.rmsDb)).toBe(false)
    expect(full.rmsDb - faded.rmsDb).toBeGreaterThan(4)
  }, 300_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })
})
