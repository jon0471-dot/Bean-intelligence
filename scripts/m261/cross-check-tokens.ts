/**
 * M26.1 — Cross-check: are the 7 HEAD tokens part of the 30 historical jar
 * tokens or 7 NEW ones? And inspect historical verify.db blobs (redacted).
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createHash } from 'crypto'

function h(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

// ---- A. token overlap --------------------------------------------------------
const jarTokens = new Map<string, string>() // hash -> path
const jars = execSync(`git ls-tree -r b0b03da --name-only`, { encoding: 'utf8' })
  .split('\n')
  .filter((p) => /cookie/i.test(p))
for (const jar of jars) {
  const content = execSync(`git show "b0b03da:${jar}"`, { encoding: 'utf8' })
  const m = content.match(/bean_session[\t\s=:]+([0-9a-f]{64})/i)
  if (m) jarTokens.set(h(m[1]), jar)
}

const headFiles = ['c2.txt', 'cg-ck.txt', 'cg-ck2.txt', 'pipeline-ck.txt', 'pipeline-ck2.txt', 'uc1.txt', 'uc2.txt']
console.log('=== A. overlap between HEAD tokens and history jar tokens ===')
let overlap = 0
for (const f of headFiles) {
  const content = execSync(`git show "HEAD:scripts/e2e-out/${f}"`, { encoding: 'utf8' })
  const m = content.match(/bean_session[\t\s=:]+([0-9a-f]{64})/i)
  if (!m) continue
  const hh = h(m[1])
  const inJars = jarTokens.has(hh)
  if (inJars) overlap++
  console.log(`  e2e-out/${f}: token-hash ${hh} — ${inJars ? 'ALSO in a history jar (' + jarTokens.get(hh) + ')' : 'NEW (not among the 30)'} | matches current DB? sessions=0 so invalid`)
}
console.log(`  overlap: ${overlap}/7; TOTAL distinct exposed tokens: ${jarTokens.size + (7 - overlap)}`)

// ---- B. historical verify.db contents ----------------------------------------
console.log('\n=== B. verify.db blobs in published history (redacted) ===')
for (const p of ['scripts/e2e-verify-out/verify.db', 'scripts/giftz-verify-out/verify.db']) {
  // find the blob: use rev-list objects on origin/main
  const out = execSync(`git rev-list --objects origin/main -- "${p}"`, { encoding: 'utf8', maxBuffer: 32e6 })
  const lines = out.split('\n').filter((l) => l.endsWith(p))
  if (lines.length === 0) {
    console.log(`  ${p}: no blobs in origin/main history`)
    continue
  }
  for (const line of lines.slice(0, 3)) {
    const sha = line.split(' ')[0]
    try {
      execSync(`git cat-file blob ${sha} > /tmp/m261-verifydb.bin`, { maxBuffer: 32e6 })
      const info = execSync(
        `bun -e "import{Database} from 'bun:sqlite';const d=new Database('/tmp/m261-verifydb.bin',{readonly:true});const t=d.prepare(\\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\\").all().map(r=>r.name);console.log('tables:',t.join(','));for(const tb of ['Session','User']){if(t.includes(tb)){console.log(tb+' rows:',d.prepare('SELECT COUNT(*) c FROM '+tb).get().c)}};d.close()"`,
        { encoding: 'utf8' },
      )
      console.log(`  ${p} blob ${sha.slice(0, 10)} (${execSync(`git cat-file -s ${sha}`).trim()} bytes): ${info.trim().replace(/\n/g, ' | ')}`)
    } catch (e) {
      console.log(`  ${p} blob ${sha.slice(0, 10)}: unreadable (${String(e).slice(0, 80)})`)
    }
  }
}

// ---- C. what else lives in scripts/e2e-out at HEAD ---------------------------
console.log('\n=== C. scripts/e2e-out contents at HEAD ===')
const e2eout = execSync(`git ls-tree HEAD scripts/e2e-out --name-only`, { encoding: 'utf8' })
console.log(e2eout.trim())
