/**
 * Seed a CODE GIFTZ project + files directly into the VERIFICATION DB copy
 * (scripts/e2e-verify-out/verify.db) for the browser hydration test.
 * The real user database is never touched.
 */
import { Database } from 'bun:sqlite'

const DB_PATH = '/home/z/my-project/scripts/e2e-verify-out/verify.db'
const USER_ID = process.argv[2]
if (!USER_ID) throw new Error('usage: bun seed-giftz-project.ts <userId>')

const db = new Database(DB_PATH)
const id = `seedproj${Date.now()}`
const now = new Date().toISOString()
db.run(
  `INSERT INTO CodeProject (id, userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
  [id, USER_ID, 'Hydration Check Project', now, now],
)
const files = [
  ['index.html', '<!doctype html>\n<html><body><h1>Seeded</h1></body></html>\n'],
  ['main.js', 'console.log("seeded file two")\n'],
  ['style.css', 'body { background: #111; }\n'],
]
const ins = db.prepare(
  `INSERT INTO CodeFile (id, projectId, path, content, origin, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'generated', ?, ?)`,
)
for (const [path, content] of files) {
  ins.run(`seedfile${Date.now()}${path.replace(/\W/g, '')}`, id, path, content, now, now)
}
const count = db.query('SELECT COUNT(*) as n FROM CodeFile WHERE projectId = ?').get(id)
console.log(`seeded project ${id} with ${count.n} files for user ${USER_ID}`)
db.close()
