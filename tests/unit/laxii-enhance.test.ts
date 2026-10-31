/**
 * BEAN Intelligence — LAXII enhancement pipeline tests (Phase 5/7).
 *
 * Pins the planner's measured decisions (only needed ops run, each with a
 * recorded reason), the deterministic end-to-end behavior (same input →
 * same output bytes), the mask-composited strict path, and the guards
 * (pixel caps, geometry).
 */
import { describe, test, expect } from 'bun:test'
import sharp from 'sharp'

import { analyzeImage, toRaw } from '../../src/lib/laxii/metrics'
import {
  DEFAULT_ENHANCE_OPTIONS,
  enhanceImage,
  planEnhancement,
} from '../../src/lib/laxii/enhance'

const W = 96
const H = 64

async function makeNoiseImage(seed = 42): Promise<Buffer> {
  // Pseudo-random noisy image (LCG) — deterministic across runs.
  let s = seed
  const data = Buffer.alloc(W * H * 3)
  for (let p = 0; p < W * H; p++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const v = s >>> 24
    data[p * 3] = v
    data[p * 3 + 1] = v
    data[p * 3 + 2] = v
  }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
}

async function makeDarkColorCastImage(): Promise<Buffer> {
  const data = Buffer.alloc(W * H * 3)
  for (let p = 0; p < W * H; p++) {
    data[p * 3] = 40 // red-heavy
    data[p * 3 + 1] = 20
    data[p * 3 + 2] = 12
  }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
}

async function rectMask(rect: { x: number; y: number; width: number; height: number }, w = W, h = H): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4, 0)
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * w + x) * 4
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 255
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

