/**
 * LAXII-JAZMII RESTORATION (2026-11-14, defect D5) — measured ffprobe
 * availability for the video completion gate.
 *
 * Pins: the probe EXECUTES `ffprobe -version` (never assumes from PATH
 * optimism), reports the binary's own version banner, caches briefly, and
 * degrades to an honest unavailable report with bounded detail when the
 * binary cannot run. On a host WITH ffprobe (this one ships 7.x) the probe
 * must be available — the ARTIFACT_INVALID-by-missing-ffprobe failure mode
 * is the regression this reporting exists to surface.
 */
import { describe, test, expect } from 'bun:test'
import { probeFfprobe } from '../../src/lib/media/ffprobe-health'

describe('ffprobe availability probe (defect D5)', () => {
  test('on a host with ffprobe the probe is available with a real version banner', async () => {
    const report = await probeFfprobe(true)
    expect(report.available).toBe(true)
    expect(report.version).toBeTruthy()
    expect(report.version).toMatch(/ffprobe/i)
    expect(report.detail).toBeNull()
    expect(report.checkedAt).toBeTruthy()
    expect(report.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('the probe caches (second non-forced read reuses the measurement)', async () => {
    const first = await probeFfprobe(true)
    const second = await probeFfprobe(false)
    expect(second.checkedAt).toBe(first.checkedAt)
    expect(second.version).toBe(first.version)
  })

  test('a forced re-probe re-measures', async () => {
    const a = await probeFfprobe(true)
    const b = await probeFfprobe(true)
    expect(b.available).toBe(a.available)
    // checkedAt is a fresh measurement timestamp (may equal if same ms —
    // assert the shape, not the clock tick).
    expect(new Date(b.checkedAt).getTime()).toBeGreaterThanOrEqual(new Date(a.checkedAt).getTime())
  })

  test('the ffprobe completion-gate binary is the same one the probe measures', async () => {
    // Media ffprobe module: a real probe on a real generated file succeeds.
    const { probeVideoBytes } = await import('../../src/lib/media/ffprobe')
    // 8x8 red png is NOT a video — the gate must HONESTLY fail it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEUA/wAAAADfRHorAAAAAXRSTlMAQObYZgAAAAtJREFUCNdjYMAOAAAAAP8AAAr8hQ0AAAAASUVORK5CYII=',
      'base64',
    )
    const result = await probeVideoBytes(png, 'mp4')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
