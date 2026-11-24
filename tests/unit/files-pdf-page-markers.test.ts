/**
 * M37 §2 — genuine PDF page markers: the extraction separates each page's
 * own text with [page N] markers taken from the PDF text layer, so page
 * references are supported by the SOURCE, never invented. A minimal
 * two-page PDF is built in-fixture (xref offsets computed exactly).
 */
import { describe, test, expect } from 'bun:test'
import { extractPdf } from '../../src/lib/files/extract'

/** Build a minimal valid 2-page PDF (no xref — pdf.js rebuilds it). */
function buildTwoPagePdf(): Buffer {
  const content1 = 'BT /F1 12 Tf 72 720 Td (Alpha page content about coffee prices) Tj ET'
  const content2 = 'BT /F1 12 Tf 72 720 Td (Beta page content about tea tariffs) Tj ET'
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >> endobj
5 0 obj << /Length ${content1.length} >> stream
${content1}
endstream endobj
7 0 obj << /Length ${content2.length} >> stream
${content2}
endstream endobj
6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R /Size 8 >>
%%EOF`
  return Buffer.from(pdf, 'utf8')
}

describe('M37 PDF extraction — genuine page markers', () => {
  test('each page text carries its own [page N] marker from the text layer', async () => {
    const result = await extractPdf(buildTwoPagePdf())
    expect(result.truncated).toBe(false)
    expect(result.text).toContain('[page 1]')
    expect(result.text).toContain('[page 2]')
    expect(result.text.indexOf('Alpha page')).toBeGreaterThan(result.text.indexOf('[page 1]'))
    expect(result.text.indexOf('Beta page')).toBeGreaterThan(result.text.indexOf('[page 2]'))
    // Page 1 content must not appear after the page-2 marker (order preserved).
    expect(result.text.indexOf('Alpha page')).toBeLessThan(result.text.indexOf('[page 2]'))
    // The processing note states the marker provenance honestly.
    expect(result.note).toContain('[page N] markers')
  })

  test('the marker note never claims OCR or image analysis', async () => {
    const result = await extractPdf(buildTwoPagePdf())
    expect(result.note).not.toMatch(/ocr/i)
    expect(result.note).toContain('not analyzed')
  })
})
