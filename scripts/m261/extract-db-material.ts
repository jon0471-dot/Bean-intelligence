/**
 * M26.1 — Extract redacted session/user material hashes from a SQLite file.
 * Usage: bun run scripts/m261/extract-db-material.ts <dbfile>
 * Prints JSON with HASHES only — no token/email values.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { statSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: extract-db-material.ts <dbfile>')
  process.exit(1)
}
const size = statSync(file).size
const h = (s: unknown): string => createHash('sha256').update(String(s)).digest('hex').slice(0, 16)

const d = new Database(file, { readonly: true })
const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name as string)
const out: {
  sessions: number
  users: number
  apiKeys: number
  messages: number
  tokens: Array<{ h: string; exp: number; expired: boolean }>
  emails: string[]
  uids: string[]
  keyPrefixes: string[]
  rawKeyCount: number
} = { sessions: 0, users: 0, apiKeys: 0, messages: 0, tokens: [], emails: [], uids: [], keyPrefixes: [], rawKeyCount: 0 }

const has = (n: string): boolean => tables.includes(n)
const now = Date.now()

if (has('Session')) {
  out.sessions = d.prepare('SELECT COUNT(*) c FROM Session').get().c as number
  for (const r of d.prepare('SELECT token, userId, expiresAt FROM Session').all() as Array<{ token: string; userId: string; expiresAt: number | string }>) {
    const exp = typeof r.expiresAt === 'number' ? r.expiresAt : Date.parse(String(r.expiresAt))
    out.tokens.push({ h: h(r.token), exp: Number.isFinite(exp) ? exp : -1, expired: Number.isFinite(exp) ? exp < now : true })
    out.uids.push(h(r.userId))
  }
}
if (has('User')) {
  out.users = d.prepare('SELECT COUNT(*) c FROM User').get().c as number
  for (const r of d.prepare('SELECT id, email, passwordHash FROM User').all() as Array<{ id: string; email: string; passwordHash: string }>) {
    out.emails.push(h(r.email))
    out.uids.push(h(r.id))
    if (r.passwordHash && !r.passwordHash.startsWith('scrypt') && r.passwordHash.length < 100) {
      out.rawKeyCount++ // anomaly: non-scrypt credential shape
    }
  }
}
if (has('ApiKey')) {
  out.apiKeys = d.prepare('SELECT COUNT(*) c FROM ApiKey').get().c as number
  for (const r of d.prepare('SELECT prefix FROM ApiKey').all() as Array<{ prefix: string }>) {
    out.keyPrefixes.push(r.prefix)
  }
}
if (has('Message')) out.messages = d.prepare('SELECT COUNT(*) c FROM Message').get().c as number

d.close()
console.log(JSON.stringify(out))
