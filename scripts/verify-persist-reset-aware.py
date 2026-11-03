#!/usr/bin/env python3
"""Reset-aware persistence verification for t2-long + Tamil integrity.

The orchestrator may stream a draft, then a verification pass REWRITES it:
the server emits {reset:true} and the client must CLEAR before appending the
final answer. The naive e2e checker concatenated draft+rewrite (20291 chars)
while the DB holds the rewrite only (10106). This script models the client
contract exactly (see sse-client.ts / use-riishe-chat.ts) and compares the
FINAL accumulated text with the persisted DB row.
"""
import hashlib
import json
import sqlite3
import sys

sse_path, answer_path, db_path = sys.argv[1], sys.argv[2], sys.argv[3]
message_id_hint = sys.argv[4] if len(sys.argv) > 4 else None

text = []          # accumulated client text, modeling resets
n_resets = 0
done_evt = None
keepalives = 0
for line in open(sse_path, encoding="utf-8", errors="replace"):
    if line.startswith(": "):
        keepalives += 1
        continue
    if line.startswith("data: "):
        try:
            evt = json.loads(line[6:])
        except Exception:
            continue
        if evt.get("reset"):
            n_resets += 1
            text = []  # client clears the draft
        elif "delta" in evt:
            text.append(evt["delta"])
        elif evt.get("done"):
            done_evt = evt

final = "".join(text)
row = None
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
if message_id_hint:
    row = con.execute(
        "SELECT id, content FROM Message WHERE id LIKE ?", (message_id_hint + "%",)
    ).fetchone()
if row is None:
    # fall back: match by head
    head = " ".join(final.split())[:80]
    for mid, content in con.execute(
        "SELECT id, content FROM Message WHERE role='assistant' ORDER BY createdAt DESC LIMIT 50"
    ):
        if " ".join(content.split())[:80] == head:
            row = (mid, content)
            break

db_content = row[1] if row else None
same = db_content is not None and db_content == final
print(f"resets_observed={n_resets} keepalives={keepalives}")
print(f"final_client_text_chars={len(final)} db_row_chars={len(db_content) if db_content else 0}")
print(f"messageId={done_evt.get('messageId') if done_evt else None}")
print(f"BYTE_EXACT_MATCH={'YES' if same else 'NO'}")
if not same and db_content is not None:
    print(f"sha(client)={hashlib.sha256(final.encode()).hexdigest()[:16]}")
    print(f"sha(db)    ={hashlib.sha256(db_content.encode()).hexdigest()[:16]}")
# Tamil integrity
if "tamil" in sse_path:
    bad = final.count("\ufffd")
    tamil_chars = sum(1 for ch in final if 0x0B80 <= ord(ch) <= 0x0BFF)
    print(f"tamil_chars={tamil_chars} replacement_chars={bad}")
    print(f"TAMIL_INTEGRITY={'OK' if bad == 0 and tamil_chars > 0 else 'FAIL'}")
