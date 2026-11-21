/**
 * GANGZII M28 — dynamic narration ducking tests.
 *
 * Pure-logic coverage (determinism, merging, clamps, curve shapes, nested-if
 * priority) PLUS a real ffmpeg render verification: the generated automation
 * expression is applied to a real sine bed, and the MEASURED output levels
 * inside/outside narration windows must match the intended curve within
 * tolerance — a file's existence alone is never proof of ducking.
 */
import { describe, test, expect } from 'bun:test'
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import {
  buildDynamicDuckPlan,
  duckPlanToVolumeFilter,
  normalizeDuckRegions,
  resolveDuckConfig,
  DUCK_DEFAULTS,
  DUCK_LIMITS,
  type DuckRegion,
} from '@/lib/gangzii/ducking'

const execFileP = promisify(execFile)

const REGIONS: DuckRegion[] = [
  { startSec: 3, endSec: 6 },
  { startSec: 8, endSec: 10 },
]

describe('buildDynamicDuckPlan — determinism and shape', () => {
  test('identical inputs produce byte-identical expressions and breakpoints', () => {
    const a = buildDynamicDuckPlan(REGIONS)
    const b = buildDynamicDuckPlan(REGIONS)
    expect(a.expression).toBe(b.expression)
    expect(a.breakpoints).toEqual(b.breakpoints)
  })

  test('default config matches the documented defaults', () => {
    const plan = buildDynamicDuckPlan(REGIONS)
    expect(plan.config).toEqual(DUCK_DEFAULTS)
    expect(plan.warnings).toHaveLength(0)
  })

  test('curve hits full level, duck plateau, and cosine mid-ramp values', () => {
    const plan = buildDynamicDuckPlan(REGIONS)
    const levels = new Map(plan.breakpoints.map((p) => [p.tSec, p.level]))
    // plateau
    expect(levels.get(3)).toBe(DUCK_DEFAULTS.duckTo)
    expect(levels.get(6)).toBe(DUCK_DEFAULTS.duckTo)
    // attack midpoint (3 - 0.075): cosine → halfway level
    expect(levels.get(2.925)).toBeCloseTo((1 + DUCK_DEFAULTS.duckTo) / 2, 2)
    // release midpoint (6 + 0.2)
    expect(levels.get(6.2)).toBeCloseTo((1 + DUCK_DEFAULTS.duckTo) / 2, 2)
    // release end returns to full
    expect(levels.get(6.4)).toBe(1)
  })

  test('expression is a safe single-line nested if with no quote characters', () => {
    const plan = buildDynamicDuckPlan(REGIONS)
    expect(plan.expression).not.toMatch(/['"\\\n]/)
    expect(plan.expression.startsWith('if(between(t,')).toBe(true)
    // exactly one fallback '1' at the deepest level
    expect(plan.expression).toContain(',1)')
  })
})

describe('region normalization and config clamps', () => {
  test('overlapping and touching regions merge (no pump between segments)', () => {
    const { regions, warnings } = normalizeDuckRegions([
      { startSec: 1, endSec: 4 },
      { startSec: 3.5, endSec: 6 },
      { startSec: 6, endSec: 8 },
    ])
    expect(regions).toEqual([{ startSec: 1, endSec: 8 }])
    expect(warnings).toHaveLength(0)
  })

  test('invalid regions are dropped with warnings, never silently kept', () => {
    const { regions, warnings } = normalizeDuckRegions([
      { startSec: -5, endSec: 2 }, // clamped to 0
      { startSec: 5, endSec: 5.02 }, // < 50 ms → dropped
      { startSec: Number.NaN, endSec: 9 }, // dropped
    ])
    expect(regions).toEqual([{ startSec: 0, endSec: 2 }])
    expect(warnings.length).toBe(2)
  })

  test('duckTo is clamped to the minimum music level and documented bounds', () => {
    expect(resolveDuckConfig({ duckTo: 0.01 }).duckTo).toBe(0.05)
    expect(resolveDuckConfig({ duckTo: 2 }).duckTo).toBe(DUCK_LIMITS.duckTo.max)
    expect(resolveDuckConfig({ attackMs: 9999 }).attackMs).toBe(DUCK_LIMITS.attackMs.max)
  })

  test('more regions than the cap is a validation error, not silent truncation', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ startSec: i * 2, endSec: i * 2 + 1 }))
    expect(() => normalizeDuckRegions(many)).toThrow(/VALIDATION_ERROR/)
  })
})

// ---- real ffmpeg verification -------------------------------------------------------

async function ffmpegP(args: string[]): Promise<string> {
  const res = await execFileP('ffmpeg', ['-nostats', '-hide_banner', ...args], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
  return res.stderr
}

async function windowRmsDb(file: string, start: number, end: number): Promise<{ rmsDb: number; maxDb: number }> {
  // Direct ffmpeg astats over the trimmed window — reliable and offline.
  const stderr = await ffmpegP([
    '-i', file,
    '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level`,
    '-f', 'null', '-',
  ])
  const rms = stderr.match(/RMS level dB:\s*(-?[\d.]+)/)
  const max = stderr.match(/Peak level dB:\s*(-?[\d.]+)/)
  return {
    rmsDb: rms ? Number(rms[1]) : Number.NaN,
    maxDb: max ? Number(max[1]) : Number.NaN,
  }
}

describe('real render verification (ffmpeg)', () => {
  test('measured output level follows the ducking curve inside and outside narration windows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bean-m28-duck-'))
    const src = path.join(dir, 'bed.wav')
    const out = path.join(dir, 'ducked.wav')

    // Real 12 s sine bed at 0.5 amplitude (≈ -6 dBFS peak).
    await ffmpegP(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', src])

    const plan = buildDynamicDuckPlan(REGIONS) // [3,6] + [8,10], attack 150 ms, release 400 ms, cosine, duckTo 0.35
    const filter = duckPlanToVolumeFilter(plan)
    expect(filter.startsWith('volume=volume=')).toBe(true)
    await ffmpegP(['-i', src, '-af', filter, '-c:a', 'pcm_s16le', out])

    const expectedDuckDb = 20 * Math.log10(DUCK_DEFAULTS.duckTo) // ≈ -9.12 dB

    // Full-level window (1.0–2.5 s, before any attack).
    const full = await windowRmsDb(out, 1.0, 2.5)
    expect(Number.isFinite(full.rmsDb)).toBe(true)

    // Plateau window (4.0–5.5 s, inside narration region 1).
    const plateau = await windowRmsDb(out, 4.0, 5.5)
    const duckDelta = plateau.rmsDb - full.rmsDb
    expect(Math.abs(duckDelta - expectedDuckDb)).toBeLessThan(0.8)

    // Recovered window (7.0–7.8 s, between regions, after release).
    const recovered = await windowRmsDb(out, 7.0, 7.8)
    expect(Math.abs(recovered.rmsDb - full.rmsDb)).toBeLessThan(0.4)

    // Second plateau (8.5–9.5 s) ducked again.
    const plateau2 = await windowRmsDb(out, 8.5, 9.5)
    expect(Math.abs(plateau2.rmsDb - full.rmsDb - expectedDuckDb)).toBeLessThan(0.8)

    // No unintended clipping.
    expect(full.maxDb).toBeLessThan(-0.1)

    fs.rmSync(dir, { recursive: true, force: true })
  }, 120_000)
})
