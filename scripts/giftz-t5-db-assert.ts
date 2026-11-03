/**
 * T5 — DB assertions for the Step-1-equivalent verification (isolated DB copy).
 * Verifies: exactly ONE user row (retry collapsed the duplicate) and ZERO
 * assistant rows (failed turns never persist a reply), prompt verbatim.
 */
import { Database } from 'bun:sqlite'

const PROMPT = 'Write a one-line JavaScript function that adds two numbers.'
const db = new Database('/home/z/my-project/scripts/giftz-verify-out/verify.db', { readonly: true })

const user = db.query("SELECT email FROM User WHERE email LIKE 'gzverify-%' ORDER BY rowid DESC").get() as { email: string } | undefined
if (!user) {
  console.log('NO gzverify account found — aborting')
  process.exit(1)
}
const projects = db.query(
  "SELECT p.id FROM CodeProject p JOIN User u ON u.id = p.userId WHERE u.email = ? ORDER BY p.rowid",
).all(user.email) as Array<{ id: string }>
console.log('account:', user.email, '| projects:', projects.length)

let users = 0
let assistants = 0
let verbatim = false
for (const p of projects) {
  const rows = db.query('SELECT role, content FROM CodeMessage WHERE projectId = ? ORDER BY rowid').all(p.id) as Array<{ role: string; content: string }>
  console.log(`project ${p.id}: ${rows.map((r) => `${r.role}(${r.content.length})`).join(', ') || '(empty)'}`)
  users += rows.filter((r) => r.role === 'user').length
  assistants += rows.filter((r) => r.role === 'assistant').length
  const u = rows.find((r) => r.role === 'user')
  if (u) verbatim = u.content === PROMPT
}
console.log('USER_ROWS_TOTAL:', users, '(expected 1 — retry collapsed the duplicate)')
console.log('ASSISTANT_ROWS_TOTAL:', assistants, '(expected 0 — failed turns never persist a reply)')
console.log('PROMPT_VERBATIM:', verbatim ? 'yes' : 'NO')
