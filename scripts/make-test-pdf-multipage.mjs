/**
 * Create a REAL three-page PDF (uncompressed PDF 1.4, valid xref) to test
 * multi-page extraction accounting end to end. Genuine PDF — not a fake.
 * Page 3 carries a table header + units so the answer can be checked for
 * table-header/unit preservation.
 */
import { writeFileSync } from 'fs'

const out = process.argv[2] ?? '/tmp/bean-multipage.pdf'

const pageTexts = [
  'BEAN Quarterly Brief - Page 1. Total revenue for Q2 2026 was 4.2 million dollars, up 12 percent from Q1.',
  'BEAN Quarterly Brief - Page 2. Active users reached 38,400 across three regions. The churn rate fell to 2.1 percent.',
  'BEAN Quarterly Brief - Page 3. Regional revenue table (all figures in thousands of USD): North: 1,650; South: 1,400; West: 1,150. Figures are unaudited.',
]

const pages = []
const kids = []
const nPages = pageTexts.length
// Object layout: 1 catalog, 2 pages, 3 font, then per page: content obj + page obj.
let nextObj = 4
const objects = new Array(nPages * 2)
for (let i = 0; i < nPages; i++) {
  const escaped = pageTexts[i].replace(/([\\()])/g, '\\$1')
  const stream = `BT /F1 12 Tf 40 150 Td (${escaped}) Tj ET`
  const contentObj = nextObj + i * 2
  const pageObj = contentObj + 1
  objects[i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  objects[i * 2 + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
  kids.push(`${pageObj} 0 R`)
}

const head = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let pdf = '%PDF-1.4\n'
const offsets = [0]
const all = [...head, ...objects]
for (let i = 0; i < all.length; i++) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${all[i]}\nendobj\n`
}
const xrefStart = Buffer.byteLength(pdf)
pdf += `xref\n0 ${all.length + 1}\n`
pdf += '0000000000 65535 f \n'
for (let i = 1; i <= all.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

writeFileSync(out, pdf, 'latin1')
console.log(`wrote real 3-page PDF (${Buffer.byteLength(pdf)} bytes) -> ${out}`)
