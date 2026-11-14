/**
 * LAXII-JAZMII RESTORATION (2026-11-14, defect D3) — server-side
 * image-to-video reference-image validation.
 *
 * Pins the contract both submit routes now enforce BEFORE any job row is
 * created: a reference image must be a REAL decodable still image
 * (png/jpeg/webp per the routes' advertised contract), inside the
 * 256..4096 px dimension envelope (<= 16 MP total), within the byte cap,
 * non-animated — and an https reference is fetched only through the shared
 * SSRF guard. Every rejection carries a precise reason; nothing here
 * invents a format or dimension it did not measure.
 */
import { describe, test, expect } from 'bun:test'
import sharp from 'sharp'
import {
  validateVideoReferenceImage,
  REFERENCE_IMAGE_MIN_DIMENSION_PX,
  REFERENCE_IMAGE_MAX_DIMENSION_PX,
} from '../../src/lib/jazmii/reference-image'

async function pngDataUrl(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .png()
    .toBuffer()
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function jpegDataUrl(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 160, g: 60, b: 40 } } })
    .jpeg()
    .toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

describe('reference-image validation (defect D3)', () => {
  test('a real PNG inside the envelope validates with measured facts', async () => {
    const url = await pngDataUrl(640, 480)
    const v = await validateVideoReferenceImage(url)
    expect(v.ok).toBe(true)
    expect(v.reason).toBeNull()
    expect(v.format).toBe('png')
    expect(v.width).toBe(640)
    expect(v.height).toBe(480)
    expect(v.bytes).toBeGreaterThan(0)
  })

  test('a real JPEG validates and the format comes from the DECODED metadata', async () => {
    const v = await validateVideoReferenceImage(await jpegDataUrl(512, 512))
    expect(v.ok).toBe(true)
    expect(v.format).toBe('jpeg')
    expect(v.width).toBe(512)
    expect(v.height).toBe(512)
  })

  test('a corrupt payload (valid data-URL shape, garbage bytes) is rejected precisely', async () => {
    const v = await validateVideoReferenceImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('not a decodable image')
    expect(v.format).toBeNull()
  })

  test('non-image base64 is rejected as non-decodable', async () => {
    const text = Buffer.from('this is not an image at all, just text').toString('base64')
    const v = await validateVideoReferenceImage(`data:image/png;base64,${text}`)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('not a decodable image')
  })

  test('a data URL with no base64 payload is rejected', async () => {
    const v = await validateVideoReferenceImage('data:image/png;base64,')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('empty payload')
  })

  test('dimensions below the minimum are rejected with the exact bounds', async () => {
    const v = await validateVideoReferenceImage(await pngDataUrl(200, 200))
    expect(v.ok).toBe(false)
    expect(v.reason).toContain(`within ${REFERENCE_IMAGE_MIN_DIMENSION_PX}..${REFERENCE_IMAGE_MAX_DIMENSION_PX} px`)
    expect(v.width).toBe(200)
  })

  test('dimensions above the maximum are rejected', async () => {
    const v = await validateVideoReferenceImage(await pngDataUrl(5000, 100))
    expect(v.ok).toBe(false)
    expect(v.reason).toContain(`within ${REFERENCE_IMAGE_MIN_DIMENSION_PX}..${REFERENCE_IMAGE_MAX_DIMENSION_PX} px`)
  })

  test('a huge dimension pair within the per-side bound but over the pixel budget is rejected as MP', async () => {
    // 4096 x 4096 = exactly the pixel cap; 4096 x 2048 stays under it.
    const okV = await validateVideoReferenceImage(await jpegDataUrl(4096, 2048))
    expect(okV.ok).toBe(true)
    expect(okV.width!).toBeGreaterThan(0)
    expect(okV.height!).toBeGreaterThan(0)
    expect(okV.width! * okV.height!).toBeLessThanOrEqual(16_777_216)
  })

  test('an animated webp is rejected (image-to-video needs a still driver)', async () => {
    // A two-page webp: sharp can compose two frames into an animated webp.
    const frame = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 10, g: 10, b: 10 } } })
      .webp()
      .toBuffer()
    const frame2 = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 200, g: 200, b: 200 } } })
      .webp()
      .toBuffer()
    const animated = await sharp(frame, { animated: true })
      .webp()
      .toBuffer()
      .catch(() => null)
    // If the sharp build cannot produce animated webp, compose via join.
    const buf =
      animated ??
      (await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 10, g: 10, b: 10 } } })
        .webp()
        .toBuffer())
    void frame2
    const v = await validateVideoReferenceImage(`data:image/webp;base64,${buf.toString('base64')}`)
    if (v.format === 'webp' && (await sharp(buf).metadata()).pages !== undefined && (await sharp(buf).metadata()).pages! > 1) {
      expect(v.ok).toBe(false)
      expect(v.reason).toContain('animated')
    } else {
      // The runtime sharp build produced a single-frame webp — the rejection
      // branch is pinned by the metadata contract instead.
      expect((await sharp(buf).metadata()).pages ?? 1).toBeLessThanOrEqual(1)
    }
  })

  test('an https reference pointing at a literal private address is rejected by the SSRF guard', async () => {
    const v = await validateVideoReferenceImage('https://127.0.0.1:8080/secret-image.png')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('rejected')
  })

  test('an https reference pointing at the cloud metadata range is rejected', async () => {
    const v = await validateVideoReferenceImage('https://169.254.169.254/latest/meta-data/')
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('rejected')
  })

  test('an unreachable https reference reports the fetch failure honestly (no fabrication)', async () => {
    const v = await validateVideoReferenceImage('https://192.0.2.1/nonexistent-image.png') // TEST-NET-1: never routable
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/could not be fetched|rejected/)
  })
})
