/**
 * M26.1 — Secret scanning: working tree + published git history.
 * Matches are reported as counts and (path, pattern-kind) pairs only.
 * Matched VALUES are never printed.
 */
import { execSync } from 'node:child_process'

const PATTERNS: Array<[RegExp, string]> = [
  [/bean_session[\t\s=:]+[0-9a-f]{64}/gi, 'bean_session token'],
  [/\b[0-9a-f]{64}\b/g, '64-hex blob (session-token shape)'],
  [/postgres(?:ql)?:\/\/[^\s"'<]+:[^@\s"'<]+@/gi, 'postgres URL with creds'],
  [/mysql:\/\/[^\s"'<]+:[^@\s"'<]+@/gi, 'mysql URL with creds'],
  [/sk-[A-Za-z0-9]{16,}/g, 'OpenAI-style key'],
  [/ghp_[A-Za-z0-9]{20,}/g, 'GitHub PAT'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'GitHub fine-grained PAT'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS access key id'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'private key block'],
  [/xox[bap]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/AIza[0-9A-Za-z_-]{30,}/g, 'Google API key'],
  [/bgk_[A-Za-z0-9]{20,}/g, 'BEAN API key (raw)'],
  [/BEAN_CREDENTIALS_MASTER_KEY\s*[:=]\s*['"][^'"]{8,}['"]/g, 'vault master key literal'],
]

function scanBlob(name: string, content: string): Array<[string, number]> {
  const hits: Array<[string, number]> = []
  for (const [re, kind] of PATTERNS) {
    const m = content.match(re)
    if (m && m.length > 0) hits.push([kind, m.length])
  }
  return hits
}

// ---- 1. working tree: tracked files -----------------------------------------
console.log('=== WORKING TREE SCAN (tracked files) ===')
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
let trackedHits = 0
const trackedKinds: Record<string, number> = {}
for (const f of tracked) {
  let content = ''
  try {
    content = execSync(`git show "HEAD:${f}"`, { encoding: 'utf8', maxBuffer: 4e6 })
  } catch {
    continue // binary or missing
  }
  for (const [kind, n] of scanBlob(f, content)) {
    trackedHits++
    trackedKinds[kind] = (trackedKinds[kind] ?? 0) + 1
    console.log(`  HIT ${kind} x${n}: ${f}`)
  }
}
console.log(`tracked files scanned: ${tracked.length}, pattern hits: ${trackedHits}`)
console.log('kinds:', JSON.stringify(trackedKinds))

// ---- 2. working tree: untracked-but-not-ignored ------------------------------
console.log('\n=== WORKING TREE SCAN (untracked, not ignored) ===')
const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
let untrackedHits = 0
for (const f of untracked) {
  let content = ''
  try {
    content = execSync(`cat "${f}"`, { encoding: 'utf8', maxBuffer: 4e6 })
  } catch {
    continue
  }
  for (const [kind, n] of scanBlob(f, content)) {
    untrackedHits++
    console.log(`  HIT ${kind} x${n}: ${f}`)
  }
}
console.log(`untracked files scanned: ${untracked.length}, pattern hits: ${untrackedHits}`)

// ---- 3. published history: every unique blob reachable from remote refs ------
console.log('\n=== PUBLISHED HISTORY SCAN (origin/main + origin/feat/*) ===')
const blobSet = new Map<string, string[]>() // blobSha -> first paths
for (const ref of ['origin/main', 'origin/feat/laxii-jazmii-restoration']) {
  const out = execSync(`git rev-list --objects ${ref}`, { encoding: 'utf8', maxBuffer: 64e6 })
  for (const line of out.split('\n')) {
    const [sha, ...rest] = line.split(' ')
    if (!sha || rest.length === 0) continue
    if (!blobSet.has(sha)) blobSet.set(sha, [rest.join(' ')])
  }
}
console.log(`unique blobs with paths reachable from remote refs: ${blobSet.size}`)
let historyHits = 0
const historyKinds: Record<string, number> = {}
const historyHitFiles: string[] = []
let scanned = 0
const shaList = [...blobSet.keys()]
const BATCH = 4000
for (let i = 0; i < shaList.length; i += BATCH) {
  const batch = shaList.slice(i, i + BATCH)
  let out = ''
  try {
    out = execSync(`git cat-file --batch-check='%(objectname) %(objecttype)'`, {
      input: batch.join('\n') + '\n',
      encoding: 'utf8',
      maxBuffer: 8e6,
    })
  } catch {
    continue
  }
  for (const line of out.split('\n')) {
    const [sha, type] = line.split(' ')
    if (type !== 'blob') continue
    const paths = blobSet.get(sha) ?? []
    let content = ''
    try {
      content = execSync(`git cat-file blob ${sha}`, { encoding: 'utf8', maxBuffer: 4e6 })
    } catch {
      continue
    }
    scanned++
    const hits = scanBlob(paths[0] ?? sha, content)
    if (hits.length > 0) {
      historyHits++
      for (const [kind, n] of hits) historyKinds[kind] = (historyKinds[kind] ?? 0) + 1
      historyHitFiles.push(...paths)
    }
  }
}
console.log(`history blobs scanned: ${scanned}, blobs with hits: ${historyHits}`)
console.log('kinds:', JSON.stringify(historyKinds))
const uniqHitFiles = [...new Set(historyHitFiles)]
console.log(`unique affected paths: ${uniqHitFiles.length}`)
for (const p of uniqHitFiles.slice(0, 60)) console.log(`  ${p}`)
