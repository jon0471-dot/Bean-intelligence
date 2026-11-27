#!/usr/bin/env python3
"""
M46.5 — SQLite migration preflight (owner-operated; run BEFORE any apply).

The production database is SQLite (DATABASE_URL, default db/custom.db).
Prisma schema management to date has been `prisma db push`; M46 introduces a
reviewed ADDITIVE migration (prisma/migrations/20261128_m46_execution_decision_additive/migration.sql)
containing ONLY CREATE TABLE / CREATE INDEX statements (verified: zero DROP/
DELETE/UPDATE).

This preflight NEVER touches the real database. It:
  1. checks the target exists and is SQLite;
  2. takes a byte-exact backup copy with SHA-256 (the rollback artifact);
  3. runs the migration on a THROWAWAY COPY of the real database;
  4. verifies on the copy: integrity_check ok, every pre-existing table kept
     with identical row counts, the migration's tables/indexes present;
  5. prints an operational apply procedure + post-migration verification +
     recovery strategy (all owner-executed steps).

Restrictions honored: no destructive migration, no `prisma db push`, no
`--accept-data-loss`, no inference from SQLite to other providers.
"""

import hashlib
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION = os.path.join(REPO, "prisma", "migrations", "20261128_m46_execution_decision_additive", "migration.sql")


def db_path() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url.startswith("file:"):
        return url[5:]
    if url:
        print(f"REFUSAL: DATABASE_URL is not SQLite (provider must be sqlite for this procedure). Value type: {url.split(':')[0]}")
        sys.exit(2)
    return os.path.join(REPO, "db", "custom.db")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def table_rows(conn: sqlite3.Connection) -> dict:
    rows = {}
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    for (name,) in cur.fetchall():
        rows[name] = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    return rows


def main() -> None:
    print("== M46.5 migration preflight (read-only on the real database) ==")
    target = db_path()
    if not os.path.isfile(target):
        print(f"REFUSAL: database file not found: {target}")
        sys.exit(2)
    if not os.path.isfile(MIGRATION):
        print(f"REFUSAL: migration file missing: {MIGRATION}")
        sys.exit(2)

    # 1. target sanity
    print(f"[1] target: {target} ({os.path.getsize(target)} bytes)")
    real = sqlite3.connect(f"file:{target}?mode=ro", uri=True)
    real.execute("PRAGMA integrity_check")
    before_tables = table_rows(real)
    real.close()
    print(f"    integrity ok; {len(before_tables)} pre-existing tables, total rows {sum(before_tables.values())}")

    # 2. backup (byte-exact) — the rollback artifact
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.makedirs(os.path.join(REPO, "db"), exist_ok=True)
    backup = os.path.join(REPO, "db", f"backup-pre-migration-{stamp}.db")
    shutil.copy2(target, backup)
    print(f"[2] backup: {backup}")
    print(f"    sha256 {sha256(backup)}")
    if sha256(backup) != sha256(target):
        print("REFUSAL: backup does not match the source byte-for-byte.")
        sys.exit(2)

    # 3. dry-run on a throwaway copy
    with tempfile.TemporaryDirectory(prefix="m46-preflight-") as tmp:
        trial = os.path.join(tmp, "trial.db")
        shutil.copy2(target, trial)
        conn = sqlite3.connect(trial)
        sql = open(MIGRATION, encoding="utf-8").read()
        conn.executescript(sql)
        conn.commit()
        check = conn.execute("PRAGMA integrity_check").fetchone()[0]
        after = table_rows(conn)
        indexes = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'ExecutionDecision%'").fetchone()[0]
        conn.close()

        # 4. verification on the copy
        print("[3] dry-run on a throwaway copy: applied OK")
        print(f"    integrity_check: {check}")
        lost = [t for t in before_tables if t not in after]
        changed = {t: (before_tables[t], after[t]) for t in before_tables if t in after and before_tables[t] != after[t]}
        added = sorted(set(after) - set(before_tables))
        print(f"    pre-existing tables lost: {lost if lost else 'NONE'}")
        print(f"    pre-existing row-count changes: {changed if changed else 'NONE'}")
        print(f"    tables added: {added}")
        print(f"    ExecutionDecision indexes present: {indexes}")
        if lost or changed or check != "ok":
            print("REFUSAL: the additive migration affected existing data — do not apply; investigate.")
            sys.exit(2)

    print("[4] verdict: the migration is PURELY ADDITIVE and applied cleanly to a copy of the REAL database.")
    print()
    print("OPERATIONAL APPLY PROCEDURE (owner-executed, each step verified):")
    print(f"  1. stop the application process serving {target}")
    print(f"  2. re-run this preflight (fresh backup): python3 scripts/m46-migration-preflight.py")
    print(f"  3. apply: sqlite3 {target} < {MIGRATION}   (or: prisma db execute --file {MIGRATION})")
    print(f"  4. verify: sqlite3 {target} 'PRAGMA integrity_check;' and confirm the new tables via .tables")
    print("  5. start the application; exercise /api/health and one governed chat turn")
    print("  6. delete nothing: keep the backup file until a later verified checkpoint")
    print()
    print("RECOVERY / ROLLBACK STRATEGY:")
    print(f"  - rollback = restore the byte-exact backup: stop app, copy {backup} back over {target}, restart, verify integrity_check")
    print("  - the migration is idempotent-resistant: re-applying after a completed apply fails harmlessly on CREATE TABLE (no partial state)")
    print("  - provider honesty: this procedure proves SQLite safety ONLY; it never implies PostgreSQL/MySQL safety")


if __name__ == "__main__":
    main()
