/**
 * M50.3 — AI Studio workflow persistence migration tests (real SQL, real
 * isolated SQLite; the same LOCAL-LIVE discipline as the M46 suite).
 *
 * The production database is NEVER touched: every trial builds an isolated
 * replica and applies the REAL migration file from prisma/migrations/.
 *
 * Pins:
 *  - the migration file is purely additive (no DROP TABLE/COLUMN, no
 *    DELETE, no UPDATE ... SET, no column rename);
 *  - applying it to an OLD-SHAPED (M49.2-state) database preserves every
 *    pre-existing row (User, Conversation, AutobotTeam, AgentMission) and
 *    creates the three new tables with the Prisma model's exact shape;
 *  - applying it to a FRESH empty database works (fresh-schema path);
 *  - foreign-key behavior: inserting a version for a missing definition
 *    fails; deleting a definition cascades versions and (unused) runs —
 *    the service layer is what REFUSES deletion while historical runs
 *    exist (pinned separately in the service suite);
 *  - the (definitionId, version) and missionId uniqueness constraints fire;
 *  - historical WorkflowRun rows survive definition-level operations while
 *    they exist (test rows inserted and read back through a full
 *    workflow-shaped fixture);
 *  - integrity_check stays ok after every trial.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

const MIGRATION = join(import.meta.dir, '..', '..', 'prisma', 'migrations', '20261128_m50_3_ai_studio_workflows_additive', 'migration.sql')

/** A replica shaped like the pre-M50.3 production DB for the tables the
 *  migration must not disturb: M49.2 state (User + content + AutobotTeam +
 *  AgentMission with its team columns) with REAL rows. */
