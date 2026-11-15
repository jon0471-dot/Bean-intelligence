/**
 * BEAN Intelligence — client compute: pure, self-contained image kernels.
 *
 * CONTRACT: every exported kernel here is a SINGLE self-contained pure
 * function (no imports, no closure references, no DOM access) so it can be
 * serialized with `Function.prototype.toString` and executed inside a Web
 * Worker (see cpu/engine.ts). The adapter tests verify that a serialized
 * kernel behaves identically to the direct call — keep this file free of
 * helper imports or the worker lane breaks.
 *
 * The chroma-cutout kernel is a faithful client-side port of the deterministic
 * stage-2 math from the LAXII server pipeline (border-ring median chroma-key
 * measurement → smoothstep alpha feathering → green despill), which lives in
 * src/lib/laxii/bg-removal.ts. It is pure per-pixel math — no ML model.
 *
 * Client-safe: no Node-only imports, no DOM.
 */

export interface PixelPayload {
  /** RGBA8 pixels, length = width * height * 4. */
  pixels: Uint8ClampedArray
  width: number
  height: number
}

export interface PreprocessPayload extends PixelPayload {
  /** Fit within this box (never upscaled beyond 1.0x without request). */
  maxWidth: number
  maxHeight: number
  /** JPEG quality hint 0..1 (used at encode time by the adapter). */
  quality?: number
}

export interface PreprocessResult extends PixelPayload {
  originalWidth: number
  originalHeight: number
  scaleApplied: number
}

/**
 * Deterministic box+bilinear downscale. Never upscales (scale is capped at
 * 1). Self-contained for the worker lane.
 */
export function preprocessImageKernel(payload: PreprocessPayload): PreprocessResult {
  const { pixels, width, height } = payload
  if (!pixels || !(width > 0) || !(height > 0) || pixels.length !== width * height * 4) {
    throw new Error('invalid pixel payload')
  }
  const scaleX = Math.min(1, payload.maxWidth / width)
  const scaleY = Math.min(1, payload.maxHeight / height)
  const scale = Math.min(scaleX, scaleY)
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  if (scale >= 1) {
    return { pixels: new Uint8ClampedArray(pixels), width, height, originalWidth: width, originalHeight: height, scaleApplied: 1 }
  }
  const out = new Uint8ClampedArray(outW * outH * 4)
  // Bilinear resample: for each output pixel, map back to source coords.
  const xRatio = width / outW
  const yRatio = height / outH
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(width - 1, x0 + 1)
      const fx = sx - x0
      const o = (y * outW + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = pixels[(y0 * width + x0) * 4 + c]
        const p10 = pixels[(y0 * width + x1) * 4 + c]
        const p01 = pixels[(y1 * width + x0) * 4 + c]
        const p11 = pixels[(y1 * width + x1) * 4 + c]
        const top = p00 + (p10 - p00) * fx
        const bottom = p01 + (p11 - p01) * fx
        out[o + c] = top + (bottom - top) * fy
      }
    }
  }
  return { pixels: out, width: outW, height: outH, originalWidth: width, originalHeight: height, scaleApplied: scale }
}

export interface ChromaCutoutResult extends PixelPayload {
  /** Fraction of pixels that became fully transparent [0..1]. */
  transparentFraction: number
  /** Measured chroma key (H in degrees, S/L in 0..1) — honest diagnostics. */
  keyHue: number | null
  keySaturation: number | null
  keyLightness: number | null
  /** Sampled border-ring pixel count used for key measurement. */
  keySamples: number
}

/**
 * Deterministic chroma-key cutout (port of LAXII bg-removal stage 2).
 * Measures the key color from a border ring (median of hue/sat/lightness of
 * the outer 2% band), then applies a smoothstep alpha feather around the
 * measured key distance and desaturates green spill on semi-transparent
 * edges. Self-contained for the worker lane.
 */
export function chromaCutoutKernel(payload: PixelPayload): ChromaCutoutResult {
  const { width, height } = payload
  const pixels = new Uint8ClampedArray(payload.pixels)
  if (!pixels || !(width > 0) || !(height > 0) || pixels.length !== width * height * 4) {
    throw new Error('invalid pixel payload')
  }

  // --- RGB→HSL helper (inline; self-contained contract) ---
  const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    let h = 0
    let s = 0
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      else if (max === gn) h = ((bn - rn) / d + 2) * 60
      else h = ((rn - gn) / d + 4) * 60
    }
    return [h, s, l]
  }

  // --- Stage A: measure the chroma key from the border ring ---
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.02))
  const hues: number[] = []
  const sats: number[] = []
  const lights: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < band || y < band || x >= width - band || y >= height - band
      if (!isBorder) continue
      const i = (y * width + x) * 4
      if (pixels[i + 3] === 0) continue
      const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])
      hues.push(h)
      sats.push(s)
      lights.push(l)
    }
  }
  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const keyHue = median(hues)
  const keySaturation = median(sats)
  const keyLightness = median(lights)
  const keySamples = hues.length

  if (keyHue === null || keySaturation === null || keyLightness === null || keySamples < 8) {
    throw new Error('not enough border pixels to measure a chroma key')
  }

  // --- Stage B: smoothstep alpha around the key distance ---
  // Hue distance handles wrap-around; saturation/lightness use plain deltas.
  const hueDelta = (a: number, b: number): number => {
    let d = Math.abs(a - b) % 360
    if (d > 180) d = 360 - d
    return d
  }
  const HUE_BAND_DEG = 38
  const SAT_FLOOR = 0.12
  const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  let transparent = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])
      const hd = hueDelta(h, keyHue)
      const sd = Math.abs(s - keySaturation)
      const ld = Math.abs(l - keyLightness)
      // Distance to the key in a weighted chroma space.
      const dist = hd / HUE_BAND_DEG + sd / Math.max(SAT_FLOOR, keySaturation) * 0.5 + ld * 0.5
      // dist 0 = key color → transparent (alpha 0); dist >= 1 → opaque.
      const keep = smoothstep(0, 1, dist)
      const alpha = Math.round(keep * 255)
      const prevAlpha = pixels[i + 3]
      const newAlpha = Math.min(prevAlpha, alpha)
      if (newAlpha === 0) transparent += 1
      pixels[i + 3] = newAlpha
      // --- Stage C: despill on semi-transparent edge pixels ---
      if (newAlpha > 0 && newAlpha < 255 && pixels[i + 1] > pixels[i] && pixels[i + 1] > pixels[i + 2]) {
        const spill = (pixels[i + 1] - Math.max(pixels[i], pixels[i + 2])) * 0.5
        pixels[i + 1] = pixels[i + 1] - spill
      }
    }
  }

  return {
    pixels,
    width,
    height,
    transparentFraction: transparent / (width * height),
    keyHue,
    keySaturation,
    keyLightness,
    keySamples,
  }
}
