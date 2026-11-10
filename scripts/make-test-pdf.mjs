/**
 * Create a REAL single-page PDF with the given text (uncompressed PDF 1.4,
 * valid xref). Used to test actual PDF text extraction end to end — the file
 * on disk is a genuine PDF, not a fake.
 */
import { writeFileSync } from 'fs'

const text = process.argv[2] ?? 'Default BEAN test text.'
const out = process.argv[3] ?? '/tmp/bean-test.pdf'
const escaped = text.replace(/([\\()])/g, '\\$1')

const stream = `BT /F1 12 Tf 40 150 Td (${escaped}) Tj ET`
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let pdf = '%PDF-1.4\n'
const offsets = [0]
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
}
const xrefStart = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n`
pdf += '0000000000 65535 f \n'
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

writeFileSync(out, pdf, 'latin1')
console.log(`wrote real PDF (${Buffer.byteLength(pdf)} bytes) -> ${out}`)
