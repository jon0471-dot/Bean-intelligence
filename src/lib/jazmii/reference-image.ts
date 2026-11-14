import sharp from 'sharp'
import { assertPublicHttpUrl } from '@/lib/research/reach/url-safety'

/**
 * LAXII-JAZMII RESTORATION (2026-11-14, defect D3) — server-side validation
 * for the JAZMII image-to-video reference image.
 *
 * MEASURED DEFECT: both submit routes validated only the SHAPE of
 * `imageUrl` (https URL or data-URL regex + an 8,000,000-char bound) and
 * delegated everything else to the provider — a corrupt, oversized,
 * wrong-dimension or non-image payload was only discovered by the provider
 * AFTER accepting a real generation task, wasting a real submission and
 * polluting the capability evidence chain with a request-specific failure.
 *
 * What is checked here, BEFORE any job row is created:
 *  - bytes resolve at all: data URLs are base64-decoded with a hard byte
 *    cap; https URLs pass the shared SSRF guard (assertPublicHttpUrl —
 *    literal private/loopback/metadata rejection + DNS-resolution check,
 *    the same guard the research gateway uses) and are fetched with a
 *    timeout and a byte cap;
 *  - the payload DECODES as a real still image (sharp): the format is read
 *    from the decoded metadata, never trusted from headers or extensions;
 *  - format is one of jpeg/png/webp (the contract both routes advertise);
 *  - dimensions are inside 256..4096 px per side and <= 16,777,216 pixels
 *    total (the same 16 MP envelope the LAXII local pipeline enforces);
 *  - animated images are rejected (an animated reference is not a still
 *    driver frame — honest rejection instead of a provider-side surprise).
 *
 * Honesty rules: every rejection carries a precise, human-readable reason;
 * nothing here fabricates dimensions or formats it did not measure; the
 * original `imageUrl` string is NEVER modified — the provider still receives
 * the exact reference the client sent (this module validates, it does not
 * substitute).
 */

export const REFERENCE_IMAGE_MIN_DIMENSION_PX = 256
export const REFERENCE_IMAGE_MAX_DIMENSION_PX = 4096
export const REFERENCE_IMAGE_MAX_PIXELS = 16_777_216 // 4096^2 — same 16 MP envelope as LAXII local enhancement
export const REFERENCE_IMAGE_MAX_BYTES = 15 * 1024 * 1024 // matches the worker's reference-image fetch bound
const FETCH_TIMEOUT_MS = 10_000

export interface ReferenceImageValidation {
  ok: boolean
  /** Format read from the DECODED image metadata (jpeg/png/webp); null on failure. */
  format: string | null
  width: number | null
  height: number | null
  /** Measured payload byte size (decoded for data URLs, downloaded for https). */
  bytes: number
  /** Precise human-readable rejection reason; null when ok. */
  reason: string | null
}

