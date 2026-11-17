/**
 * M26.1 — Compute the UNION of all exposed session-token identities across
 * (a) the 30 history cookie jars, (b) the 7 HEAD token files,
 * (c) the 143 tokens inside the 8 published DB snapshots.
 * Only hashes are handled/printed.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'crypto'
import { writeFileSync } from 'node:fs'

const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

const jarTokenHashes = new Set<string>()
for (const ref of ['b0b03da', 'HEAD']) {
  const paths = execSync(`git ls-tree -r ${ref} --name-only`, { encoding: 'utf8', maxBuffer: 8e6 })
    .split('\n')
    .filter((p) => /cookie/i.test(p) || /^scripts\/e2e-out\/(c2|cg-ck2?|pipeline-ck2?|uc1|uc2)\.txt$/.test(p))
  for (const p of paths) {
    const content = execSync(`git show "${ref}:${p}"`, { encoding: 'utf8' })
    const m = content.match(/bean_session[\t\s=:]+([0-9a-f]{64})/i)
    if (m) jarTokenHashes.add(h(m[1]))
  }
}

// DB-snapshot token hashes from the census
const census = JSON.parse(execSync(`cat /tmp/m261-exposure-aggregate.json`, { encoding: 'utf8' }))
void census

// Re-run the per-blob token extraction to get the actual hashes
const dbBlobs: Array<[string, string]> = [
  ['bc1aafa17481c1b61914ffb5d4b9cc977c1c173d', 'e2e-verify'],
  ['e870f7d852e21f5c114cef80875bfd63585c93d5', 'giftz-verify'],
  ['e0814f6b3fbf121cf9f4d9058128a67699b32b76', 'e2e-verify'],
  ['fc74c1994082f73c1fdb8e656e2b2c1f2573f9e6', 'giftz-verify'],
  ['5530bf3a8f42914773590a850820096e7a175bce', 'giftz-verify'],
  ['8fa3cf94a13bbd7518f31f3ca3e9b80fafbcbde6', 'e2e-verify'],
  ['a9a211ccf573f590a26ef8733821658419a25808', 'e2e-verify'],
  ['3229edc84e2059424d5af1db92a51c8509b11d25', 'e2e-verify'],
]

const dbTokenHashes = new Set<string>()
const dbEmailHashes = new Set<string>()
for (const [sha] of dbBlobs) {
  execSync(`git cat-file blob ${sha} > /tmp/m261-census.db`, { maxBuffer: 64e6 })
  const raw = execSync(`bun run scripts/m261/extract-db-material.ts /tmp/m261-census.db`, {
    encoding: 'utf8',
    maxBuffer: 32e6,
  })
  const j = JSON.parse(raw.trim().split('\n').pop()!) as {
    tokens: Array<{ h: string }>
    emails: string[]
  }
  for (const t of j.tokens) dbTokenHashes.add(t.h)
  for (const e of j.emails) dbEmailHashes.add(e)
}

const union = new Set([...jarTokenHashes, ...dbTokenHashes])
const overlap = [...jarTokenHashes].filter((t) => dbTokenHashes.has(t)).length

console.log(`jar/HEAD cookie tokens (distinct): ${jarTokenHashes.size}`)
console.log(`DB-snapshot tokens (distinct): ${dbTokenHashes.size}`)
console.log(`overlap between the two sets: ${overlap}`)
console.log(`UNION of exposed session tokens: ${union.size}`)
console.log(`distinct user emails in DB snapshots (hashed): ${dbEmailHashes.size}`)

writeFileSync(
  '/tmp/m261-union.json',
  JSON.stringify(
    {
      jarTokens: jarTokenHashes.size,
      dbTokens: dbTokenHashes.size,
      overlap,
      union: union.size,
      dbEmailHashes: [...dbEmailHashes].slice(0, 5),
      dbEmailCount: dbEmailHashes.size,
    },
    null,
    2,
  ),
)
console.log('written /tmp/m261-union.json')
