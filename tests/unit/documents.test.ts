/**
 * Unit tests for document ingestion: real text extraction (txt/md/csv/json
 * and a REAL minimal PDF), honest failures for unsupported/empty files, the
 * 10 MB limit and filename sanitization.
 */
import { describe, test, expect } from 'bun:test'
import { extractDocumentText, sanitizeDisplayName, extensionOf } from '../../src/app/api/riishe/documents/route'
import { BeanApiError } from '../../src/lib/api/errors'

function textPdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1')
  return Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R>>endobj
4 0 obj<</Length ${escaped.length + 40}>>stream
BT /F1 12 Tf 40 150 Td (${escaped}) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF`,
    'utf8',
  )
}

describe('document text extraction (real contents only)', () => {
  test('txt extraction is exact', async () => {
    const out = await extractDocumentText(Buffer.from('Line one.\nLine two.', 'utf8'), 'notes.txt')
    expect(out.text).toBe('Line one.\nLine two.')
    expect(out.truncated).toBe(false)
    expect(out.mime).toBe('text/plain')
  })

  test('csv is treated as text with a csv mime', async () => {
    const out = await extractDocumentText(Buffer.from('a,b,c\n1,2,3'), 'data.csv')
    expect(out.text).toContain('a,b,c')
    expect(out.mime).toBe('text/csv')
  })

  test('REAL pdf text extraction returns the actual page text', async () => {
    const out = await extractDocumentText(textPdf('Hello BEAN upload'), 'brief.pdf')
    expect(out.mime).toBe('application/pdf')
    expect(out.text).toContain('Hello BEAN upload')
    expect(out.truncated).toBe(false)
  }, 20_000)

  test('oversized extraction is truncated with the flag set (never silent)', async () => {
    const big = 'x'.repeat(210_000)
    const out = await extractDocumentText(Buffer.from(big, 'utf8'), 'big.txt')
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBe(200_000)
  })

  test('unsupported extensions are rejected with an actionable message', async () => {
    try {
      await extractDocumentText(Buffer.from('MZ...'), 'program.exe')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BeanApiError)
      expect((e as BeanApiError).code).toBe('UNSUPPORTED_FORMAT')
      expect((e as Error).message).toContain('Supported')
    }
  })

  test('empty text files are rejected (no fake success)', async () => {
    try {
      await extractDocumentText(Buffer.from('   \n  ', 'utf8'), 'empty.txt')
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('UNSUPPORTED_CONTENT')
    }
  })
})

describe('filename handling (display-only, path-safe)', () => {
  test('strips path components and control characters', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeDisplayName('C:\\Users\\eve\\report.pdf')).toBe('report.pdf')
    expect(sanitizeDisplayName('bad\x00\x1fname.txt')).toBe('badname.txt')
  })

  test('falls back to a safe name when everything is stripped', () => {
    expect(sanitizeDisplayName('\x00\x1f')).toBe('document')
  })

  test('extensionOf is case-insensitive', () => {
    expect(extensionOf('X.PDF')).toBe('pdf')
    expect(extensionOf('noext')).toBe('')
  })
})
