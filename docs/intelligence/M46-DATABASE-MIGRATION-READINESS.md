# M46 — Database Migration Readiness (docs/intelligence)

Milestone: M46.5 (Phase 6) · commit `e6bdd48`

## Discovery (the real production database)

- Provider: **SQLite** (`prisma/schema.prisma` datasource; production runs `DATABASE_URL=file:/home/z/my-project/db/custom.db`).
- Schema management to date: `prisma db push` (the `db:push` script even carries `--accept-data-loss`). **No `prisma/migrations/` directory existed.**
- The LIVE production database (708,608 bytes, 39 tables, 331 rows) predates the M43/M44/M45 schema additions: `EvidenceKnowledge`, `AgentMission`, `AgentMissionTask`, `ExecutionDecision` are all absent from the real deployment DB.

## The reviewed additive migration

`prisma/migrations/20261128_m46_execution_decision_additive/migration.sql`, generated with `prisma migrate diff` (live datasource → schema datamodel):

- **4 CREATE TABLE + 12 CREATE INDEX — zero destructive statements** (no DROP TABLE/COLUMN, no DELETE, no UPDATE — pinned by a test);
- includes `ExecutionDecision` with its three indexes (`userId_conversationId`, `userId_status`, `trustTaskId`);
- restrictions honored: no production apply, no `prisma db push`, no `--accept-data-loss`, no destructive migration.

## The preflight (`scripts/m46-migration-preflight.py`, owner-operated)

Read-only on the real database: integrity check → byte-exact backup with SHA-256 (the rollback artifact) → dry-run on a throwaway copy → verification (pre-existing tables lost: NONE; row-count changes: NONE; new tables + indexes present) → prints the operational apply procedure, post-migration verification, and the recovery strategy.

**Ran for real in this milestone** (LOCAL-LIVE against an isolated copy of the ACTUAL production database):

```
[1] target: /home/z/my-project/db/custom.db (708608 bytes) — integrity ok;
    39 pre-existing tables, 331 rows
[2] backup sha256 39d2b6bbcea8fef4756c3ecf48f7b19221a5cbc928095e1201c155ee9379a34e
[3] dry-run applied OK — integrity ok, tables lost NONE, row changes NONE,
    tables added [AgentMission, AgentMissionTask, EvidenceKnowledge, ExecutionDecision],
    ExecutionDecision indexes: 3
[4] verdict: PURELY ADDITIVE, applied cleanly to a copy of the REAL database.
```

The real production database was NOT modified. Production migration remains a separately authorized owner operation.

## Owner apply procedure (each step verified)

1. Stop the application process serving the production DB.
2. Re-run the preflight (fresh backup).
3. Apply: `sqlite3 db/custom.db < prisma/migrations/20261128_m46_execution_decision_additive/migration.sql`.
4. Verify: `PRAGMA integrity_check` = ok; new tables present.
5. Restart; exercise `/api/health` and one governed chat turn.
6. Keep the backup until a later verified checkpoint.

**Recovery / rollback:** restore the byte-exact backup (stop app → copy back → restart → integrity check). Re-applying after a completed apply fails harmlessly on CREATE TABLE (no partial state). Provider honesty: this procedure proves SQLite safety ONLY — it never implies PostgreSQL/MySQL safety.

## Isolated migration test (suite-pinned)

`tests/integration/m46-migration.test.ts` (3 cases, LOCAL-LIVE — real SQLite files, the REAL migration SQL): additive-only assertion; an old-shaped replica keeps every row, gains `ExecutionDecision` with the exact Prisma column set + 3 indexes, accepts a governed row insert, integrity ok; datamodel compatibility checked column-by-column (never inferred).
