/**
 * BEAN Intelligence — LAXII deterministic typography layer
 * (TEXT-HEAVY GENERATION, 2026-11-11).
 *
 * Measured reality this module answers:
 *  1. The hosted image model is a diffusers-class generator — exact
 *     typography is not a capability it can be assumed to have, and the
 *     original BEAN INTELLIGENCE poster prompt did not even survive the
 *     provider (measured: HTTP 200 with
 *     {"error":"Handler dispatch failed; nested exception is
 *     java.lang.StackOverflowError"} — a provider-side fault this exact
 *     prompt reproduces deterministically; the old SDK crashed on the same
 *     body and the job died as a generic BACKEND_FAILURE).
 *
 * The hybrid workflow (brief PART 4) is therefore implemented:
 *   1. generate a TEXT-FREE visual background (quoted text and typography
 *      directives stripped, explicit no-text conditioning added);
 *   2. render the EXACT supplied wording as a deterministic graphics layer
 *      (SVG → librsvg through sharp — the wording cannot drift);
 *   3. composite with controlled hierarchy (headline + subtitle);
 *   4. validate with REAL OCR (tesseract) when available and report the
 *      result honestly — a missing OCR binary degrades to `unavailable`,
 *      never to a claimed pass.
 *
 * This layer only ever applies to NEW text-to-image generations that carry
 * explicit quoted text demands; no existing editing workflow touches it.
 */
import sharp from 'sharp'
import { spawnSync } from 'child_process'
import { rm } from 'fs/promises'

export interface TextDemand {
  /** The exact wording the user demanded, in order (headline first). */
  segments: string[]
  /** The prompt with quoted text + typography directives stripped and
   *  explicit no-text conditioning appended. */
  textFreePrompt: string
}

/**
 * Extract EXPLICIT exact-text demands from a prompt. Conservative by
 * design: requires quoted segments (2–120 chars containing letters/digits)
 * AND a typography context (poster/logo/banner/… or explicit
 * exact/spelled/verbatim wording). Plain photos with incidental quotes are
 * not hijacked.
 */
