/**
 * M26.1 — Classify each secret-scan hit (values NEVER printed).
 * Categories: HEAD session tokens, verify.db session/user rows, JSON dump
 * token fields, evidence file hashes, test fixtures, placeholder literals.
 */
import { execSync } from 'node:child_process'

function sha256(s: string): string {
  // tiny sync hash via crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto')
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

console.log('=== 1. The 7 HEAD token files — distinct tokens + validity ===')
const headFiles = [
  'scripts/e2e-out/c2.txt',
  'scripts/e2e-out/cg-ck.txt',
  'scripts/e2e-out/cg-ck2.txt',
  'scripts/e2e-out/pipeline-ck.txt',
  'scripts/e2e-out/pipeline-ck2.txt',
  'scripts/e2e-out/uc1.txt',
  'scripts/e2e-out/uc2.txt',
]
const headTokens = new Set<string>()
for (const f of headFiles) {
  const content = execSync(`git show "HEAD:${f}"`, { encoding: 'utf8' })
  const m = content.match(/bean_session[\t\s=:]+([0-9a-f]{64})/i)
  if (m) {
    headTokens.add(m[1])
    console.log(`  ${f}: token#hash ${sha256(m[1])}, file lines: ${content.split('\n').length}`)
  } else {
    console.log(`  ${f}: pattern found but no bean_session capture`)
  }
}
console.log(`  distinct tokens in HEAD: ${headTokens.size}`)

console.log('\n=== 2. verify.db blobs in history — Session/User rows (redacted) ===')
for (const p of ['scripts/e2e-verify-out/verify.db', 'scripts/giftz-verify-out/verify.db']) {
  try {
    const sha = execSync(`git rev-parse "HEAD:${p}"`, { encoding: 'utf8' }).trim()
    execSync(`git cat-file blob ${sha} > /tmp/m261-verifydb.bin`)
    const out = execSync(
      `bun -e "import{Database} from 'bun:sqlite';const d=new Database('/tmp/m261-verifydb.bin',{readonly:true});const t=d.prepare(\\"SELECT name FROM sqlite_master WHERE type='table'\\").all().map(r=>r.name);console.log('tables:',t.join(','));if(t.includes('Session'))console.log('Session rows:',d.prepare('SELECT COUNT(*) c FROM Session').get().c);if(t.includes('User'))console.log('User rows:',d.prepare('SELECT COUNT(*) c FROM User').get().c);d.close()"`,
      { encoding: 'utf8' },
    )
    console.log(`  ${p} (HEAD): ${out.trim().replace(/\n/g, ' | ')}`)
  } catch (e) {
    console.log(`  ${p}: not in HEAD (${String(e).slice(0, 60)})`)
  }
}

console.log('\n=== 3. db-*.json dumps — token-shaped fields ===')
for (const p of [
  'scripts/e2e-verify-out/db-after-real.json',
  'scripts/e2e-verify-out/db-after-verify.json',
  'scripts/e2e-verify-out/db-before.json',
]) {
  const content = execSync(`git show "HEAD:${p}"`, { encoding: 'utf8' })
  try {
    const j = JSON.parse(content)
    const topKeys = Object.keys(j)
    // find which keys hold 64-hex values (names only)
    const hexKeys: string[] = []
    const walk = (o: unknown, path: string): void => {
      if (o == null || typeof o !== 'object') return
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) hexKeys.push(path + k)
        else if (typeof v === 'object') walk(v, path + k + '.')
      }
    }
    walk(j, '')
    console.log(`  ${p}: topKeys=${topKeys.join(',')} | 64-hex under: ${hexKeys.slice(0, 5).join(', ') || '-'}${hexKeys.length > 5 ? ` (+${hexKeys.length - 5} more)` : ''}`)
  } catch {
    console.log(`  ${p}: not JSON (${content.length} bytes)`)
  }
}

console.log('\n=== 4. evidence/validation 64-hex hits — file hashes or tokens? ===')
for (const p of [
  'docs/evidence/bean-optrans-acceptance.txt',
  'scripts/post-quota-acceptance-out/artifacts/hashes.txt',
  'validation/m24/reports/acceptance.json',
]) {
  const content = execSync(`git show "HEAD:${p}"`, { encoding: 'utf8' })
  const hexLines = content.split('\n').filter((l) => /\b[0-9a-f]{64}\b/.test(l)).slice(0, 3)
  const redacted = hexLines.map((l) =>
    l.replace(/[0-9a-f]{64}/g, (h) => `<64hex:${sha256(h)}>`),
  )
  console.log(`  ${p}:`)
  for (const l of redacted) console.log(`    ${l.slice(0, 110)}`)
}

console.log('\n=== 5. test/fixture literals — live or throwaway? ===')
{
  const c = execSync(`git show "HEAD:scripts/giftz-sec-e2e.ts"`, { encoding: 'utf8' })
  const m = c.match(/bgk_[A-Za-z0-9]{20,}/)
  const ctx = c.split('\n').findIndex((l) => l.includes('bgk_'))
  console.log(
    `  giftz-sec-e2e.ts: bgk_ hit at line ${ctx + 1}: "${c.split('\n')[ctx].trim().slice(0, 80).replace(/bgk_[A-Za-z0-9]+/, 'bgk_<REDACTED>')}"`,
  )
}
{
  const c = execSync(`git show "HEAD:scripts/w5-security-sweep.sh"`, { encoding: 'utf8' })
  const line = c.split('\n').find((l) => /BEAN_CREDENTIALS_MASTER_KEY\s*[:=]/.test(l)) ?? ''
  console.log(`  w5-security-sweep.sh: ${line.trim().slice(0, 100).replace(/'[^']{8,}'/, "'<REDACTED>'")}`)
}
{
  const c = execSync(`git show "HEAD:tests/unit/security-crypto.test.ts"`, { encoding: 'utf8' })
  const line = c.split('\n').find((l) => /BEAN_CREDENTIALS_MASTER_KEY\s*[:=]/.test(l)) ?? ''
  console.log(`  security-crypto.test.ts: ${line.trim().slice(0, 100).replace(/'[^']{8,}'/, "'<TESTVECTOR>'")}`)
}
