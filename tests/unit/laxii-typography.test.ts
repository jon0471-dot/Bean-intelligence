/**
 * LAXII deterministic typography layer (TEXT-HEAVY GENERATION, 2026-11-11).
 *
 * Pins the PART 4 hybrid: quoted exact-text extraction, the text-free
 * background prompt, the deterministic composite (the wording is rendered
 * by BEAN — it cannot drift), and REAL OCR validation (tesseract runs on
 * this host; the OCR round-trip below is a genuine end-to-end local check
 * with zero provider cost).
 */
import { describe, test, expect } from 'bun:test'
import sharp from 'sharp'
import {
  extractExactTextDemands,
  compositeTypography,
  ocrText,
  validateExactText,
} from '../../src/lib/laxii/typography'

const POSTER_PROMPT =
  "Create a premium technology advertisement poster for a brand called BEAN INTELLIGENCE. Display the exact headline 'INTELLIGENCE WITHOUT LIMITS' and the exact subtitle 'FOUR PRODUCTS. ONE INTELLIGENCE.' Use a sophisticated black and champagne-gold visual identity, realistic metallic typography, elegant futuristic composition, cinematic lighting, clean hierarchy, professional advertising design. All text must be spelled exactly as supplied. No additional words, no gibberish, no watermark."

describe('extractExactTextDemands', () => {
  test('the original poster prompt yields both exact segments in order', () => {
    const d = extractExactTextDemands(POSTER_PROMPT)
    expect(d).not.toBeNull()
    expect(d!.segments).toEqual(['INTELLIGENCE WITHOUT LIMITS', 'FOUR PRODUCTS. ONE INTELLIGENCE.'])
  })

  test('the text-free prompt strips the quoted wording and typography directives', () => {
    const d = extractExactTextDemands(POSTER_PROMPT)!
    expect(d.textFreePrompt).not.toContain('INTELLIGENCE WITHOUT LIMITS')
    expect(d.textFreePrompt).not.toContain('Display the exact headline')
    expect(d.textFreePrompt).not.toContain('All text must be spelled')
    expect(d.textFreePrompt).toContain('BEAN INTELLIGENCE') // brand identity kept
    expect(d.textFreePrompt.toLowerCase()).toContain('no text, no letters')
  })

  test('plain photo prompts without quoted text are not hijacked', () => {
    expect(extractExactTextDemands('a serene mountain lake at golden hour, photorealistic')).toBeNull()
  })

  test('quotes without a typography context are left alone', () => {
    expect(extractExactTextDemands("a bird call that sounds like 'kree' at dawn")).toBeNull()
  })
})

describe('compositeTypography — deterministic exact wording + real OCR', () => {
  test('the composited artifact carries the exact wording, OCR-verified', async () => {
    // Local synthetic background (no provider): dark poster-like canvas.
    const bg = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: 12, g: 12, b: 14 } },
    })
      .png()
      .toBuffer()
    const comp = await compositeTypography(bg, ['INTELLIGENCE WITHOUT LIMITS', 'FOUR PRODUCTS. ONE INTELLIGENCE.'], {
      width: 1024,
      height: 1024,
    })
    expect(comp.width).toBe(1024)
    expect(comp.height).toBe(1024)

    const ocr = await ocrText(comp.bytes)
    expect(ocr).not.toBeNull() // tesseract present on this host
    const v = validateExactText(ocr, ['INTELLIGENCE WITHOUT LIMITS', 'FOUR PRODUCTS. ONE INTELLIGENCE.'])
    expect(v.method).toBe('tesseract')
    expect(v.missing).toEqual([])
    expect(v.found).toEqual(['INTELLIGENCE WITHOUT LIMITS', 'FOUR PRODUCTS. ONE INTELLIGENCE.'])
  })

  test('a background WITHOUT the wording fails OCR validation (honest negative)', async () => {
    const bg = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 12, g: 12, b: 14 } },
    })
      .png()
      .toBuffer()
    const ocr = await ocrText(bg)
    const v = validateExactText(ocr ?? '', ['INTELLIGENCE WITHOUT LIMITS'])
    expect(v.missing).toEqual(['INTELLIGENCE WITHOUT LIMITS'])
  })

  test('validateExactText normalizes punctuation and case', () => {
    const v = validateExactText('Intelligence Without\nLimits!', ['INTELLIGENCE WITHOUT LIMITS'])
    expect(v.missing).toEqual([])
  })
})
