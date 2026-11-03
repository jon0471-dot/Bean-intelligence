#!/usr/bin/env python3
"""Read-only DB snapshot for the streaming audit (before/after evidence).

Prints: table inventory, row counts, a checksum over pre-existing Message
rows (id + content hash) so we can prove existing history is unchanged,
and the count of rows owned by the dedicated e2e account.
"""
import hashlib
import json
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/db/custom.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

tables = [
    r[0]
    for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
]
counts = {t: cur.execute(f"SELECT COUNT(*) FROM \"{t}\"").fetchone()[0] for t in tables}

# Checksum over ALL messages, ordered deterministically. If any pre-existing
# row is mutated or deleted, this hash changes.
h = hashlib.sha256()
n = 0
for mid, role, content, conv in cur.execute(
    "SELECT id, role, content, conversationId FROM Message ORDER BY createdAt, id"
):
    h.update(mid.encode())
    h.update(role.encode())
    h.update(hashlib.sha256(content.encode()).digest())
    h.update(conv.encode())
    n += 1

e2e_users = [
    r[0]
    for r in cur.execute("SELECT email FROM User WHERE email LIKE 'e2e-%' ORDER BY email")
]
e2e_convs = cur.execute(
    "SELECT COUNT(*) FROM Conversation c JOIN User u ON c.userId=u.id WHERE u.email LIKE 'e2e-%'"
).fetchone()[0]
e2e_msgs = cur.execute(
    "SELECT COUNT(*) FROM Message m JOIN Conversation c ON m.conversationId=c.id "
    "JOIN User u ON c.userId=u.id WHERE u.email LIKE 'e2e-%'"
).fetchone()[0]

print(json.dumps({
    "db": DB,
    "tables": counts,
    "message_rows": n,
    "message_checksum": h.hexdigest(),
    "e2e_users": e2e_users,
    "e2e_conversations": e2e_convs,
    "e2e_messages": e2e_msgs,
}, indent=2))
