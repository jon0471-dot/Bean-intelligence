/**
 * E2E fixture builder: real docx (JSZip), real xlsx (SheetJS),
 * real PNG with text (sharp), real zip archive, unsafe zip, exe bytes,
 * oversized files.
 */
import JSZip from 'jszip'
import fs from 'fs'
import path from 'path'

const OUT = '/home/z/my-project/scripts/e2e-files'

async function main() {
  // --- docx ---
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>BEAN Q3 Board Memo</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>The quarterly BEAN revenue was 4.2 million dollars.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>The main product is RIISHE, a conversational AI platform with live research and verified reasoning.</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  )
  fs.writeFileSync(path.join(OUT, 'test-doc.docx'), await zip.generateAsync({ type: 'nodebuffer' }))

  // --- xlsx ---
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['product', 'revenue_musd', 'quarter'],
    ['RIISHE', 4.2, 'Q3'],
    ['LAXII', 1.2, 'Q3'],
    ['CODEGIFTZ', 0.8, 'Q3'],
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Revenue')
  fs.writeFileSync(path.join(OUT, 'test-data.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  // --- PNG with visible text (real vision target) ---
  const sharp = (await import('sharp')).default
  const svg = Buffer.from(
    `<svg width="640" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="320" fill="#101014"/>
      <rect x="8" y="8" width="624" height="304" fill="none" stroke="#d4af37" stroke-width="4"/>
      <text x="320" y="130" font-size="44" fill="#d4af37" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold">BEAN Q3 REPORT</text>
      <text x="320" y="200" font-size="30" fill="#ffffff" text-anchor="middle" font-family="DejaVu Sans">Revenue: 4.2 million USD</text>
      <text x="320" y="250" font-size="24" fill="#888888" text-anchor="middle" font-family="DejaVu Sans">Flagship product: RIISHE</text>
    </svg>`,
  )
  await sharp(svg).png().toFile(path.join(OUT, 'test-chart.png'))

  // --- normal zip ---
  const az = new JSZip()
  az.file('readme.txt', 'The archive contains the lost Q2 notes.')
  az.file('numbers.csv', 'month,revenue\nApril,3.9\nMay,4.0\nJune,4.1')
  fs.writeFileSync(path.join(OUT, 'test-archive.zip'), await az.generateAsync({ type: 'nodebuffer' }))

  // --- unsafe zip (absolute-path entry survives JSZip load) ---
  const ez = new JSZip()
  ez.file('/abs/evil.txt', 'malicious')
  fs.writeFileSync(path.join(OUT, 'evil-traversal.zip'), await ez.generateAsync({ type: 'nodebuffer' }))

  // --- exe (MZ header) ---
  fs.writeFileSync(path.join(OUT, 'program.exe'), Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(128, 0x41)]))

  // --- spoofed png (MZ bytes, .png name) ---
  fs.writeFileSync(path.join(OUT, 'spoofed.png'), Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64, 0x00)]))

  // --- oversized (>25MB text) ---
  fs.writeFileSync(path.join(OUT, 'huge.txt'), 'x'.repeat(26 * 1024 * 1024))

  // --- oversized image (>10MB png) ---
  await sharp(svg).resize(4000, 2000, { fit: 'fill' }).png({ compressionLevel: 0 }).toFile(path.join(OUT, 'huge.png'))
  // pad if compression got it under 10MB
  const sz = fs.statSync(path.join(OUT, 'huge.png')).size
  if (sz < 10 * 1024 * 1024) {
    // PNG with random noise tail won't be valid; instead append via deflate-off big image
    const big = await sharp({
      create: {
        width: 2600,
        height: 2600,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: 'gaussian', mean: 128, sigma: 30 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer()
    fs.writeFileSync(path.join(OUT, 'huge.png'), big)
  }
  console.log('huge.png bytes:', fs.statSync(path.join(OUT, 'huge.png')).size)
  console.log('fixtures ready')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
