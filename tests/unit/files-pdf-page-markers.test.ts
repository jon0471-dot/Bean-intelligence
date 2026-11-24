/**
 * M37 §2 — genuine PDF page markers: the extraction separates each page's
 * own text with [page N] markers taken from the PDF text layer, so page
 * references are supported by the SOURCE, never invented. A minimal
 * two-page PDF is built in-fixture (xref offsets computed exactly).
 */
import { describe, test, expect } from 'bun:test'
import { extractPdf } from '../../src/lib/files/extract'

/** Build a minimal valid 2-page PDF with distinct text per page. */
function buildTwoPagePdf(): Buffer {
  const objects: string[] = []
  const content1 = 'BT /F1 12 Tf 72 720 Td (Alpha page content about coffee prices) Tj ET'
  const content2 = 'BT /F1 12 Tf 72 720 Td (Beta page content about tea tariffs) Tj ET'
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n')
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n')
  objects.push('4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n')
  objects.push(`5 0 obj\n<< /Length ${content1.length} >>\nstream\n${content1}\nendstream\nendobj\n`)
  objects.push(`7 0 obj\n<< /Length ${content2.length} >>\nstream\n${content2}\nendstream\nendobj\n`)
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(body.length)
    body += obj
  }
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
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
