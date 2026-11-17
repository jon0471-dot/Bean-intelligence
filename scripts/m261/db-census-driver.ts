/**
 * M26.1 — Census driver: for every published DB blob, extract redacted
 * material and aggregate distinct exposure counts. Values never printed.
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const refs = ['origin/main', 'origin/feat/laxii-jazmii-restoration']
const dbBlobs = new Map<string, string>()
for (const ref of refs) {
  const out = execSync(`git rev-list --objects ${ref}`, { encoding: 'utf8', maxBuffer: 64e6 })
  for (const line of out.split('\n')) {
    const [sha, ...rest] = line.split(' ')
    if (!sha || rest.length === 0) continue
    const p = rest.join(' ')
    if (/\.(db|sqlite|sqlite3)$/i.test(p) && !dbBlobs.has(sha)) dbBlobs.set(sha, p)
  }
}

const tokenHashes = new Map<string, Set<string>>() // hash -> blob set
const unexpiredTokens = new Map<string, Set<string>>()
const emails = new Set<string>()
const uids = new Set<string>()
const keyPrefixes = new Set<string>()
let totalSessions = 0
let totalUsers = 0
let totalApiKeys = 0
let totalMessages = 0

for (const [sha, path] of dbBlobs) {
  execSync(`git cat-file blob ${sha} > /tmp/m261-census.db`, { maxBuffer: 64e6 })
  const raw = execSync(`bun run scripts/m261/extract-db-material.ts /tmp/m261-census.db`, {
    encoding: 'utf8',
    maxBuffer: 32e6,
  })
  const j = JSON.parse(raw.trim().split('\n').pop()!) as {
    sessions: number
    users: number
    apiKeys: number
    messages: number
    tokens: Array<{ h: string; expired: boolean }>
    emails: string[]
    uids: string[]
    keyPrefixes: string[]
  }
  console.log(`${path} [${sha.slice(0, 10)}]: sessions=${j.sessions} users=${j.users} apiKeys=${j.apiKeys} messages=${j.messages}`)
  totalSessions += j.sessions
  totalUsers += j.users
  totalApiKeys += j.apiKeys
  totalMessages += j.messages
  for (const t of j.tokens) {
    if (!tokenHashes.has(t.h)) tokenHashes.set(t.h, new Set())
    tokenHashes.get(t.h)!.add(sha.slice(0, 8))
    if (!t.expired) {
      if (!unexpiredTokens.has(t.h)) unexpiredTokens.set(t.h, new Set())
      unexpiredTokens.get(t.h)!.add(sha.slice(0, 8))
    }
  }
  for (const e of j.emails) emails.add(e)
  for (const u of j.uids) uids.add(u)
  for (const k of j.keyPrefixes) keyPrefixes.add(k)
}

console.log('\n=== aggregate ===')
console.log(`DB blobs: ${dbBlobs.size}`)
console.log(`session rows (with duplicates across snapshots): ${totalSessions}`)
console.log(`DISTINCT session tokens: ${tokenHashes.size}`)
console.log(`  of which NOT expired by wall clock: ${unexpiredTokens.size}`)
console.log(`distinct user emails (hashed): ${emails.size}`)
console.log(`distinct user/account ids (hashed): ${uids.size}`)
console.log(`distinct API-key prefixes: ${keyPrefixes.size}`)
console.log(`message rows total: ${totalMessages}`)
void totalApiKeys

writeFileSync(
  '/tmp/m261-exposure-aggregate.json',
  JSON.stringify(
    {
      dbBlobs: [...dbBlobs.entries()].map(([s, p]) => ({ sha: s.slice(0, 12), path: p })),
      distinctTokens: tokenHashes.size,
      unexpiredTokens: unexpiredTokens.size,
      distinctEmailHashes: emails.size,
      distinctUidHashes: uids.size,
      distinctKeyPrefixes: [...keyPrefixes],
    },
    null,
    2,
  ),
)
console.log('\naggregate written to /tmp/m261-exposure-aggregate.json')
