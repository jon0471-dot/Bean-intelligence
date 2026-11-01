/**
 * BEAN Intelligence — unit tests for the Phase-4 file capability upgrades.
 * Run: bun test tests/unit/riishe-files-v2.test.ts
 *
 * Builds REAL in-memory OOXML zips (JSZip) and pins:
 *   - PPTX: slide text extraction in presentation order + honest note
 *   - XLSX: ALL named sheets extracted (workbook.xml + rels resolution)
 *   - capability detection admits .pptx (ZIP magic + extension decides)
 *   - image original retention helpers: path containment (no escapes)
 */
import { describe, test, expect } from 'bun:test'
import path from 'node:path'
import JSZip from 'jszip'
import { extractPptx, extractXlsx } from '../../src/lib/files/extract'
import { detectCapability } from '../../src/lib/files/capabilities'
import { readStoredDocumentByPath } from '../../src/lib/files/riishe-store'

async function zipToBuffer(zip: JSZip): Promise<Buffer> {
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

async function buildPptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml))
  return zipToBuffer(zip)
}

function slideXml(paragraphs: string[]): string {
  return (
    '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="x">' +
    `<p:cSld><p:spTree>${paragraphs
      .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
      .join('')}</p:spTree></p:cSld></p:sld>`
  )
}

function sheetXml(rows: string[][]): string {
  const shared = ['A1', 'B1', 'A2', 'B2']
  const cell = (v: string) => `<c r="X" t="s"><v>${shared.indexOf(v)}</v></c>`
  return (
    '<?xml version="1.0"?><worksheet xmlns="x">' +
    rows.map((r) => `<row>${r.map(cell).join('')}</row>`).join('') +
    '</worksheet>'
  )
}

async function buildXlsx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types/>',
  )
  zip.file(
    'xl/sharedStrings.xml',
    '<sst><si><t>A1</t></si><si><t>B1</t></si><si><t>A2</t></si><si><t>B2</t></si></sst>',
  )
  zip.file(
    'xl/workbook.xml',
    '<workbook><sheets><sheet name="Revenue" sheetId="1" r:id="rId1"/><sheet name="Costs" sheetId="2" r:id="rId2"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
  )
  zip.file('xl/worksheets/sheet1.xml', sheetXml([['A1', 'B1']]))
  zip.file('xl/worksheets/sheet2.xml', sheetXml([['A2', 'B2']]))
  return zipToBuffer(zip)
}

describe('PPTX extraction (new capability)', () => {
  test('extracts slide text in presentation order with honest note', async () => {
    const bytes = await buildPptx([
      slideXml(['Q3 Review', 'Revenue up 18%']),
      slideXml(['Costs', 'Hiring paused']),
    ])
    const out = await extractPptx(bytes)
    expect(out.truncated).toBe(false)
    expect(out.text).toContain('### Slide 1')
    expect(out.text).toContain('Q3 Review')
    expect(out.text).toContain('Revenue up 18%')
    const slide1 = out.text.indexOf('Q3 Review')
    const slide2 = out.text.indexOf('Costs')
    expect(slide1).toBeGreaterThanOrEqual(0)
    expect(slide2).toBeGreaterThan(slide1)
    expect(out.note).toContain('PowerPoint')
    expect(out.note).toContain('not analyzed')
  })

  test('a slide-free PPTX is rejected honestly', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
    await expect(extractPptx(await zipToBuffer(zip))).rejects.toThrow(/no slides/)
  })

  test('detectCapability maps a real .pptx zip to the pptx capability', async () => {
    const bytes = await buildPptx([slideXml(['hi'])])
    const plan = detectCapability('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', new Uint8Array(bytes))
    expect(plan.capability).toBe('pptx')
    expect(plan.maxBytes).toBe(15 * 1024 * 1024)
    expect(plan.mimeMismatch).toBe(false)
  })
})

describe('XLSX extraction — all sheets, not just the first', () => {
  test('both named sheets are extracted with their names', async () => {
    const bytes = await buildXlsx()
    const out = await extractXlsx(bytes)
    expect(out.text).toContain('### Sheet: Revenue')
    expect(out.text).toContain('### Sheet: Costs')
    expect(out.text).toContain('A1,B1')
    expect(out.text).toContain('A2,B2')
    expect(out.note).toContain('2 sheets')
  })
})

describe('stored original bytes — path containment', () => {
  test('reads resolve only inside the store root; escapes return null', async () => {
    expect(await readStoredDocumentByPath('/etc/passwd')).toBe(null)
    expect(await readStoredDocumentByPath('/home/z/my-project/storage/riishe/documents/../../secrets.txt')).toBe(null)
    expect(await readStoredDocumentByPath(path.join(process.cwd(), 'nonexistent-file.bin'))).toBe(null)
  })
})
