/**
 * M26.1 — Full census of SQLite DB blobs and session material in PUBLISHED
 * history (origin/main + origin/feat/*). Values never printed; hashes only.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'crypto'
import { writeFileSync } from 'node:fs'

function h(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

const refs = ['origin/main', 'origin/feat/laxii-jazmii-restoration']

console.log('=== every *.db / *.sqlite / *.sqlite3 blob in published history ===')
const dbBlobs = new Map<string, string>() // blobSha -> path
for (const ref of refs) {
  const out = execSync(`git rev-list --objects ${ref}`, { encoding: 'utf8', maxBuffer: 64e6 })
  for (const line of out.split('\n')) {
    const [sha, ...rest] = line.split(' ')
    if (!sha || rest.length === 0) continue
    const p = rest.join(' ')
    if (/\.(db|sqlite|sqlite3)$/i.test(p) && !dbBlobs.has(sha)) dbBlobs.set(sha, p)
  }
}
console.log(`distinct DB blobs: ${dbBlobs.size}`)
const byPath: Record<string, number> = {}
for (const [, p] of dbBlobs) byPath[p] = (byPath[p] ?? 0) + 1
for (const [p, n] of Object.entries(byPath).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p}: ${n} distinct blob(s)`)
}

console.log('\n=== Session/User/ApiKey content per DB blob (redacted) ===')
const allTokens = new Map<string, string[]>() // tokenHash -> [blobShort, ...]
const allEmails = new Set<string>()
const allKeyPrefixes = new Set<string>()
const allUserIds = new Set<string>()
let maxSession = 0
for (const [sha, path] of dbBlobs) {
  try {
    execSync(`git cat-file blob ${sha} > /tmp/m261-census.db`, { maxBuffer: 64e6 })
    const size = Number(execSync(`git cat-file -s ${sha}`).trim())
    const info = execSync(
      `bun -e "
import{Database} from 'bun:sqlite';
const d=new Database('/tmp/m261-census.db',{readonly:true});
const t=d.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name);
const has=(n)=>t.includes(n);
let out=[];
if(has('Session')){out.push('sessions='+d.prepare('SELECT COUNT(*) c FROM Session').get().c)}
if(has('User')){out.push('users='+d.prepare('SELECT COUNT(*) c FROM User').get().c)}
if(has('ApiKey')){out.push('apikeys='+d.prepare('SELECT COUNT(*) c FROM ApiKey').get().c)}
if(has('Message')){out.push('messages='+d.prepare('SELECT COUNT(*) c FROM Message').get().c)}
console.log(out.join(' '));
d.close()"`,
      { encoding: 'utf8' },
    ).trim()
    console.log(`  ${path} [${sha.slice(0, 10)}, ${(size / 1024).toFixed(0)}KB]: ${info}`)
    maxSession = Math.max(maxSession, Number(/sessions=(\d+)/.exec(info)?.[1] ?? 0))

    // extract tokens/emails/keys into hashes only
    const rows = execSync(
      `bun -e "
import{Database} from 'bun:sqlite';
import{createHash} from 'crypto';
const h=(s)=>createHash('sha256').update(s).digest('hex').slice(0,16);
const d=new Database('/tmp/m261-census.db',{readonly:true});
const t=d.prepare(\\"SELECT name FROM sqlite_master WHERE type='table'\\").all().map(r=>r.name);
const out={tokens:[],emails:[],prefixes:[],uids:[]};
if(t.includes('Session')){for(const r of d.prepare('SELECT token,userId,expiresAt FROM Session').all()){out.tokens.push(JSON.stringify({h:h(r.token),exp:r.expiresAt,uid:h(r.userId)}))}}
if(t.includes('User')){for(const r of d.prepare('SELECT id,email FROM User').all()){out.emails.push(JSON.stringify({e:h(r.email),uid:h(r.id)}));out.uids.push(h(r.id))}}
if(t.includes('ApiKey')){for(const r of d.prepare('SELECT prefix,userId FROM ApiKey').all()){out.prefixes.push(r.prefix)}}
console.log(JSON.stringify(out));d.close()"`,
      { encoding: 'utf8', maxBuffer: 32e6 },
    )
    const parsed = JSON.parse(info ? rows : '{}') as {
      tokens?: Array<{ h: string; exp: string; uid: string }>
      emails?: Array<{ e: string; uid: string }>
      prefixes?: string[]
      uids?: string[]
    }
    for (const tk of parsed.tokens ?? []) {
      if (!allTokens.has(tk.h)) allTokens.set(tk.h, [])
      allTokens.get(tk.h)!.push(sha.slice(0, 8))
    }
    for (const em of parsed.emails ?? []) allEmails.add(em.e)
    for (const uid of parsed.uids ?? []) allUserIds.add(uid)
    for (const px of parsed.prefixes ?? []) allKeyPrefixes.add(px)
  } catch (e) {
    console.log(`  ${path} [${sha.slice(0, 10)}]: unreadable`)
  }
}

console.log(`\nmax sessions in one snapshot: ${maxSession}`)
console.log(`DISTINCT session tokens across all published DB blobs: ${allTokens.size}`)
let expired = 0
let future = 0
const now = Date.now()
for (const [, blobs] of allTokens) void blobs
const expRaw = execSync(`echo ok`)
void expRaw
console.log(`distinct user emails (hashed): ${allEmails.size}`)
console.log(`distinct user ids (hashed): ${allUserIds.size}`)
console.log(`distinct API-key prefixes present: ${allKeyPrefixes.size} (sample count only)`)

// expiry distribution (from the session rows themselves)
console.log('\n=== session expiry distribution across published DB blobs ===')
const expCounts = execSync(
  `bun -e "
import{Database} from 'bun:sqlite';
const d=new Database('/tmp/m261-census.db',{readonly:true});
void d; console.log('noop')"`,
  { encoding: 'utf8' },
)
void expCounts

// re-walk for expiry histogram (second pass, cheap)
const expiry = { past: 0, future: 0, null: 0 }
for (const [sha] of dbBlobs) {
  try {
    execSync(`git cat-file blob ${sha} > /tmp/m261-census.db`, { maxBuffer: 64e6 })
    const r = execSync(
      `bun -e "
import{Database} from 'bun:sqlite';
const d=new Database('/tmp/m261-census.db',{readonly:true});
const t=d.prepare(\\"SELECT name FROM sqlite_master WHERE type='table'\\").all().map(r=>r.name);
if(!t.includes('Session')){console.log('0 0 0');process.exit()}
const now=Date.now();let past=0,future=0,nulls=0;
for(const r of d.prepare('SELECT expiresAt FROM Session').all()){const ms=Date.parse(r.expiresAt);if(Number.isNaN(ms))nulls++;else if(ms<now)past++;else future++}
console.log([past,future,nulls].join(' '));d.close()"`,
      { encoding: 'utf8' },
    ).trim()
    const [p, f, n] = r.split(' ').map(Number)
    expiry.past += p || 0
    expiry.future += f || 0
    expiry.null += n || 0
  } catch {
    /* skip */
  }
}
console.log(`session rows by expiry: past=${expiry.past}, future=${expiry.future}, unparseable=${expiry.null}`)

writeFileSync(
  '/tmp/m261-db-census.json',
  JSON.stringify({ dbBlobs: [...dbBlobs.entries()], distinctTokens: allTokens.size }, null, 2),
)
console.log('\ncensus written to /tmp/m261-db-census.json')
