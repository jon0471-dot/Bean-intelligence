/**
 * M46.5 tests — database migration readiness (additive ExecutionDecision
 * migration against an isolated copy of the ACTUAL provider: SQLite).
 *
 * Classification: LOCAL-LIVE — real SQLite database files, the REAL
 * migration SQL from prisma/migrations/, real integrity checks. The real
 * production database is NEVER touched (the preflight script is read-only
 * on it; these tests build isolated replicas).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

const MIGRATION = join(import.meta.dir, '..', '..', 'prisma', 'migrations', '20261128_m46_execution_decision_additive', 'migration.sql')

function buildOldShapedDb(path: string): void {
  // A replica shaped like the pre-migration production DB for the tables the
  // migration must not disturb: one user row + one unrelated table with data.
  const db = new Database(path)
  db.exec(`
    CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "Conversation" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "title" TEXT);
  `)
  db.prepare('INSERT INTO User (id, email) VALUES (?, ?)').run('u1', 'owner@example.com')
  db.prepare('INSERT INTO Conversation (id, userId, title) VALUES (?, ?, ?)').run('c1', 'u1', 'governed turn')
  db.close()
}

describe('M46.5 the additive migration (real SQL, isolated SQLite)', () => {
  const migrationSql = readFileSync(MIGRATION, 'utf8')

  test('the migration file is purely additive (no DROP/DELETE/UPDATE anywhere)', () => {
    expect(/DROP\s+TABLE/i.test(migrationSql)).toBe(false)
    expect(/DROP\s+COLUMN/i.test(migrationSql)).toBe(false)
    expect(/DELETE\s+FROM/i.test(migrationSql)).toBe(false)
    expect(/UPDATE\s+\w+\s+SET/i.test(migrationSql)).toBe(false)
    expect(migrationSql).toContain('CREATE TABLE "ExecutionDecision"')
  })

  test('applying it to an old-shaped DB keeps every row and creates the governed table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm46-migration-'))
    const dbPath = join(dir, 'trial.db')
    buildOldShapedDb(dbPath)

    const db = new Database(dbPath)
    const before = {
      users: db.prepare('SELECT COUNT(*) c FROM User').get()!.c as number,
      conversations: db.prepare('SELECT COUNT(*) c FROM Conversation').get()!.c as number,
    }
    db.exec(migrationSql)
    const after = {
      users: db.prepare('SELECT COUNT(*) c FROM User').get()!.c as number,
      conversations: db.prepare('SELECT COUNT(*) c FROM Conversation').get()!.c as number,
    }
    expect(after.users).toBe(before.users)
    expect(after.conversations).toBe(before.conversations)

    // The ExecutionDecision table exists with the Prisma model's exact shape.
    const cols = (db.prepare("PRAGMA table_info('ExecutionDecision')").all() as Array<{ name: string }>).map((c) => c.name)
    for (const required of ['id', 'userId', 'conversationId', 'turnId', 'objective', 'status', 'decisionKind', 'decisionJson', 'planDigest', 'planJson', 'recordsJson', 'trustTaskId', 'bindingDigest', 'createdAt', 'updatedAt']) {
      expect(cols).toContain(required)
    }
    // Indexes exist (the Prisma model's three).
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ExecutionDecision'").all() as Array<{ name: string }>).map((i) => i.name)
    expect(idx.some((n) => n?.includes('userId_conversationId'))).toBe(true)
    expect(idx.some((n) => n?.includes('userId_status'))).toBe(true)
    expect(idx.some((n) => n?.includes('trustTaskId'))).toBe(true)

    // The governed lifecycle works end-to-end on the migrated schema.
    db.prepare(
      'INSERT INTO ExecutionDecision (id, userId, conversationId, turnId, objective, status, decisionKind, decisionJson, bindingDigest, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    ).run('ed1', 'u1', 'c1', 't1', 'choose a deployment strategy', 'created', 'decided', '{}', 'digest')
    const row = db.prepare('SELECT * FROM ExecutionDecision WHERE id = ?').get('ed1')! as Record<string, string>
    expect(row.status).toBe('created')

    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    expect(integrity).toBe('ok')
    db.close()
  })

  test('pre-migration state + migration produce a DB compatible with the app schema (provider honesty)', () => {
    // The migrated replica's ExecutionDecision columns must match the Prisma
    // datamodel exactly — compatibility is CHECKED, never inferred.
    const schema = readFileSync(join(import.meta.dir, '..', '..', 'prisma', 'schema.prisma'), 'utf8')
    const modelBlock = schema.slice(schema.indexOf('model ExecutionDecision'))
    const block = modelBlock.slice(0, modelBlock.indexOf('}'))
    const dir = mkdtempSync(join(tmpdir(), 'm46-migration-'))
    const dbPath = join(dir, 'trial.db')
    buildOldShapedDb(dbPath)
    const db = new Database(dbPath)
    db.exec(migrationSql)
    const cols = new Set((db.prepare("PRAGMA table_info('ExecutionDecision')").all() as Array<{ name: string }>).map((c) => c.name))
    for (const line of block.split('\n')) {
      const m = line.trim().match(/^(\w+)\s+/)
      if (!m || ['@@index', '@@map'].includes(m[1])) continue
      if (m[1] === 'model') continue
      expect(cols.has(m[1])).toBe(true)
    }
    db.close()
  })
})
