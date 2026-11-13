#!/usr/bin/env python3
"""Phase 1 preflight: recoverable DB backup + row counts (read-only on source).

Uses SQLite's online backup API (consistent snapshot even if a writer were
active). Prints row counts for the tables affected by the Phase 1 schema
change (Project new; ApiKey gains a nullable column) plus overall table list.
"""
import sqlite3
import sys
from datetime import datetime, timezone

SRC = "db/custom.db"
DST = sys.argv[1] if len(sys.argv) > 1 else "backup/db-phase1-pre-migration-20261113.db"

src = sqlite3.connect(SRC)
dst = sqlite3.connect(DST)
src.backup(dst)
dst.commit()
dst.close()

# Integrity check on the backup
chk = sqlite3.connect(DST)
integrity = chk.execute("PRAGMA integrity_check;").fetchone()[0]
tables = [r[0] for r in chk.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name"
)]
print(f"backup: {DST}")
print(f"integrity_check: {integrity}")
print(f"backup_tables ({len(tables)}): {', '.join(tables)}")

# Row counts from the BACKUP (same as source at snapshot time)
print("--- row counts (backup snapshot) ---")
counts = {}
for t in tables:
    counts[t] = chk.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
for t in sorted(counts):
    print(f"{t}: {counts[t]}")
chk.close()

# Live source counts for the affected tables (double-check)
print("--- live source counts (affected tables) ---")
for t in ("User", "ApiKey", "Project"):
    try:
        n = src.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"{t}: {n}")
    except sqlite3.OperationalError:
        print(f"{t}: TABLE_ABSENT")
src.close()
print(f"snapshot_utc: {datetime.now(timezone.utc).isoformat()}")
