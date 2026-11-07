/**
 * BEAN Intelligence — LAXII preservation engine tests (Phase 7).
 *
 * Pins the CORE product guarantee with REAL pixel measurements:
 *  - unmasked pixels in a composited result are BIT-EXACT original bytes;
 *  - feathering produces an honest blend band (counted separately, never
 *    silently folded into "preserved");
 *  - face protection geometrically suppresses edit strokes;
 *  - masks with wrong geometry are REJECTED, never silently rescaled;
 *  - validation reports are computed from actual buffers (a tampered
 *    protected region is detected).
 * All fixtures are synthetic PNGs built with Sharp — no ML, no network.
 */
import { deflateSync } from 'node:zlib'
import { describe, test, expect } from 'bun:test'
import sharp from 'sharp'

import { LaxiiImageError, toRaw } from '../../src/lib/laxii/metrics'
import {
  applyFaceProtection,
  buildMask,
  compositePreserved,
  dilateMask,
  erodeMask,
  featherMask,
  shapeMask,
  validatePreservation,
  type FaceZone,
} from '../../src/lib/laxii/preservation'

const W = 64
const H = 48

async function gradientImage(): Promise<{ buf: Buffer; raw: Awaited<ReturnType<typeof toRaw>> }> {
  const data = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      data[i] = Math.round((x / (W - 1)) * 255)
      data[i + 1] = Math.round((y / (H - 1)) * 255)
      data[i + 2] = 128
    }
  }
  const buf = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
  return { buf, raw: await toRaw(buf) }
}

/** Rectangular white stroke on transparent background — encoded exactly the
 *  way the browser mask editor exports it (RGBA PNG, alpha = coverage). */
async function rectMask(rect: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const px = Buffer.alloc(W * H * 4, 0)
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * W + x) * 4
      px[i] = 255
      px[i + 1] = 255
      px[i + 2] = 255
      px[i + 3] = 255
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
}