async function resolveReferenceBytes(input: string): Promise<{ bytes: Buffer; reason: null } | { bytes: null; reason: string }> {
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',')
    if (comma < 0) return { bytes: null, reason: 'The reference image data URL has no base64 payload.' }
    let decoded: Buffer
    try {
      decoded = Buffer.from(input.slice(comma + 1), 'base64')
    } catch {
      return { bytes: null, reason: 'The reference image data URL is not valid base64.' }
    }
    if (decoded.length === 0) return { bytes: null, reason: 'The reference image data URL decodes to an empty payload.' }
    if (decoded.length > REFERENCE_IMAGE_MAX_BYTES) {
      return {
        bytes: null,
        reason: `The reference image is ${(decoded.length / 1024 / 1024).toFixed(1)} MB — above the ${REFERENCE_IMAGE_MAX_BYTES / 1024 / 1024} MB limit.`,
      }
    }
    return { bytes: decoded, reason: null }
  }
  // https URL (the zod schemas only admit https/data, but the guard is the
  // authoritative SSRF check): literal private/loopback/metadata rejection +
  // DNS-resolution check, shared with the research gateway.
  const guard = await assertPublicHttpUrl(input)
  if (!guard.ok) {
    return { bytes: null, reason: `The reference image URL was rejected: ${guard.reason}.` }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(input, { signal: controller.signal, redirect: 'manual' })
    if (!res.ok) {
      return { bytes: null, reason: `The reference image URL answered HTTP ${res.status} — the image could not be retrieved.` }
    }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > REFERENCE_IMAGE_MAX_BYTES) {
      return {
        bytes: null,
        reason: `The reference image is ${(declared / 1024 / 1024).toFixed(1)} MB — above the ${REFERENCE_IMAGE_MAX_BYTES / 1024 / 1024} MB limit.`,
      }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return { bytes: null, reason: 'The reference image URL returned an empty payload.' }
    if (buf.length > REFERENCE_IMAGE_MAX_BYTES) {
      return {
        bytes: null,
        reason: `The reference image is ${(buf.length / 1024 / 1024).toFixed(1)} MB — above the ${REFERENCE_IMAGE_MAX_BYTES / 1024 / 1024} MB limit.`,
      }
    }
    return { bytes: buf, reason: null }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { bytes: null, reason: `The reference image URL could not be fetched: ${detail.slice(0, 160)}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Validate one reference image end-to-end. Never throws; never modifies the input. */
export async function validateVideoReferenceImage(input: string): Promise<ReferenceImageValidation> {
  const resolved = await resolveReferenceBytes(input)
  if (!resolved.bytes) {
    return { ok: false, format: null, width: null, height: null, bytes: 0, reason: resolved.reason }
  }
  const bytes = resolved.bytes
  let meta: sharp.Metadata
  try {
    meta = await sharp(bytes).metadata()
  } catch {
    return {
      ok: false,
      format: null,
      width: null,
      height: null,
      bytes: bytes.length,
      reason: 'The reference image is not a decodable image (png/jpeg/webp required).',
    }
  }
  const format = (meta.format ?? '').toLowerCase()
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
    return {
      ok: false,
      format: format || null,
      width: meta.width ?? null,
      height: meta.height ?? null,
      bytes: bytes.length,
      reason: `The reference image is ${format || 'of an unknown format'} — png, jpeg or webp is required.`,
    }
  }
  if ((meta.pages ?? 1) > 1) {
    return {
      ok: false,
      format,
      width: meta.width ?? null,
      height: meta.height ?? null,
      bytes: bytes.length,
      reason: 'The reference image is animated — image-to-video needs a single still image.',
    }
  }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) {
    return {
      ok: false,
      format,
      width: null,
      height: null,
      bytes: bytes.length,
      reason: 'The reference image has no measurable dimensions.',
    }
  }
  if (
    width < REFERENCE_IMAGE_MIN_DIMENSION_PX ||
    height < REFERENCE_IMAGE_MIN_DIMENSION_PX ||
    width > REFERENCE_IMAGE_MAX_DIMENSION_PX ||
    height > REFERENCE_IMAGE_MAX_DIMENSION_PX
  ) {
    return {
      ok: false,
      format,
      width,
      height,
      bytes: bytes.length,
      reason: `The reference image is ${width}x${height} — dimensions must be within ${REFERENCE_IMAGE_MIN_DIMENSION_PX}..${REFERENCE_IMAGE_MAX_DIMENSION_PX} px per side.`,
    }
  }
  if (width * height > REFERENCE_IMAGE_MAX_PIXELS) {
    return {
      ok: false,
      format,
      width,
      height,
      bytes: bytes.length,
      reason: `The reference image is ${width}x${height} (${((width * height) / 1_000_000).toFixed(1)} MP) — above the ${REFERENCE_IMAGE_MAX_PIXELS / 1_000_000} MP limit.`,
    }
  }
  return { ok: true, format, width, height, bytes: bytes.length, reason: null }
}
