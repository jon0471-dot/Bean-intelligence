/**
 * Fixture images for the LAXII/JAZMII restoration live runs (2026-11-14).
 * Deterministic synthetic samples — no user data, no downloaded media.
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

// 1) LAXII edit subject: a red circle on a two-tone background (768x768)
const editSvg = Buffer.from(`<svg width="768" height="768">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2b6cb0"/><stop offset="1" stop-color="#1a365d"/>
  </linearGradient></defs>
  <rect width="768" height="768" fill="url(#bg)"/>
  <circle cx="384" cy="384" r="170" fill="#e53e3e"/>
  <circle cx="384" cy="384" r="170" fill="none" stroke="#feb2b2" stroke-width="10"/>
</svg>`)
const editPng = await sharp(editSvg).png().toBuffer()
writeFileSync('scripts/laxii-jazmii-restore-out/fixture-edit.png', editPng)

// 2) Background-removal subject: a distinct object on a plain background (640x640)
const bgSvg = Buffer.from(`<svg width="640" height="640">
  <rect width="640" height="640" fill="#e9ecef"/>
  <ellipse cx="320" cy="420" rx="150" ry="60" fill="#dee2e6"/>
  <path d="M320 140 C 250 200 240 300 320 380 C 400 300 390 200 320 140 Z" fill="#2f855a"/>
  <rect x="300" y="360" width="40" height="90" fill="#276749"/>
</svg>`)
const bgPng = await sharp(bgSvg).png().toBuffer()
writeFileSync('scripts/laxii-jazmii-restore-out/fixture-bgrem.png', bgPng)

// 3) JAZMII i2v reference: a landscape-style still (1024x576, inside 256..4096)
const i2vSvg = Buffer.from(`<svg width="1024" height="576">
  <rect width="1024" height="576" fill="#1a202c"/>
  <circle cx="820" cy="140" r="70" fill="#f6e05e"/>
  <rect x="0" y="420" width="1024" height="156" fill="#2f855a"/>
  <path d="M0 420 L 200 300 L 420 420 Z" fill="#4a5568"/>
  <path d="M300 420 L 560 260 L 820 420 Z" fill="#2d3748"/>
</svg>`)
const i2vJpg = await sharp(i2vSvg).jpeg({ quality: 92 }).toBuffer()
writeFileSync('scripts/laxii-jazmii-restore-out/fixture-i2v.jpg', i2vJpg)

// 4) Enhancement input: small, slightly noisy photo-like gradient (512x512)
const enhSvg = Buffer.from(`<svg width="512" height="512">
  <defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8">
    <stop offset="0" stop-color="#fbd38d"/><stop offset="1" stop-color="#9c4221"/>
  </radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <rect x="80" y="300" width="352" height="120" fill="#744210" opacity="0.8"/>
</svg>`)
const enhPng = await sharp(enhSvg).png().toBuffer()
writeFileSync('scripts/laxii-jazmii-restore-out/fixture-enhance.png', enhPng)

console.log('fixtures written')
