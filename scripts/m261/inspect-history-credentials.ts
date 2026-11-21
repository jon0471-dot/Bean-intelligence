/**
 * M26.1 — Inspect historical git-tree files for credential-shaped content.
 * Values are NEVER printed; only key names, value lengths and shapes.
 */
import { execSync } from 'node:child_process'

const ref = process.argv[2] ?? 'b0b03da'
const paths = [
  'scripts/e2e-verify-out/login.json',
  'scripts/e2e-30q-out/login.json',
  'scripts/e2e-evalfix-out/login.json',
]

function redact(v: unknown, keyPath: string): string {
  if (v == null) return String(v)
  const s = String(v)
  if (s.length === 0) return '<empty>'
  const lower = keyPath.toLowerCase()
  const sensitive = /pass|token|secret|credential|email|user|auth/.test(lower)
  if (sensitive) return `REDACTED(len=${s.length})`
  if (s.length > 24) return `VALUE(len=${s.length})`
  return s
}

function walk(o: unknown, p: string): void {
  if (o == null || typeof o !== 'object') {
    console.log(`  ${p} = ${redact(o, p)}`)
    return
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    walk(v, p ? `${p}.${k}` : k)
  }
}

for (const f of paths) {
  let raw: string
  try {
    raw = execSync(`git show "${ref}:${f}"`, { encoding: 'utf8', maxBuffer: 1e6 })
  } catch {
    console.log(`--- ${f}: NOT PRESENT in ${ref} ---`)
    continue
  }
  console.log(`--- ${f} (in ${ref}) ---`)
  try {
    walk(JSON.parse(raw), '')
  } catch {
    console.log(`  (not JSON; ${raw.length} bytes, lines: ${raw.split('\n').length})`)
  }
}

// Cookie jar "by" field check — is it a fixed header or per-token data?
console.log('\n--- cookie "by" column shapes (b0b03da) ---')
const jars = execSync(`git ls-tree -r ${ref} --name-only`, { encoding: 'utf8' })
  .split('\n')
  .filter((p) => /cookie/i.test(p))
const byValues = new Set<string>()
for (const jar of jars) {
  const content = execSync(`git show "${ref}:${jar}"`, { encoding: 'utf8' })
  for (const line of content.split('\n')) {
    const cols = line.split('\t')
    if (cols.length >= 7 && cols[5] === 'by') byValues.add(cols[6].slice(0, 20))
  }
}
console.log(`  distinct "by" values (first 20 chars): ${byValues.size}`)
for (const v of [...byValues].slice(0, 3)) console.log(`  e.g. "${v}"`)

// Jar cookie expiry field (col 5) range for bean_session rows
console.log('\n--- bean_session cookie expiry range in jars ---')
const expiries: number[] = []
for (const jar of jars) {
  const content = execSync(`git show "${ref}:${jar}"`, { encoding: 'utf8' })
  for (const line of content.split('\n')) {
    const cols = line.split('\t')
    if (cols.length >= 7 && cols[5] === 'bean_session') {
      const e = Number(cols[4])
      if (Number.isFinite(e) && e > 0) expiries.push(e)
    }
  }
}
if (expiries.length > 0) {
  const min = new Date(Math.min(...expiries) * 1000)
  const max = new Date(Math.max(...expiries) * 1000)
  console.log(`  jar-token pairs with expiry: ${expiries.length}`)
  console.log(`  earliest expiry: ${min.toISOString()}`)
  console.log(`  latest expiry:   ${max.toISOString()}`)
} else {
  console.log('  no expiry timestamps present')
}
