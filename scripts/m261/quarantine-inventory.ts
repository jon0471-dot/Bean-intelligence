/**
 * M26.1 — Quarantine inventory: classify every file in the preserved backup
 * refs (quarantined WIP) versus main HEAD. Redacted scan for secrets/PII.
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REF = 'backup/m26-baseline-auto-commit'

// Files present in REF but not in main (added by the auto-commit line)
const diff = execSync(`git diff --name-status main ${REF}`, { encoding: 'utf8' })
const added = diff
  .split('\n')
  .filter((l) => l.startsWith('A\t'))
  .map((l) => l.slice(2))

// Sensitive-path patterns
const SENSITIVE = [
  { re: /github_device_code/, why: 'GitHub device code (M25: sensitive, never commit)' },
  { re: /db\/backups\//, why: 'DB snapshot (may contain user hashes + plaintext session tokens)' },
  { re: /env\.snapshot/, why: 'environment snapshot' },
  { re: /cookie/i, why: 'session cookie jar' },
  { re: /login\.json$/, why: 'auth response (account ids/emails)' },
  { re: /\.env/, why: 'env file' },
  { re: /staging/, why: 'Postgres staging tooling / connection strings' },
  { re: /workspace/, why: 'quarantined workspace feature (S-1)' },
  { re: /wan22/, why: 'hardware-gated worker config' },
  { re: /-out\//, why: 'live-run artifact output' },
  { re: /loadtest/, why: 'load-test artifacts' },
  { re: /verify\.db|\.db$/, why: 'database file' },
]

// Secret-shaped content patterns to scan within blob content
const SECRET_PATTERNS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i, 'postgres URL with credentials'],
  [/mysql:\/\/[^\s"']+:[^\s"']+@/i, 'mysql URL with credentials'],
  [/sk-[A-Za-z0-9]{16,}/, 'OpenAI-style key'],
  [/ghp_[A-Za-z0-9]{20,}/, 'GitHub PAT'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/bean_session[\s=:]+[0-9a-f]{64}/i, 'bean_session token'],
  [/bearer\s+[A-Za-z0-9._-]{20,}/i, 'bearer token literal'],
  [/api[_-]?key\s*[:=]\s*['"][A-Za-z0-9._-]{16,}['"]/i, 'api key literal'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address (PII)'],
  [/bgk_[A-Za-z0-9]{16,}/, 'BEAN API key'],
]

const rows: string[] = []
const summary: Record<string, number> = {}
let secretHits = 0

for (const p of added) {
  let blob = ''
  try {
    blob = execSync(`git show "${REF}:${p}"`, { encoding: 'utf8', maxBuffer: 4e6 })
  } catch {
    rows.push(`| \`${p}\` | (binary/unreadable) | | | |`)
    continue
  }
  const hits: string[] = []
  for (const [re, name] of SECRET_PATTERNS) {
    if (re.test(blob)) hits.push(name)
  }
  const sensitiveTags = SENSITIVE.filter((s) => s.re.test(p)).map((s) => s.why.split(' ')[0])
  if (hits.length > 0) secretHits++
  const cls = sensitiveTags.length > 0 ? sensitiveTags.join(',') : 'general-wip'
  summary[cls] = (summary[cls] ?? 0) + 1
  rows.push(
    `| \`${p}\` | ${cls || '-'} | ${hits.length > 0 ? hits.map((h) => 'YES:' + h).join(', ') : '-'} | ${blob.split('\n').length} lines |`,
  )
}

console.log(`Added-in-REF files: ${added.length}`)
console.log(`Files with secret/PII-shaped content: ${secretHits}`)
console.log('\nClassification summary:')
for (const [k, v] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`)
}
writeFileSync(
  '/tmp/m261-quarantine-inventory.md',
  `| path | classification | secret/PII content (redacted) | size |\n|---|---|---|---|\n${rows.join('\n')}\n`,
)
console.log('\nFull inventory written to /tmp/m261-quarantine-inventory.md')