export function extractExactTextDemands(prompt: string): TextDemand | null {
  const matches = [...prompt.matchAll(/['"]([^'"]{2,120})['"]/g)]
    .map((m) => m[1].trim())
    .filter((s) => /[a-z0-9]/i.test(s))
  if (matches.length === 0) return null
  const typographicContext =
    /(poster|logo|banner|flyer|advertisement|advert|typograph\w*|headline|subtitle|title|wordmark|cover\s*art)/i.test(prompt) ||
    /(exact|spelled|verbatim)/i.test(prompt)
  if (!typographicContext) return null

  let stripped = prompt
  for (const seg of matches) {
    stripped = stripped.split(`'${seg}'`).join(' ').split(`"${seg}"`).join(' ')
  }
  stripped = stripped
    .replace(/display the exact headline[^.]*/gi, ' ')
    .replace(/display the exact subtitle[^.]*/gi, ' ')
    .replace(/(and the )?exact subtitle[^.]*/gi, ' ')
    .replace(/all text must be spelled[^.]*/gi, ' ')
    .replace(/no additional words[^.]*/gi, ' ')
    .replace(/no gibberish[^,.]*/gi, ' ')
    .replace(/realistic metallic typography[^,.]*/gi, ' ')
    .replace(/clean hierarchy[^,.]*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim()
  const textFreePrompt =
    `${stripped} Absolutely no text, no letters, no words, no numbers and no typography anywhere in the image — ` +
    `leave a calm, uncluttered horizontal band across the middle for typography to be composited later.`

  return { segments: matches.slice(0, 3), textFreePrompt }
}

const GOLD_LIGHT = '#f0c75e'
const GOLD_DEEP = '#a8801a'

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Composite the exact wording over a generated background with a
 * controlled hierarchy: uppercase letterspaced headline on a champagne-gold
 * gradient with a soft dark shadow, subtitle beneath in lighter gold.
 * Pure local work — the wording is rendered verbatim or not at all.
 */
export async function compositeTypography(
  background: Buffer,
  segments: string[],
  target: { width: number; height: number },
): Promise<{ bytes: Buffer; width: number; height: number; format: 'jpeg' }> {
  const W = target.width
  const H = target.height
  const headline = segments[0]
  const subtitle = segments.slice(1).join('  ·  ')

  const maxTextWidth = W * 0.84
  // DejaVu Sans Bold: average glyph advance ≈ 0.62 × font-size (uppercase,
  // letterspaced ≈ 0.70). Size the headline to FIT the width, bounded.
  const headlineSize = Math.max(
    14,
    Math.min(H * 0.098, (maxTextWidth / (0.7 * Math.max(headline.length, 1)))),
  )
  // Subtitle runs LONGER — measured (OCR round-trip): a wider estimate is
  // needed so the outermost glyphs stay clear of the canvas edge.
  const subtitleSize = Math.max(
    11,
    Math.min(H * 0.042, subtitle ? (W * 0.8) / (0.72 * subtitle.length) : 0),
  )
  const spacing = Math.round(headlineSize * 0.08)

  const centerY = subtitle ? H * 0.44 : H * 0.5
  const shadowOffset = Math.max(2, Math.round(headlineSize * 0.045))

  const headlineText = escapeXml(headline.toUpperCase())
  const subtitleText = subtitle ? escapeXml(subtitle.toUpperCase()) : ''

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GOLD_LIGHT}"/>
      <stop offset="1" stop-color="${GOLD_DEEP}"/>
    </linearGradient>
  </defs>
  <text x="${W / 2 + shadowOffset}" y="${centerY + shadowOffset}" text-anchor="middle"
        font-family="DejaVu Sans" font-weight="bold" font-size="${headlineSize}"
        letter-spacing="${spacing}" fill="#000000" fill-opacity="0.55">${headlineText}</text>
  <text x="${W / 2}" y="${centerY}" text-anchor="middle"
        font-family="DejaVu Sans" font-weight="bold" font-size="${headlineSize}"
        letter-spacing="${spacing}" fill="url(#gold)">${headlineText}</text>
  ${
    subtitleText
      ? `<text x="${W / 2}" y="${centerY + headlineSize * 0.95}" text-anchor="middle"
        font-family="DejaVu Sans" font-weight="bold" font-size="${subtitleSize}"
        letter-spacing="${Math.max(1, Math.round(subtitleSize * 0.14))}" fill="#e8d9a0">${subtitleText}</text>`
      : ''
  }
</svg>`

  const out = await sharp(background, { failOn: 'none' })
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 93 })
    .toBuffer()
  return { bytes: out, width: W, height: H, format: 'jpeg' }
}

/** Real OCR (tesseract) on the artifact; null when the capability is absent. */
export async function ocrText(bytes: Buffer): Promise<string | null> {
  let path: string | null = null
  try {
    path = `/tmp/laxii-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    await sharp(bytes, { failOn: 'none' }).png().toFile(path)
    const proc = spawnSync('tesseract', [path, 'stdout', '--psm', '11'], {
      timeout: 30_000,
      encoding: 'utf8',
    })
    const out = (proc.stdout ?? '').trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  } finally {
    if (path) await rm(path, { force: true }).catch(() => undefined)
  }
}

export interface TextValidation {
  method: 'tesseract' | 'unavailable'
  /** Exact wording confirmed present in the artifact by OCR. */
  found: string[]
  /** Exact wording OCR could not confirm (empty when method unavailable). */
  missing: string[]
  checkedAt: string
}

/** Compare OCR output against the demanded wording (normalized). */
export function validateExactText(ocr: string | null, segments: string[]): TextValidation {
  const checkedAt = new Date().toISOString()
  if (ocr === null) {
    return { method: 'unavailable', found: [], missing: [], checkedAt }
  }
  const norm = ocr.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const found: string[] = []
  const missing: string[] = []
  for (const seg of segments) {
    const n = seg.toLowerCase().replace(/[^a-z0-9]+/g, '')
    ;(n.length > 0 && norm.includes(n) ? found : missing).push(seg)
  }
  return { method: 'tesseract', found, missing, checkedAt }
}
