/**
 * LAXII — fixed evaluation set generator (Phase 7).
 *
 * Builds the mission §11 fixture set SYNTHETICALLY with Sharp/SVG. These are
 * procedural stand-ins (gradient "portraits" with face-like ellipses, product
 * flat-lays, posters with real rendered text, etc.) — they exercise the
 * deterministic engine end-to-end on THIS host. They are NOT real photographs:
 * face-identity benchmarks (D/E) require real photos plus the GPU worker and
 * are explicitly out of scope here. Artifacts land in tests/fixtures/laxii/.
 */
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const OUT = path.join(process.cwd(), 'tests', 'fixtures', 'laxii')

function noise(seed: number, n: number): number[] {
  const out: number[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out.push(s >>> 24)
  }
  return out
}

async function png(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true })
  const files: Record<string, Buffer> = {}

  // 1. Single-person portrait: gradient backdrop, face-like ellipse, shoulders.
  files['portrait-single.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3a3f52"/><stop offset="1" stop-color="#171a24"/>
      </linearGradient></defs>
      <rect width="480" height="640" fill="url(#bg)"/>
      <ellipse cx="240" cy="240" rx="90" ry="120" fill="#c9a179"/>
      <ellipse cx="205" cy="215" rx="10" ry="7" fill="#2c2620"/>
      <ellipse cx="275" cy="215" rx="10" ry="7" fill="#2c2620"/>
      <path d="M215 300 Q240 322 265 300" stroke="#7c5a44" stroke-width="6" fill="none"/>
      <path d="M110 640 Q240 430 370 640 Z" fill="#24304a"/>
    </svg>`)

  // 2. Multiple-person portrait.
  files['portrait-multi.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <rect width="640" height="480" fill="#2b2f3d"/>
      <ellipse cx="210" cy="220" rx="80" ry="105" fill="#c9a179"/>
      <path d="M90 480 Q210 330 330 480 Z" fill="#4a3b57"/>
      <ellipse cx="450" cy="240" rx="80" ry="105" fill="#a97c5b"/>
      <path d="M330 480 Q450 345 570 480 Z" fill="#2f4a3f"/>
    </svg>`)

  // 3. Product photography: flat-lay watch on paper.
  files['product-watch.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
      <rect width="640" height="640" fill="#ece7df"/>
      <rect x="60" y="60" width="520" height="520" rx="18" fill="#f7f4ee" stroke="#d9d2c6" stroke-width="3"/>
      <circle cx="320" cy="320" r="150" fill="#1d222e"/>
      <circle cx="320" cy="320" r="132" fill="#f2efe8"/>
      <line x1="320" y1="320" x2="320" y2="212" stroke="#1d222e" stroke-width="9"/>
      <line x1="320" y1="320" x2="392" y2="352" stroke="#1d222e" stroke-width="7"/>
      <circle cx="320" cy="320" r="9" fill="#8a6d2f"/>
      <text x="320" y="392" font-family="sans-serif" font-size="20" fill="#555" text-anchor="middle">BEAN CHRONO</text>
    </svg>`)

  // 4. Landscape.
  files['landscape.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="440">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#89b6d8"/><stop offset="1" stop-color="#e6d7ae"/>
      </linearGradient></defs>
      <rect width="720" height="440" fill="url(#sky)"/>
      <circle cx="590" cy="90" r="42" fill="#f6e8b1"/>
      <path d="M0 300 L180 190 L340 300 Z" fill="#5d7360"/>
      <path d="M260 310 L470 160 L700 310 Z" fill="#42564b"/>
      <rect y="300" width="720" height="140" fill="#31473a"/>
      <path d="M0 330 Q360 300 720 340" stroke="#28392f" stroke-width="10" fill="none"/>
    </svg>`)

  // 5. Architecture.
  files['architecture.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="560" height="640">
      <rect width="560" height="640" fill="#d8dbe2"/>
      <rect x="80" y="120" width="400" height="440" fill="#b6b2a6"/>
      <rect x="80" y="120" width="400" height="26" fill="#8f8b80"/>
      ${[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) =>
        `<rect x="${112 + c * 124}" y="${176 + r * 96}" width="72" height="64" fill="#4f5d70"/>`,
      ).join('')).join('')}
      <rect x="238" y="472" width="84" height="88" fill="#3d3a34"/>
      <polygon points="60,120 280,40 500,120" fill="#7a7568"/>
    </svg>`)

  // 6. Text-containing poster (REAL rendered text — pixel checks apply).
  files['poster-text.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="540" height="720">
      <rect width="540" height="720" fill="#14121c"/>
      <circle cx="270" cy="220" r="120" fill="none" stroke="#d4af37" stroke-width="6"/>
      <text x="270" y="248" font-family="sans-serif" font-size="72" fill="#f0c75e" text-anchor="middle" font-weight="bold">BEAN</text>
      <text x="270" y="430" font-family="sans-serif" font-size="40" fill="#ffffff" text-anchor="middle">SPRING GALA 2026</text>
      <text x="270" y="486" font-family="sans-serif" font-size="22" fill="#b9b3a4" text-anchor="middle">SATURDAY · 7 PM · HALL B</text>
      <rect x="150" y="560" width="240" height="58" rx="10" fill="#d4af37"/>
      <text x="270" y="598" font-family="sans-serif" font-size="24" fill="#14121c" text-anchor="middle" font-weight="bold">GET TICKETS</text>
    </svg>`)

  // 7. Logo-containing image.
  files['logo-badge.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="480">
      <rect width="480" height="480" fill="#f4f1ea"/>
      <circle cx="240" cy="200" r="110" fill="#d4af37"/>
      <path d="M170 200 L225 260 L315 150" stroke="#14121c" stroke-width="22" fill="none" stroke-linecap="round"/>
      <text x="240" y="380" font-family="sans-serif" font-size="44" fill="#14121c" text-anchor="middle" letter-spacing="6">GIFTZ&amp;CO</text>
    </svg>`)

  // 8. Low-resolution photograph (64x48, no smoothing tricks).
  {
    const vals = noise(99, 64 * 48 * 3)
    const data = Buffer.alloc(64 * 48 * 3)
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 3
        const base = 60 + Math.round(80 * Math.sin((x / 64) * Math.PI)) // soft structure
        data[i] = Math.min(255, base + Math.round(vals[i] % 24))
        data[i + 1] = Math.min(255, base + Math.round(vals[i + 1] % 24))
        data[i + 2] = Math.min(255, base + Math.round(vals[i + 2] % 24))
      }
    }
    files['photo-lowres.png'] = await sharp(data, { raw: { width: 64, height: 48, channels: 3 } }).png().toBuffer()
  }

  // 9. Complex background (many overlapping shapes + noise).
  {
    let shapes = ''
    const rnd = noise(7, 240)
    for (let k = 0; k < 40; k++) {
      const x = 20 + (rnd[k * 6] % 600)
      const y = 20 + (rnd[k * 6 + 1] % 440)
      const r = 20 + (rnd[k * 6 + 2] % 90)
      const c = `hsl(${rnd[k * 6 + 3] % 360}, 45%, ${25 + (rnd[k * 6 + 4] % 45)}%)`
      shapes += k % 2 === 0
        ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.7"/>`
        : `<rect x="${x}" y="${y}" width="${r}" height="${r}" fill="${c}" opacity="0.7" transform="rotate(${rnd[k * 6 + 5] % 90} ${x} ${y})"/>`
    }
    files['background-complex.png'] = await png(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
        <rect width="640" height="480" fill="#1b1e2b"/>${shapes}
      </svg>`)
  }

  // 10. Localized-edit case: portrait with a stained corner ("remove stain").
  files['localized-edit.png'] = await png(`
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">
      <rect width="480" height="640" fill="#39404f"/>
      <ellipse cx="240" cy="250" rx="88" ry="118" fill="#c9a179"/>
      <ellipse cx="205" cy="225" rx="10" ry="7" fill="#2c2620"/>
      <ellipse cx="275" cy="225" rx="10" ry="7" fill="#2c2620"/>
      <path d="M115 640 Q240 440 365 640 Z" fill="#223048"/>
      <ellipse cx="395" cy="560" rx="46" ry="30" fill="#6e4a2f" opacity="0.85"/>
      <ellipse cx="410" cy="548" rx="20" ry="12" fill="#8a5c38" opacity="0.8"/>
    </svg>`)

  for (const [name, buf] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), buf)
  }
  console.log(`Wrote ${Object.keys(files).length} fixtures to ${OUT}:`)
  for (const name of Object.keys(files)) console.log(`  ${name}`)
}

void main()
