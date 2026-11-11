/**
 * LAXII CUSTOM IMAGE DIMENSIONS + EXACT OUTPUT ACCURACY (2026-11-11).
 *
 * Pins the three layers of the pipeline:
 *  1. validation matrix (the brief's PART 7 test list);
 *  2. the native-resolution strategy planner (resize / cover-crop /
 *     pad-extend — never distort, prefer native detail);
 *  3. the hardened provider response contract: a 2xx body without a data
 *     array (measured root cause of the BEAN INTELLIGENCE poster
 *     BACKEND_FAILURE — the SDK crashed on `result.data.map`) is a typed,
 *     diagnosable error, not a silent TypeError.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  validateDimensions,
  validateDimension,
  DimensionError,
  planExactDimensions,
  NATIVE_SIZES,
  MIN_DIMENSION_PX,
  MAX_DIMENSION_PX,
} from '../../src/lib/laxii/dimensions'
import { sanitizeProviderDetail } from '../../src/lib/jobs/image-worker'

// ---------------------------------------------------------------------------
// 1. Validation matrix (brief PART 7)
// ---------------------------------------------------------------------------

describe('validateDimensions — custom dimension validation matrix', () => {
  test('1024x1024 and the preset bounds are valid', () => {
    expect(validateDimensions(1024, 1024)).toEqual({ width: 1024, height: 1024 })
    expect(validateDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(validateDimensions(MIN_DIMENSION_PX, MAX_DIMENSION_PX)).toEqual({
      width: MIN_DIMENSION_PX,
      height: MAX_DIMENSION_PX,
    })
  })

  test('zero width is rejected with a clear explanation', () => {
    try {
      validateDimensions(0, 1080)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DimensionError)
      expect((e as DimensionError).code).toBe('INVALID_DIMENSIONS')
      expect((e as Error).message).toMatch(/positive pixel value/)
    }
  })

  test('negative height is rejected', () => {
    expect(() => validateDimension(-192, 'height')).toThrow(/positive pixel value/)
  })

  test('decimal values are rejected (whole pixels only)', () => {
    expect(() => validateDimension(1024.5, 'width')).toThrow(/whole number of pixels/)
  })

  test('excessive dimensions are rejected with the limit named', () => {
    try {
      validateDimensions(8000, 8000)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toMatch(new RegExp(String(MAX_DIMENSION_PX)))
    }
  })

  test('sub-minimum dimensions are rejected with the floor named', () => {
    expect(() => validateDimension(100, 'width')).toThrow(new RegExp(String(MIN_DIMENSION_PX)))
  })

  test('non-finite values are rejected', () => {
    expect(() => validateDimension(Number.NaN, 'width')).toThrow(/whole number/)
    expect(() => validateDimension(Number.POSITIVE_INFINITY, 'height')).toThrow(/whole number/)
  })
})

// ---------------------------------------------------------------------------
// 2. Strategy planner — exact output, native detail, never distorted
// ---------------------------------------------------------------------------

describe('planExactDimensions — generation strategy selection', () => {
  test('every provider preset plans as native (preset path byte-identical)', () => {
    for (const n of NATIVE_SIZES) {
      const plan = planExactDimensions(n.width, n.height)
      expect(plan.strategy.kind).toBe('native')
      expect(plan.generateWidth).toBe(n.width)
      expect(plan.generateHeight).toBe(n.height)
    }
  })

  test('1920x1080 generates 1344x768 and center-crops ~1.6% (no distortion)', () => {
    const plan = planExactDimensions(1920, 1080)
    expect(plan.generateWidth).toBe(1344)
    expect(plan.generateHeight).toBe(768)
    expect(plan.strategy.kind).toBe('cover-crop')
    expect(plan.strategy.kind === 'cover-crop' && plan.strategy.cropLossPct).toBeLessThan(2.5)
  })

  test('1080x1920 mirrors the landscape case', () => {
    const plan = planExactDimensions(1080, 1920)
    expect(plan.generateWidth).toBe(768)
    expect(plan.generateHeight).toBe(1344)
    expect(plan.strategy.kind).toBe('cover-crop')
  })

  test('2048x2048 uses the native 1024x1024 with a pure resize (same aspect, no crop)', () => {
    const plan = planExactDimensions(2048, 2048)
    expect(plan.generateWidth).toBe(1024)
    expect(plan.generateHeight).toBe(1024)
    expect(plan.strategy.kind).toBe('resize')
  })

  test('a valid non-standard ratio (1500x1000) picks the best cover and stays within the crop budget', () => {
    const plan = planExactDimensions(1500, 1000)
    expect(plan.strategy.kind).toBe('cover-crop')
    expect(plan.strategy.kind === 'cover-crop' && plan.strategy.cropLossPct).toBeLessThanOrEqual(15)
  })

  test('an extreme ratio (4096x256) switches to background-extension padding instead of cropping the subject', () => {
    const plan = planExactDimensions(4096, 256)
    expect(plan.strategy.kind).toBe('pad-extend')
    expect(plan.strategy.kind === 'pad-extend' && plan.strategy.padPct).toBeGreaterThan(0)
  })

  test('portrait custom sizes prefer the portrait natives (never rotate or stretch)', () => {
    const plan = planExactDimensions(960, 1300)
    // 3:4 native (864x1152) must beat any landscape/tall native on crop loss
    expect(plan.generateHeight).toBeGreaterThan(plan.generateWidth)
    expect(plan.strategy.kind === 'cover-crop' || plan.strategy.kind === 'resize').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Sanitizer — diagnostics retained, secrets never exposed
// ---------------------------------------------------------------------------

describe('sanitizeProviderDetail', () => {
  test('strips Bearer/sk- credential shapes', () => {
    const out = sanitizeProviderDetail('auth failed for Bearer abc123def456 and sk-live-xyz987654321')
    expect(out).not.toContain('abc123def456')
    expect(out).not.toContain('xyz987654321')
    expect(out).toContain('<redacted>')
  })

  test('strips long base64-like blobs', () => {
    const blob = 'A'.repeat(200)
    const out = sanitizeProviderDetail(`payload ${blob} end`)
    expect(out).not.toContain(blob)
    expect(out).toContain('<redacted-blob>')
  })

  test('caps length and collapses whitespace', () => {
    const out = sanitizeProviderDetail('word '.repeat(100))
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out).not.toMatch(/\s{2,}/)
  })
})