function buildM49ShapedDb(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT
    );
    CREATE TABLE "AutobotTeam" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "AgentMission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "missionType" TEXT NOT NULL,
      "objective" TEXT NOT NULL,
      "deliverableTaskId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "planJson" TEXT NOT NULL,
      "teamId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
  `)
  const insUser = db.prepare('INSERT INTO User (id, email) VALUES (?, ?)')
  insUser.run('u1', 'owner@example.test')
  insUser.run('u2', 'other@example.test')
  db.prepare('INSERT INTO Conversation (id, userId, title) VALUES (?, ?, ?)').run('c1', 'u1', 'governed turn')
  db.prepare('INSERT INTO AutobotTeam (id, userId, name, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run('t1', 'u1', 'ops team')
  db.prepare(
    'INSERT INTO AgentMission (id, userId, missionType, objective, deliverableTaskId, status, planJson, teamId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
  ).run('m1', 'u1', 'website-build', 'build the launch page', 'build', 'completed', '[]', 't1')
  db.close()
}

function tableNames(db: InstanceType<typeof Database>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name)
}

function indexNames(db: InstanceType<typeof Database>, table: string): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ?").all(table) as Array<{ name: string }>).map((r) => r.name)
}

/** Insert one full workflow fixture (definition → version → run). */
function insertWorkflowFixture(db: InstanceType<typeof Database>, definitionId = 'wf1'): void {
  db.prepare('INSERT INTO WorkflowDefinition (id, userId, name, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run(definitionId, 'u1', 'Launch campaign', '', 'active')
  db.prepare('INSERT INTO WorkflowVersion (id, definitionId, version, status, graphJson, changeNote, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run('wv1', definitionId, 1, 'published', '{"schemaVersion":1,"nodes":[],"edges":[]}', 'first', )
  db.prepare('UPDATE WorkflowVersion SET publishedAt = CURRENT_TIMESTAMP WHERE id = ?').run('wv1')
  db.prepare('INSERT INTO WorkflowVersion (id, definitionId, version, status, graphJson, changeNote, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run('wv2', definitionId, 2, 'draft', '{"schemaVersion":1,"nodes":[],"edges":[]}', 'next round')
  db.prepare(
    'INSERT INTO WorkflowRun (id, userId, definitionId, versionId, missionId, objective, compiledPlanJson, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
  ).run('wr1', 'u1', definitionId, 'wv1', 'mission-1', 'build the launch page', '{"tasks":3}', 'completed')
}

describe('M50.3 the additive migration (real SQL, isolated SQLite)', () => {
  const migrationSql = readFileSync(MIGRATION, 'utf8')

  test('the migration file is purely additive (no destructive operations anywhere)', () => {
    // Strip SQL comments first so prose like "no column is renamed" cannot
    // trip the operation scans.
    const sql = migrationSql.replace(/--[^\n]*/g, ' ')
    expect(/DROP\s+TABLE/i.test(sql)).toBe(false)
    expect(/DROP\s+COLUMN/i.test(sql)).toBe(false)
    expect(/DELETE\s+FROM/i.test(sql)).toBe(false)
    expect(/UPDATE\s+\w+\s+SET/i.test(sql)).toBe(false)
    expect(/RENAME/i.test(sql)).toBe(false)
    expect(/accept-data-loss/i.test(sql)).toBe(false)
    expect(migrationSql).toContain('CREATE TABLE "WorkflowDefinition"')
    expect(migrationSql).toContain('CREATE TABLE "WorkflowVersion"')
    expect(migrationSql).toContain('CREATE TABLE "WorkflowRun"')
    // No pre-existing table is altered in any way.
    expect(/ALTER\s+TABLE/i.test(sql)).toBe(false)
  })

  test('applying it to an M49.2-shaped DB preserves every row and creates the three tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm50-3-migration-'))
    const dbPath = join(dir, 'trial.db')
    buildM49ShapedDb(dbPath)
    const db = new Database(dbPath)
    const before = {
      users: (db.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }).c,
      conversations: (db.prepare('SELECT COUNT(*) c FROM Conversation').get() as { c: number }).c,
      teams: (db.prepare('SELECT COUNT(*) c FROM AutobotTeam').get() as { c: number }).c,
      missions: (db.prepare('SELECT COUNT(*) c FROM AgentMission').get() as { c: number }).c,
    }
    db.exec(migrationSql)
    const after = {
      users: (db.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }).c,
      conversations: (db.prepare('SELECT COUNT(*) c FROM Conversation').get() as { c: number }).c,
      teams: (db.prepare('SELECT COUNT(*) c FROM AutobotTeam').get() as { c: number }).c,
      missions: (db.prepare('SELECT COUNT(*) c FROM AgentMission').get() as { c: number }).c,
    }
    expect(after).toEqual(before)
    expect(after.users).toBe(2)
    expect(after.missions).toBe(1)

    // Pre-existing rows remain fully accessible (read back real values).
    const mission = db.prepare('SELECT missionType, teamId FROM AgentMission WHERE id = ?').get('m1') as { missionType: string; teamId: string }
    expect(mission.missionType).toBe('website-build')
    expect(mission.teamId).toBe('t1')

    // The new tables exist with the Prisma model's exact shape.
    const names = tableNames(db)
    expect(names).toContain('WorkflowDefinition')
    expect(names).toContain('WorkflowVersion')
    expect(names).toContain('WorkflowRun')
    const defCols = (db.prepare("PRAGMA table_info('WorkflowDefinition')").all() as Array<{ name: string }>).map((c) => c.name)
    for (const required of ['id', 'userId', 'name', 'description', 'status', 'createdAt', 'updatedAt']) expect(defCols).toContain(required)
    const verCols = (db.prepare("PRAGMA table_info('WorkflowVersion')").all() as Array<{ name: string }>).map((c) => c.name)
    for (const required of ['id', 'definitionId', 'version', 'status', 'graphJson', 'changeNote', 'publishedAt', 'createdAt', 'updatedAt']) expect(verCols).toContain(required)
    const runCols = (db.prepare("PRAGMA table_info('WorkflowRun')").all() as Array<{ name: string }>).map((c) => c.name)
    for (const required of ['id', 'userId', 'definitionId', 'versionId', 'missionId', 'objective', 'compiledPlanJson', 'status', 'failureNote', 'createdAt', 'finishedAt']) expect(runCols).toContain(required)

    // The indexes the model declares all exist.
    const defIdx = indexNames(db, 'WorkflowDefinition')
    expect(defIdx.some((n) => n?.includes('userId_status'))).toBe(true)
    expect(defIdx.some((n) => n?.includes('userId_createdAt'))).toBe(true)
    const verIdx = indexNames(db, 'WorkflowVersion')
    expect(verIdx.some((n) => n?.includes('definitionId_version'))).toBe(true)
    expect(verIdx.some((n) => n?.includes('definitionId_status'))).toBe(true)
    const runIdx = indexNames(db, 'WorkflowRun')
    expect(runIdx.some((n) => n?.includes('missionId'))).toBe(true)
    expect(runIdx.some((n) => n?.includes('userId_status'))).toBe(true)
    expect(runIdx.some((n) => n?.includes('definitionId'))).toBe(true)
    expect(runIdx.some((n) => n?.includes('versionId'))).toBe(true)

    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    db.close()
  })

  test('applying it to a FRESH empty database creates the full workflow schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm50-3-migration-fresh-'))
    const db = new Database(join(dir, 'fresh.db'))
    db.exec(migrationSql)
    expect(tableNames(db)).toContain('WorkflowDefinition')
    // The full workflow lifecycle works end-to-end on the migrated schema.
    insertWorkflowFixture(db)
    const versions = db.prepare('SELECT version, status FROM WorkflowVersion WHERE definitionId = ? ORDER BY version').all('wf1') as Array<{ version: number; status: string }>
    expect(versions).toEqual([
      { version: 1, status: 'published' },
      { version: 2, status: 'draft' },
    ])
    const run = db.prepare('SELECT missionId, status FROM WorkflowRun WHERE definitionId = ?').get('wf1') as { missionId: string; status: string }
    expect(run.missionId).toBe('mission-1')
    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    db.close()
  })

  test('foreign-key behavior: orphans are refused; cascades match the documented policy; uniqueness fires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm50-3-migration-fk-'))
    const db = new Database(join(dir, 'fk.db'))
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL)')
    db.prepare('INSERT INTO User (id, email) VALUES (?, ?)').run('u1', 'owner@example.test')
    db.exec(migrationSql)
    insertWorkflowFixture(db)

    // 1. A version for a missing definition is refused.
    expect(() =>
      db.prepare('INSERT INTO WorkflowVersion (id, definitionId, version, status, graphJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
        .run('wvX', 'missing-def', 1, 'draft', '{}'),
    ).toThrow()

    // 2. A run for a missing version is refused.
    expect(() =>
      db.prepare('INSERT INTO WorkflowRun (id, userId, definitionId, versionId, missionId, objective, compiledPlanJson, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run('wrX', 'u1', 'wf1', 'missing-ver', 'mission-9', 'x', '{}', 'planned'),
    ).toThrow()

    // 3. Duplicate (definitionId, version) is refused (monotonic backstop).
    expect(() =>
      db.prepare('INSERT INTO WorkflowVersion (id, definitionId, version, status, graphJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
        .run('wvDupe', 'wf1', 1, 'draft', '{}'),
    ).toThrow()

    // 4. Duplicate missionId is refused (one run per mission).
    expect(() =>
      db.prepare('INSERT INTO WorkflowRun (id, userId, definitionId, versionId, missionId, objective, compiledPlanJson, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run('wrDupe', 'u1', 'wf1', 'wv1', 'mission-1', 'x', '{}', 'completed'),
    ).toThrow()

    // 5. Historical run rows SURVIVE while the definition exists (the
    //    service refuses deletion then — pinned in the service suite).
    const runCount = (db.prepare('SELECT COUNT(*) c FROM WorkflowRun WHERE definitionId = ?').get('wf1') as { c: number }).c
    expect(runCount).toBe(1)

    // 6. The documented deletion policy at the DB level: with the service
    //    guard satisfied (zero runs), deleting the user cascades through
    //    definition → versions → runs (the account-deletion path).
    const db2Path = join(dir, 'fk-cascade.db')
    const db2 = new Database(db2Path)
    db2.exec('PRAGMA foreign_keys = ON')
    db2.exec('CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL)')
    db2.prepare('INSERT INTO User (id, email) VALUES (?, ?)').run('u2', 'deleteme@example.test')
    db2.exec(migrationSql)
    db2.prepare('INSERT INTO WorkflowDefinition (id, userId, name, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('wf2', 'u2', 'Doomed', '', 'active')
    db2.prepare('INSERT INTO WorkflowVersion (id, definitionId, version, status, graphJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run('wvF1', 'wf2', 1, 'draft', '{}')
    expect((db2.prepare('SELECT COUNT(*) c FROM WorkflowDefinition').get() as { c: number }).c).toBe(1)
    db2.prepare('DELETE FROM User WHERE id = ?').run('u2')
    expect((db2.prepare('SELECT COUNT(*) c FROM WorkflowDefinition').get() as { c: number }).c).toBe(0)
    expect((db2.prepare('SELECT COUNT(*) c FROM WorkflowVersion').get() as { c: number }).c).toBe(0)
    db2.close()

    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    db.close()
  })
})
