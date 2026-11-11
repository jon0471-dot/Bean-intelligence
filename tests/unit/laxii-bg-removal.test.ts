/**
 * LAXII background-removal cutout tests — deterministic stage (Phase 4).
 * Synthetic chroma-key frames pin the measured-key, feather and validation
 * behavior; the generative stage is exercised by the live acceptance run.
 */
import { describe, test, expect } from 'bun:test'
import { measureChromaKey, chromaCutout, validateCutout, type ChromaStats } from '../../src/lib/laxii/bg-removal'
import type { RawImage } from '../../src/lib/laxii/metrics'

/** Build an RGB frame: uniform key color + a centered opaque "subject". */
function frame(
  w: number,
  h: number,
  key: [number, number, number],
  subject: (x: number, y: number) => boolean,
  subjectColor: [number, number, number] = [200, 60, 30],
): RawImage {
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const c = subject(x, y) ? subjectColor : key
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
    }
  }
  return { data, width: w, height: h }
}

describe('measureChromaKey', () => {
  test('the border ring median recovers the uniform key color', () => {
    const img = frame(40, 40, [61, 184, 57], (x, y) => x > 12 && x < 28 && y > 12 && y < 28)
    const { key, spread } = measureChromaKey(img)
    expect(key).toEqual({ r: 61, g: 184, b: 57 })
    expect(spread).toBe(0)
  })
})

describe('chromaCutout', () => {
  test('background goes transparent, subject stays opaque', () => {
    const img = frame(40, 40, [61, 184, 57], (x, y) => x > 12 && x < 28 && y > 12 && y < 28, [200, 60, 30])
    const out = chromaCutout(img)
    // Corner pixel = background → alpha 0; center pixel = subject → alpha 255.
    const alphaAt = (x: number, y: number) => out.rgba[(y * out.width + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(20, 20)).toBe(255)
    expect(out.stats.transparentFraction).toBeGreaterThan(0.5)
    expect(out.stats.opaqueFraction).toBeGreaterThan(0.1)
    expect(validateCutout(out.stats)).toBeNull()
  })

  test('a feathered edge produces intermediate alpha (smoothstep, no hard stair)', () => {
    // Key on the left half, subject gradient on the right half: the column
    // at the boundary must contain intermediate alphas. The border ring rows
    // stay pure key color (like a real keyed frame) so the measured key is
    // not polluted by the graded edge.
    const w = 60
    const h = 10
    const data = new Uint8Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const ringRow = y < 2 || y >= h - 2
        if (x < 25 || ringRow) {
          data[i] = 61
          data[i + 1] = 184
          data[i + 2] = 57
        } else {
          // Approaching the key color from the subject side (graded edge).
          const t = Math.min(1, (x - 25) / 10)
          data[i] = Math.round(61 + t * 139)
          data[i + 1] = Math.round(184 - t * 124)
          data[i + 2] = Math.round(57 - t * 27)
        }
      }
    }
    const out = chromaCutout({ data, width: w, height: h })
    const alphas: number[] = []
    for (let x = 24; x <= 38; x++) alphas.push(out.rgba[(5 * out.width + x) * 4 + 3])
    expect(Math.min(...alphas)).toBe(0)
    expect(Math.max(...alphas)).toBe(255)
    expect(new Set(alphas).size).toBeGreaterThan(2)
  })

  test('despill: a green subject edge does not halo', () => {
    // Subject pixels near the key that are themselves greenish must lose the
    // green cast on semi-transparent alpha values.
    const img = frame(
      30,
      30,
      [61, 184, 57],
      (x, y) => x > 10 && x < 20 && y > 10 && y < 20,
      [80, 150, 70], // greenish subject
    )
    const out = chromaCutout(img)
    // Find any semi-transparent pixel and check despill applied.
    let checked = 0
    for (let p = 0; p < 30 * 30; p++) {
      const a = out.rgba[p * 4 + 3]
      if (a > 0 && a < 255) {
        const r = out.rgba[p * 4]
        const g = out.rgba[p * 4 + 1]
        const b = out.rgba[p * 4 + 2]
        expect(g).toBeLessThanOrEqual(Math.max(r, b) + 8)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('validateCutout honesty gates', () => {
  const stats = (over: Partial<ChromaStats>): ChromaStats => ({
    key: { r: 61, g: 184, b: 57 },
    keySpread: 3,
    inner: 24,
    outer: 56,
    transparentFraction: 0.6,
    opaqueFraction: 0.3,
    ...over,
  })

  test('all-opaque result is rejected (no separation)', () => {
    expect(validateCutout(stats({ transparentFraction: 0, opaqueFraction: 1 }))).toMatch(/no meaningful background separation/)
  })
  test('all-transparent result is rejected (no subject)', () => {
    expect(validateCutout(stats({ transparentFraction: 0.999, opaqueFraction: 0 }))).toMatch(/no subject/)
  })
  test('a non-uniform generated background is rejected', () => {
    expect(validateCutout(stats({ keySpread: 200 }))).toMatch(/not uniform enough/)
  })
  test('a healthy measurement passes', () => {
    expect(validateCutout(stats({}))).toBeNull()
  })
})
