#!/usr/bin/env python3
"""M37 patch: files/extract.ts — genuine PDF page markers in the text layer."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/lib/files/extract.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

sub("""    parser = new PDFParse({ data: new Uint8Array(bytes) })
    const result = await parser.getText()
    const text = (result.text ?? '').replace(/\\n?--\\s*\\d+\\s+of\\s+\\d+\\s*--\\n?/g, '\\n').replace(/\\u0000/g, '').trim()
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
    let note = 'PDF (text layer extracted'""",
"""    parser = new PDFParse({ data: new Uint8Array(bytes) })
    const result = await parser.getText()
    // PAGE ACCOUNTING (honest extraction scope): pdf-parse v2 exposes each
    // page's own text. A page with no extractable text is a scan/image page —
    // it was NOT analyzed, and the note says so instead of implying the whole
    // file was processed.
    const pages = Array.isArray(result.pages) ? result.pages : []
    // M37 §2 — GENUINE PAGE REFERENCES: when per-page text is available, the
    // extracted text carries explicit [page N] markers taken from the PDF's
    // own text layer. Anything downstream (composer, read_document) can
    // therefore cite a page number that the extraction REALLY supports;
    // markers are never invented for sources without page metadata.
    let pageMarked = ''
    if (pages.length > 0) {
      const parts: string[] = []
      for (const pg of pages) {
        const t = (pg.text ?? '').trim()
        if (t.length > 0) parts.push(`[page ${pg.num}]\\n${t}`)
      }
      pageMarked = parts.join('\\n\\n')
    }
    const rawText = (pageMarked.length > 0 ? pageMarked : (result.text ?? ''))
      .replace(/\\n?--\\s*\\d+\\s+of\\s+\\d+\\s*--\\n?/g, '\\n')
      .replace(/\\u0000/g, '')
      .trim()
    const text = rawText
    if (text.length === 0) {
      throw new ExtractionError(
        'This PDF has no extractable text layer (likely a scanned image) — OCR is not available in this deployment.',
      )
    }
    const total = typeof result.total === 'number' && result.total > 0 ? result.total : pages.length
    const withText = pages.filter((p) => (p.text ?? '').trim().length > 0)
    const unreadable = pages.filter((p) => (p.text ?? '').trim().length === 0).map((p) => p.num)
    let note = 'PDF (text layer extracted'""")

sub("""      if (withText.length < total) {
        note += `; ${total - withText.length} page${total - withText.length === 1 ? '' : 's'} contributed no text`
      }
    }
    note += '; embedded images, charts and scan-only content are not analyzed)'""",
"""      if (withText.length < total) {
        note += `; ${total - withText.length} page${total - withText.length === 1 ? '' : 's'} contributed no text`
      }
    }
    if (pages.length > 0 && pageMarked.length > 0) {
      note += '; text is separated by genuine [page N] markers from the text layer'
    }
    note += '; embedded images, charts and scan-only content are not analyzed)'""")

p.write_text(src)
print("extract.ts patched OK")