async function uniformImage(v: number): Promise<Buffer> {
  return sharp(Buffer.alloc(W * H * 3, v), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
}

/** Minimal grayscale PNG encoder (IHDR color type 0) — sharp re-encodes raw
 *  data with alpha, so a TRUE grayscale fixture must be assembled by hand. */
function grayscalePng(w: number, h: number, draw: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = draw(x, y)
  }
  const idat = deflateSync(raw, { level: 9 })
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    let crc = 0xffffffff
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    crc = (crc ^ 0xffffffff) >>> 0
    const crcB = Buffer.alloc(4)
    crcB.writeUInt32BE(crc)
    return Buffer.concat([len, td, crcB])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('mask building and geometry', () => {
  test('positive strokes produce alpha 1 inside, 0 outside', async () => {
    const png = await rectMask({ x: 10, y: 10, width: 20, height: 10 })
    const mask = await buildMask([{ kind: 'edit', png }], W, H)
    expect(mask.alpha[12 * W + 12]).toBe(1) // inside
    expect(mask.alpha[2 * W + 2]).toBe(0) // outside
    expect(mask.alpha[12 * W + 9]).toBe(0) // just left of the rect
  })

  test('a protect stroke cancels an overlapping edit stroke (negative mask)', async () => {
    const png = await rectMask({ x: 10, y: 10, width: 20, height: 10 })
    const mask = await buildMask(
      [
        { kind: 'edit', png },
        { kind: 'protect', png },
      ],
      W,
      H,
    )
    expect(mask.alpha[12 * W + 12]).toBe(0)
  })

  test('grayscale masks (PNG color type 0 → 3-channel after sharp raw decode) use LUMINANCE as coverage — regression: they previously marked EVERY pixel editable', async () => {
    // Hand-built grayscale PNG (IHDR color type 0): sharp's raw decoder
    // expands it to 3 channels, so this exercises the exact production path
    // that used to return full coverage for every pixel.
    const W2 = 64
    const H2 = 64
    const gray = grayscalePng(W2, H2, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? 255 : 0))
    const mask = await buildMask([{ kind: 'edit', png: gray }], W2, H2)
    expect(mask.alpha[15 * W2 + 15]).toBe(1) // inside the painted region
    expect(mask.alpha[2 * W2 + 2]).toBe(0) // outside — must stay PROTECTED
    expect(mask.alpha[40 * W2 + 40]).toBe(0) // far outside — must stay PROTECTED
  })

  test('masks with wrong geometry are rejected — never silently rescaled', async () => {
    const wrong = await sharp(Buffer.alloc(32 * 32, 255), { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer()
    await expect(buildMask([{ kind: 'edit', png: wrong }], W, H)).rejects.toBeInstanceOf(LaxiiImageError)
  })

  test('empty stroke list is an error', async () => {
    await expect(buildMask([], W, H)).rejects.toBeInstanceOf(LaxiiImageError)
  })
})

describe('mask shaping', () => {
  test('dilation grows the editable region by ~radius', async () => {
    const png = await rectMask({ x: 20, y: 20, width: 10, height: 10 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const grown = dilateMask(base, 3)
    // A pixel 2px left of the rect edge becomes editable.
    expect(base.alpha[24 * W + 18]).toBe(0)
    expect(grown.alpha[24 * W + 18]).toBe(1)
    // Far-away pixel stays untouched.
    expect(grown.alpha[2 * W + 2]).toBe(0)
  })

  test('erosion shrinks the editable region', async () => {
    const png = await rectMask({ x: 20, y: 20, width: 10, height: 10 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const shrunk = erodeMask(base, 2)
    expect(base.alpha[24 * W + 21]).toBe(1)
    expect(shrunk.alpha[24 * W + 21]).toBe(0)
    expect(shrunk.alpha[24 * W + 25]).toBe(1)
  })

  test('feathering creates an intermediate band (0 < alpha < 1)', async () => {
    const png = await rectMask({ x: 20, y: 20, width: 20, height: 20 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const soft = featherMask(base, 3)
    // Center stays fully editable; the original edge becomes partial.
    expect(soft.alpha[29 * W + 29]).toBeGreaterThan(0.9)
    const edge = soft.alpha[20 * W + 29]
    expect(edge).toBeGreaterThan(0.1)
    expect(edge).toBeLessThan(0.9)
  })

  test('shapeMask composes expand then feather', async () => {
    const png = await rectMask({ x: 20, y: 20, width: 10, height: 10 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const shaped = shapeMask(base, { expandPx: 2, featherPx: 2 })
    expect(shaped.alpha[24 * W + 17]).toBeGreaterThan(0) // expansion made it editable
  })
})

describe('face protection (hard geometric gate)', () => {
  test('edit strokes inside a protected zone are suppressed; outside survive', async () => {
    const png = await rectMask({ x: 0, y: 0, width: 40, height: 40 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const zones: FaceZone[] = [{ rect: { x: 10, y: 10, width: 12, height: 12 }, source: 'user' }]
    const { mask, suppressedPct } = applyFaceProtection(base, zones, 0)
    expect(mask.alpha[15 * W + 15]).toBe(0) // inside face zone → protected
    expect(mask.alpha[30 * W + 30]).toBe(1) // outside → editable
    expect(suppressedPct).toBeGreaterThan(0)
  })

  test('protection with feathering does not eat into the protected zone itself', async () => {
    const png = await rectMask({ x: 0, y: 0, width: 60, height: 60 })
    const base = await buildMask([{ kind: 'edit', png }], W, H)
    const zones: FaceZone[] = [{ rect: { x: 20, y: 20, width: 10, height: 10 }, source: 'face-auto' }]
    const { mask } = applyFaceProtection(base, zones, 3)
    // Deep inside the zone: fully protected even with feather boundary.
    expect(mask.alpha[24 * W + 24]).toBe(0)
  })
})

describe('compositing (the exact-pixel guarantee)', () => {
  test('unmasked pixels are BIT-EXACT original bytes; masked pixels take processed values', async () => {
    const original = await gradientImage()
    const processed = await toRaw(await uniformImage(200))
    const png = await rectMask({ x: 8, y: 8, width: 16, height: 16 })
    const mask = await buildMask([{ kind: 'edit', png }], W, H)
    const result = compositePreserved(original.raw, processed, mask, { globalColorChange: false })
    for (let p = 0; p < W * H; p++) {
      const i = p * 3
      if (mask.alpha[p] === 0) {
        expect(result.data[i]).toBe(original.raw.data[i])
        expect(result.data[i + 1]).toBe(original.raw.data[i + 1])
        expect(result.data[i + 2]).toBe(original.raw.data[i + 2])
      } else if (mask.alpha[p] === 1) {
        expect(result.data[i]).toBe(200)
      }
    }
    const exactExpected = ((W * H - 16 * 16) / (W * H)) * 100
    expect(result.exactPreservedPct).toBeCloseTo(exactExpected, 5)
  })

  test('feather band pixels are counted as blended, not preserved', async () => {
    const original = await gradientImage()
    const processed = await toRaw(await uniformImage(250))
    const png = await rectMask({ x: 24, y: 18, width: 16, height: 16 })
    const soft = shapeMask(await buildMask([{ kind: 'edit', png }], W, H), { expandPx: 0, featherPx: 3 })
    const result = compositePreserved(original.raw, processed, soft, { globalColorChange: false })
    expect(result.blendedPct).toBeGreaterThan(0)
    expect(result.generatedPct).toBeLessThan((16 * 16) / (W * H) * 100)
  })

  test('processed geometry mismatch is a hard error', async () => {
    const original = await gradientImage()
    const other = await toRaw(await sharp(Buffer.alloc(32 * 32 * 3, 9), { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer())
    const png = await rectMask({ x: 0, y: 0, width: 4, height: 4 })
    const mask = await buildMask([{ kind: 'edit', png }], W, H)
    expect(() => compositePreserved(original.raw, other, mask)).toThrow(LaxiiImageError)
  })
})

describe('validation report (measured, not asserted)', () => {
  test('identical output reports 100% exact preservation and 0% changed', async () => {
    const img = await gradientImage()
    const report = validatePreservation({
      original: img.raw,
      output: { data: new Uint8Array(img.raw.data), width: W, height: H },
      mask: null,
      faceZones: [],
      generativeUsed: false,
      pipeline: 'test',
    })
    expect(report.exactPreservedPct).toBe(100)
    expect(report.changedPct).toBe(0)
    expect(report.dimensionsChanged).toBe(false)
    expect(report.generativeUsed).toBe(false)
    expect(report.summary).toContain('bit-exact')
  })

  test('a changed protected region is DETECTED and warned in the summary', async () => {
    const img = await gradientImage()
    const out = new Uint8Array(img.raw.data)
    // Tamper inside the protected face zone.
    const fi = (20 * W + 20) * 3
    out[fi] = (out[fi] + 120) % 256
    const zones: FaceZone[] = [{ rect: { x: 16, y: 16, width: 10, height: 10 }, source: 'face-user' }]
    const report = validatePreservation({
      original: img.raw,
      output: { data: out, width: W, height: H },
      mask: null,
      faceZones: zones,
      generativeUsed: true,
      pipeline: 'test',
    })
    expect(report.protectedRegions[0].changed).toBe(true)
    expect(report.summary).toContain('WARNING')
    expect(report.generativeUsed).toBe(true)
  })

  test('changed-pixel percentage matches a known tamper pattern', async () => {
    const img = await gradientImage()
    const out = new Uint8Array(img.raw.data)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) out[(y * W + x) * 3] = 255
    }
    const report = validatePreservation({
      original: img.raw,
      output: { data: out, width: W, height: H },
      mask: null,
      faceZones: [],
      generativeUsed: false,
      pipeline: 'test',
    })
    // Gradient top-left corner values differ from 255 by >2 everywhere in the block.
    expect(report.changedPct).toBeCloseTo((100 / (W * H)) * 100, 5)
  })

  test('dimension change is reported and zeroes the pixel percentages', async () => {
    const img = await gradientImage()
    const report = validatePreservation({
      original: img.raw,
      output: { data: new Uint8Array(16 * 16 * 3), width: 16, height: 16 },
      mask: null,
      faceZones: [],
      generativeUsed: false,
      pipeline: 'test',
    })
    expect(report.dimensionsChanged).toBe(true)
    expect(report.exactPreservedPct).toBe(0)
    expect(report.changedPct).toBe(100)
  })
})
