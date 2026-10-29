/**
 * BEAN Intelligence — capability-based content extraction.
 *
 * Every extractor returns HONEST output: extracted text with a truncation
 * flag, or a thrown extraction error carrying an actionable message. Nothing
 * invents content it did not actually read. All inputs are untrusted —
 * parsers run with size caps and never execute document logic.
 */
import JSZip from 'jszip'

export interface ExtractionResult {
  text: string
  truncated: boolean
  /** Honest processing note surfaced to the user ("" when nothing to add). */
  note: string
}

/** Hard cap on extracted characters handed to the model context. */
export const MAX_EXTRACT_CHARS = 200_000

export class ExtractionError extends Error {}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACT_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_EXTRACT_CHARS), truncated: true }
}

/** Plain text-ish files: decoded as UTF-8 with replacement characters. */
export function extractText(bytes: Buffer | Uint8Array, language = ''): ExtractionResult {
  const text = Buffer.from(bytes).toString('utf8')
  if (text.trim().length === 0) {
    throw new ExtractionError('The file contains no readable text.')
  }
  const capped = cap(text)
  return {
    ...capped,
    note: language ? `Source file analyzed as ${language}.` : '',
  }
}

/** PDF via pdf-parse (text layer only — scanned images honestly rejected). */
export async function extractPdf(bytes: Buffer): Promise<ExtractionResult> {
  const { PDFParse } = await import('pdf-parse')
  let parser: InstanceType<typeof PDFParse> | null = null
  try {
    parser = new PDFParse({ data: new Uint8Array(bytes) })
    const result = await parser.getText()
    const text = (result.text ?? '').replace(/\n?--\s*\d+\s+of\s+\d+\s*--\n?/g, '\n').replace(/\u0000/g, '').trim()
    if (text.length === 0) {
      throw new ExtractionError(
        'This PDF has no extractable text layer (likely a scanned image) — OCR is not available in this deployment.',
      )
    }
    const capped = cap(text)
    return {
      ...capped,
      note: 'PDF (text layer extracted).',
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    throw new ExtractionError('PDF text extraction failed — the file may be corrupted or password-protected.')
  } finally {
    await parser?.destroy().catch(() => {})
  }
}

/** Minimal, dependency-safe XML text: strips tags, decodes common entities. */
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ') // DOCX paragraphs -> line breaks
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

/** DOCX: unzip in memory, read word/document.xml (no macros are ever run). */
export async function extractDocx(bytes: Buffer): Promise<ExtractionResult> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const doc = zip.file('word/document.xml')
    if (!doc) throw new ExtractionError('This .docx is missing its main document part — the file may be corrupted.')
    const xml = await doc.async('string')
    const text = xmlToText(xml)
    if (text.trim().length === 0) {
      throw new ExtractionError('The DOCX contains no readable text (it may hold only images or be empty).')
    }
    const capped = cap(text)
    return { ...capped, note: 'Word document (text extracted; embedded images not analyzed).' }
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    throw new ExtractionError('DOCX extraction failed — the file may be corrupted or password-protected.')
  }
}

/**
 * XLSX: unzip in memory, read sharedStrings + the first worksheet, and emit
 * a CSV-ish rendition of CELL VALUES. Formulas are read as their cached
 * values; macros are ignored (never executed). This is a values extractor,
 * not a spreadsheet engine — complex workbooks note the limitation honestly.
 */
export async function extractXlsx(bytes: Buffer): Promise<ExtractionResult> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const sharedRaw = await zip.file('xl/sharedStrings.xml')?.async('string')
    const shared: string[] = []
    if (sharedRaw) {
      for (const m of sharedRaw.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        shared.push(xmlToText(m[1]))
      }
    }
    // first worksheet (sheet1.xml or the first xl/worksheets/*.xml entry)
    const sheetObj =
      zip.file('xl/worksheets/sheet1.xml') ??
      Object.keys(zip.files)
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
        .sort()
        .map((k) => zip.file(k))
        .find((f): f is NonNullable<typeof f> => f !== null) ??
      null
    if (!sheetObj) throw new ExtractionError('This XLSX has no worksheet — the file may be corrupted.')
    const sheetRaw = await sheetObj.async('string')

    const rows: string[] = []
    for (const rowMatch of sheetRaw.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1]
        const type = attrs.match(/\st="(\w+)"/)?.[1]
        const inner = cellMatch[2]
        const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
        const inlineMatch = inner.match(/<is>([\s\S]*?)<\/is>/)
        let value = ''
        if (type === 's' && valueMatch) value = shared[Number(valueMatch[1])] ?? ''
        else if (type === 'inlineStr' && inlineMatch) value = xmlToText(inlineMatch[1])
        else if (valueMatch) value = valueMatch[1]
        cells.push(value)
      }
      if (cells.some((c) => c.length > 0)) rows.push(cells.join(','))
    }
    const text = rows.join('\n')
    if (text.trim().length === 0) {
      throw new ExtractionError('The workbook contains no cell values (it may hold only charts or be empty).')
    }
    const capped = cap(text)
    return {
      ...capped,
      note: 'Excel workbook (first sheet, cell values; formulas are read as their cached results).',
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    throw new ExtractionError('XLSX extraction failed — the file may be corrupted or password-protected.')
  }
}
