/**
 * M26.1 — Per-file quarantine record (task §4): every file preserved on the
 * LOCAL backup refs, with path, class, sensitivity, PII/secrets flag,
 * staleness, future-milestone tag and retention verdict. No file content.
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REF = 'backup/m26-baseline-auto-commit'
const diff = execSync(`git diff --name-status main ${REF}`, { encoding: 'utf8' })
const added = diff.split('\n').filter((l) => l.startsWith('A\t')).map((l) => l.slice(2))

function classify(p: string) {
  const rules: Array<[RegExp, string, string, string]> = [
    // pattern, classification, sensitivity, milestone
    [/github_device_code/, 'credential artifact', 'SECRET', 'never ship'],
    [/db\/backups\/.*custom\.db$/, 'database snapshot', 'SECRET-ADJACENT (user hashes + plaintext tokens possible)', 'never ship'],
    [/env\.snapshot/, 'environment snapshot', 'LOW (DATABASE_URL only, verified)', 'never ship'],
    [/^docs\/evidence\//, 'evidence documentation', 'LOW (artifact digests)', 'M26+ evidence'],
    [/^docs\/infrastructure\//, 'infrastructure planning doc', 'LOW (placeholder URLs only)', 'future milestone'],
    [/^docs\/reports\//, 'milestone report doc', 'LOW', 'future milestone'],
    [/workspace/, 'workspace feature (S-1 quarantine)', 'MEDIUM (unreleased, zero-tenancy design)', 'future milestone — rebuild with P0 requirements'],
    [/wan22/, 'hardware-gated worker config', 'LOW', 'future milestone (hardware-gated)'],
    [/staging/, 'Postgres staging tooling', 'LOW (placeholder connection strings)', 'future milestone (PG cutover)'],
    [/loadtest/, 'load-test artifact', 'LOW', 'discardable'],
    [/login\.json$/, 'auth response capture', 'PII-LOW (test-account ids/emails)', 'discardable'],
    [/cookie/i, 'session cookie jar', 'SECRET (session token)', 'discardable after history rewrite'],
    [/^scripts\/e2e-out\/(c2|cg-ck2?|pipeline-ck2?|uc1|uc2)\.txt$/, 'session cookie jar (non-cookie name)', 'SECRET (session token)', 'discardable after history rewrite'],
    [/-out\//, 'live-run output artifact', 'LOW-MEDIUM', 'discardable'],
    [/^workers\//, 'worker configuration', 'LOW', 'future milestone'],
    [/^src\//, 'application WIP', 'LOW', 'future milestone'],
    [/^tests\//, 'test WIP', 'LOW', 'future milestone'],
    [/^scripts\//, 'operational script WIP', 'LOW', 'future milestone'],
    [/^validation\//, 'validation WIP', 'LOW', 'future milestone'],
    [/^db\//, 'database artifact', 'SECRET-ADJACENT', 'never ship'],
  ]
  for (const [re, cls, sens, ms] of rules) {
    if (re.test(p)) return { cls, sens, ms }
  }
  return { cls: 'general WIP', sens: 'LOW', ms: 'future milestone' }
}

const rows = added.map((p) => {
  const { cls, sens, ms } = classify(p)
  const secret = /SECRET/.test(sens) ? 'YES' : /PII/.test(sens) ? 'PII-ONLY' : 'no'
  const stale = /(-out\/|login\.json|cookie|\.db$|env\.snapshot|device_code)/.test(p) ? 'yes (point-in-time artifact)' : 'unknown (unreviewed WIP)'
  const retain = /SECRET/.test(sens)
    ? 'RETAIN on LOCAL refs only — never release'
    : 'RETAIN (unreviewed WIP — no deletion without owner review)'
  return `| \`${p}\` | quarantined (on ${REF}) | ${cls} | ${sens} | ${secret} | ${stale} | ${ms} | ${retain} |`
})

const header = `# M26.1 Quarantine Inventory (per-file record)

Scope: the 153 files ADDED by the auto-commit \`f0b47ad\` relative to \`main\`,
preserved verbatim on LOCAL-ONLY ref \`backup/m26-baseline-auto-commit\`
(verified never pushed: not reachable from \`origin/main\` or
\`origin/feat/laxii-jazmii-restoration\`). Plus the full 211-file diff vs
\`main\` includes 58 files that exist on main but differ on the backup line
(historical versions) — those are the pre-M26 states of already-shipped
files, benign by the M26.1 history scan.

No file value is reproduced — paths and classifications only.

| Path | Git status | Classification | Sensitivity | Secrets/PII | Incomplete/stale | Future milestone | Retention |
|---|---|---|---|---|---|---|---|
`

writeFileSync('/home/z/my-project/docs/M26_1_QUARANTINE_INVENTORY.md', header + rows.join('\n') + '\n')
console.log(`wrote ${rows.length} rows to docs/M26_1_QUARANTINE_INVENTORY.md`)
