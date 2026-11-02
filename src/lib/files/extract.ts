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
    // PAGE ACCOUNTING (honest extraction scope): pdf-parse v2 exposes each
    // page's own text. A page with no extractable text is a scan/image page —
    // it was NOT analyzed, and the note says so instead of implying the whole
    // file was processed. The extracted `text` itself is unchanged.
    const pages = Array.isArray(result.pages) ? result.pages : []
    const total = typeof result.total === 'number' && result.total > 0 ? result.total : pages.length
    const withText = pages.filter((p) => (p.text ?? '').trim().length > 0)
    const unreadable = pages.filter((p) => (p.text ?? '').trim().length === 0).map((p) => p.num)
    let note = 'PDF (text layer extracted'
    if (total > 0) {
      note += `; ${withText.length} of ${total} page${total === 1 ? '' : 's'} had extractable text`
      if (unreadable.length > 0) {
        const shown = unreadable.slice(0, 10).join(', ')
        note += `; pages with no text layer (scan/image page — NOT analyzed): ${shown}${unreadable.length > 10 ? ', …' : ''}`
      }
      if (withText.length < total) {
        note += `; ${total - withText.length} page${total - withText.length === 1 ? '' : 's'} contributed no text`
      }
    }
    note += '; embedded images, charts and scan-only content are not analyzed)'
    const capped = cap(text)
    return {
      ...capped,
      note,
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
 * XLSX: unzip in memory, read sharedStrings + ALL worksheets (named via
 * workbook.xml + its rels), and emit a CSV-ish rendition of CELL VALUES per
 * sheet. Formulas are read as their cached values; macros are ignored (never
 * executed). This is a values extractor, not a spreadsheet engine — complex
 * workbooks note the limitation honestly.
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

    // Sheet order + display names from workbook.xml, resolved to part paths
    // through xl/_rels/workbook.xml.rels (r:id -> worksheets/sheetN.xml).
    // Falls back to filename order when the rels are missing/unparsable.
    const relsRaw = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
    const rels = new Map<string, string>()
    if (relsRaw) {
      for (const tag of relsRaw.matchAll(/<Relationship\b[^>]*\/>/g)) {
        const id = tag[0].match(/\bId="([^"]+)"/)?.[1]
        const target = tag[0].match(/\bTarget="([^"]+)"/)?.[1]
        if (id && target) rels.set(id, target.replace(/^\//, ''))
      }
    }
    const bookRaw = await zip.file('xl/workbook.xml')?.async('string')
    const sheetRefs: Array<{ name: string; part: string | null }> = []
    if (bookRaw) {
      for (const tag of bookRaw.matchAll(/<sheet\b[^>]*\/>/g)) {
        const name = tag[0].match(/\bname="([^"]+)"/)?.[1]
        const rid = tag[0].match(/\br:id="([^"]+)"/)?.[1]
        if (!name || !rid) continue
        const target = rels.get(rid)
        sheetRefs.push({
          name,
          part: target ? `xl/${target.replace(/^xl\//, '')}` : null,
        })
      }
    }

    const parts: Array<{ name: string; obj: JSZip.JSZipObject }> =
      sheetRefs.length > 0
        ? sheetRefs
            .map((ref) => {
              const obj = ref.part ? zip.file(ref.part) : null
              return obj ? { name: ref.name, obj } : null
            })
            .filter((p): p is { name: string; obj: JSZip.JSZipObject } => p !== null)
        : Object.keys(zip.files)
            .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
            .sort()
            .map((k) => ({ name: k.replace('xl/worksheets/', '').replace('.xml', ''), obj: zip.file(k)! }))
            .filter((p) => p.obj !== null)
    if (parts.length === 0) throw new ExtractionError('This XLSX has no worksheet — the file may be corrupted.')

    const blocks: string[] = []
    for (const { name, obj } of parts) {
      const sheetRaw = await obj.async('string')
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
      const body = rows.join('\n')
      if (body.trim().length > 0) blocks.push(`### Sheet: ${name}\n${body}`)
    }
    const text = blocks.join('\n\n')
    if (text.trim().length === 0) {
      throw new ExtractionError('The workbook contains no cell values (it may hold only charts or be empty).')
    }
    const capped = cap(text)
    return {
      ...capped,
      note: `Excel workbook (${parts.length} sheet${parts.length === 1 ? '' : 's'}, cell values; formulas are read as their cached results).`,
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    throw new ExtractionError('XLSX extraction failed — the file may be corrupted or password-protected.')
  }
}

/**
 * PPTX: unzip in memory, read every slide part (ppt/slides/slideN.xml) in
 * presentation order, and emit each slide's text runs (<a:t>). Text-only by
 * design — embedded images/charts (and speaker notes) are not analyzed, and
 * the note says so.
 */
export async function extractPptx(bytes: Buffer): Promise<ExtractionResult> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const slideParts = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
        const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
        return na - nb
      })
    if (slideParts.length === 0) {
      throw new ExtractionError('This PPTX has no slides — the file may be corrupted.')
    }

    const blocks: string[] = []
    for (let i = 0; i < slideParts.length; i += 1) {
      const xml = await zip.file(slideParts[i])!.async('string')
      // One <a:p> per line; runs inside a paragraph join without separators.
      const paragraphs: string[] = []
      for (const p of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
        const runs = [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')
        const line = runs
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'")
          .trim()
        if (line.length > 0) paragraphs.push(line)
      }
      if (paragraphs.length > 0) blocks.push(`### Slide ${i + 1}\n${paragraphs.join('\n')}`)
    }
    const text = blocks.join('\n\n')
    if (text.trim().length === 0) {
      throw new ExtractionError('The presentation contains no readable text (it may hold only images or be empty).')
    }
    const capped = cap(text)
    return {
      ...capped,
      note: 'PowerPoint presentation (slide text extracted; embedded images and charts not analyzed).',
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e
    throw new ExtractionError('PPTX extraction failed — the file may be corrupted or password-protected.')
  }
}