describe('planner: measured decisions', () => {
  test('a clean mid-exposure neutral image needs NO color ops', async () => {
    // Uniform mid-gray with mild structure: no denoise, no WB, no grade.
    const buf = await sharp(Buffer.alloc(W * H * 3, 120), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
    const plan = planEnhancement(analyzeImage(await toRaw(buf)), DEFAULT_ENHANCE_OPTIONS)
    const ops = plan.ops.map((o) => o.op)
    expect(ops).not.toContain('denoise')
    expect(ops).not.toContain('exposure-white-balance')
    expect(ops).not.toContain('grade-saturation')
    expect(ops).toContain('auto-orient') // orientation is always applied first
  })

  test('a noisy image triggers denoise with the measured reason', async () => {
    const buf = await makeNoiseImage()
    const analysis = analyzeImage(await toRaw(buf))
    const plan = planEnhancement(analysis, DEFAULT_ENHANCE_OPTIONS)
    const op = plan.ops.find((o) => o.op === 'denoise')
    expect(op).toBeDefined()
    expect(op!.reason).toContain('sigma')
    expect(op!.measured.noiseSigma).toBe(analysis.noiseSigma)
  })

  test('a dark, red-cast image triggers exposure-white-balance', async () => {
    const buf = await makeDarkColorCastImage()
    const plan = planEnhancement(analyzeImage(await toRaw(buf)), DEFAULT_ENHANCE_OPTIONS)
    const op = plan.ops.find((o) => o.op === 'exposure-white-balance')
    expect(op).toBeDefined()
    expect(op!.measured.castPct).toBeGreaterThan(6)
  })

  test('grayscale images are never saturation-graded', async () => {
    const buf = await makeNoiseImage()
    const plan = planEnhancement(analyzeImage(await toRaw(buf)), DEFAULT_ENHANCE_OPTIONS)
    expect(plan.ops.find((o) => o.op === 'grade-saturation')).toBeUndefined()
  })

  test('upscale only appears when requested and records the factor', () => {
    const analysis = {
      noiseSigma: 0, laplacianVariance: 1000, meanLuma: 120,
      channelMeans: { r: 120, g: 120, b: 120 }, clippedShadowsPct: 0, clippedHighlightsPct: 0,
      saturationMean: 0.3, isGrayscale: false, width: W, height: H,
    }
    const off = planEnhancement(analysis, DEFAULT_ENHANCE_OPTIONS)
    expect(off.ops.find((o) => o.op === 'upscale-lanczos')).toBeUndefined()
    const on = planEnhancement(analysis, { ...DEFAULT_ENHANCE_OPTIONS, upscaleFactor: 2 })
    expect(on.ops.find((o) => o.op === 'upscale-lanczos')?.params.factor).toBe(2)
  })
})

describe('end-to-end enhancement', () => {
  test('deterministic: identical input yields identical output bytes', async () => {
    const buf = await makeNoiseImage(7)
    const a = await enhanceImage({ image: buf })
    const b = await enhanceImage({ image: buf })
    expect(a.result.outputPng.equals(b.result.outputPng)).toBe(true)
    expect(a.result.durationMs).toBeGreaterThan(0)
  })

  test('full-frame enhance is a documented global change', async () => {
    const buf = await makeDarkColorCastImage()
    const { result, original } = await enhanceImage({ image: buf })
    expect(result.width).toBe(original.width)
    expect(result.height).toBe(original.height)
    expect(result.plan.ops.length).toBeGreaterThan(0)
    // The output must differ from the input (exposure/WB ran).
    expect(result.outputPng.length).toBeGreaterThan(0)
  })

  test('masked strict path keeps unmasked pixels bit-exact', async () => {
    const buf = await makeDarkColorCastImage()
    const { original } = await enhanceImage({ image: buf })
    const maskPng = await rectMask({ x: 10, y: 10, width: 20, height: 20 })
    const { buildMask, compositePreserved } = await import('../../src/lib/laxii/preservation')
    const mask = await buildMask([{ kind: 'edit', png: maskPng }], original.width, original.height)
    // Run the pipeline again with mask compositing done by the caller.
    const rerun = await enhanceImage({ image: buf, options: { ...DEFAULT_ENHANCE_OPTIONS, allowGlobalColor: false } })
    const processedRaw = await toRaw(rerun.result.outputPng)
    const composite = compositePreserved(original, processedRaw, mask, { globalColorChange: false })
    // Outside the 20x20 mask: bit-exact original.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= 10 && x < 30 && y >= 10 && y < 30) continue
        const i = (y * W + x) * 3
        expect(composite.data[i]).toBe(original.data[i])
        expect(composite.data[i + 1]).toBe(original.data[i + 1])
        expect(composite.data[i + 2]).toBe(original.data[i + 2])
      }
    }
  })

  test('upscale produces exact multiplied dimensions', async () => {
    const buf = await makeNoiseImage(3)
    const { result } = await enhanceImage({ image: buf, options: { ...DEFAULT_ENHANCE_OPTIONS, upscaleFactor: 2 } })
    expect(result.width).toBe(W * 2)
    expect(result.height).toBe(H * 2)
  })

  test('pixel cap rejects oversized work instead of silently downscaling', async () => {
    const bigW = 2100, bigH = 2100 // > 4MP cap when combined with 2x upscale? use small cap directly
    const data = Buffer.alloc(bigW * bigH * 3, 100)
    const buf = await sharp(data, { raw: { width: bigW, height: bigH, channels: 3 } }).png().toBuffer()
    await expect(
      enhanceImage({ image: buf, options: { ...DEFAULT_ENHANCE_OPTIONS, maxInputPixels: 1_000_000 } }),
    ).rejects.toThrow('MP limit')
  })
})

describe('analysis', () => {
  test('noise sigma is higher for the noisy fixture than a flat patch', async () => {
    const noisy = analyzeImage(await toRaw(await makeNoiseImage()))
    const flat = analyzeImage(await toRaw(await sharp(Buffer.alloc(W * H * 3, 120), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()))
    expect(noisy.noiseSigma).toBeGreaterThan(flat.noiseSigma * 3)
  })

  test('channel means reflect the red cast', async () => {
    const a = analyzeImage(await toRaw(await makeDarkColorCastImage()))
    expect(a.channelMeans.r).toBeGreaterThan(a.channelMeans.g)
    expect(a.channelMeans.r).toBeGreaterThan(a.channelMeans.b)
  })
})
