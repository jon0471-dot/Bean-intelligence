/**
 * M26.3 — pure-function pins for the LAXII output-quality work:
 *   - exact-dimension planning for 1920x1080 (16:9) and the provider-mismatch
 *     finish path (square 1312x1312 actual output → 16:9 target);
 *   - aspect ratio labels reduced from final dimensions;
 *   - style-aware conditioning (exclusions always for LAXII; realism only
 *     when photoreal cues exist and no artistic style is declared);
 *   - unwanted-text defect classification (unwanted marks vs demanded text).
 */
import { describe, test, expect } from 'bun:test'
import {
  planExactDimensions,
  planFinishStrategy,
  aspectRatioLabel,
  isValidProviderSize,
  NATIVE_SIZES,
} from '../../src/lib/laxii/dimensions'
import { laxiiStyleConditioning, compileConditioning } from '../../src/lib/intel/grounding'
import { understandPrompt } from '../../src/lib/intel/understanding'
import { unwantedTextDefects } from '../../src/lib/intel/continuity'

describe('M26.3 — exact dimensions and finish planning', () => {
  test('1920x1080 plans the EXACT 16:9 native (2048x1152) — pure resize, zero composition loss', () => {
    const plan = planExactDimensions(1920, 1080)
    expect([plan.generateWidth, plan.generateHeight]).toEqual([2048, 1152])
    expect(plan.strategy.kind).toBe('resize')
  })

  test('every planned native satisfies the MEASURED provider size contract', () => {
    for (const n of NATIVE_SIZES) {
      expect(isValidProviderSize(n.width, n.height)).toBe(true)
    }
    // the two sizes the old list carried violate the contract (720 not /32-aligned)
    expect(isValidProviderSize(1440, 720)).toBe(false)
    expect(isValidProviderSize(720, 1440)).toBe(false)
  })

  test('a square provider default (1312x1312) finishes to 16:9 via pad-extend — never stretched', () => {
    const strategy = planFinishStrategy({ width: 1312, height: 1312 }, { width: 1920, height: 1080 })
    // covering 16:9 from a square discards 43.75% of the frame — far beyond
    // the crop bound, so the honest route is the blurred edge-derived padding
    expect(strategy.kind).toBe('pad-extend')
    if (strategy.kind === 'pad-extend') expect(strategy.padPct).toBeGreaterThan(40)
  })

  test('same-aspect provider output finishes with a pure resize (no crop, no pad)', () => {
    const strategy = planFinishStrategy({ width: 1024, height: 1024 }, { width: 2048, height: 2048 })
    expect(strategy.kind).toBe('resize')
  })

  test('aspect labels are reduced fractions of the FINAL dimensions', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(aspectRatioLabel(1344, 768)).toBe('7:4')
    expect(aspectRatioLabel(1024, 1024)).toBe('1:1')
  })
})

describe('M26.3 — style-aware prompt conditioning', () => {
  test('cinematic/photoreal prompts get the realism block', () => {
    const s = laxiiStyleConditioning('a lone lighthouse on a rocky cliff at dusk, cinematic, photorealistic')
    expect(s).not.toBeNull()
    expect(s).toContain('cinematic film still')
    expect(s).toContain('no illustration, anime or painterly concept-art look')
  })

  test('a declared artistic style is respected — no photoreal flattening', () => {
    expect(laxiiStyleConditioning('an anime girl on a rooftop at sunset, cinematic lighting')).toBeNull()
    expect(laxiiStyleConditioning('an oil painting of a harbor, dramatic light')).toBeNull()
  })

  test('no photoreal cues — no style block is added', () => {
    expect(laxiiStyleConditioning('a red rubber duck')).toBeNull()
  })

  test('LAXII conditioning always carries the anti-text exclusions (watermark origin control)', () => {
    const u = understandPrompt('a lone lighthouse on a rocky cliff at dusk, cinematic, photorealistic', 'laxii')
    const conditioning = compileConditioning(u, [], [], 'laxii')
    expect(conditioning).toContain('no watermarks')
    expect(conditioning).toContain('no logos')
    expect(conditioning).toContain('no wordmarks')
  })
})

describe('M26.3 — unwanted-text defect classification', () => {
  test('an unwanted brand-like wordmark is flagged', () => {
    const defects = unwantedTextDefects([
      'unwanted IMAX-like wordmark embedded in the bottom-right corner',
      'shadow direction is consistent',
    ])
    expect(defects.length).toBe(1)
    expect(defects[0]).toContain('wordmark')
  })

  test('requested-text rendering issues are NOT classified as unwanted marks', () => {
    expect(unwantedTextDefects(['garbled lettering: the demanded exact wording was misspelled'])).toEqual([])
  })
})
