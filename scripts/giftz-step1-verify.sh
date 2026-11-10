#!/usr/bin/env bash
# Step-1-equivalent verification against the CURRENT build (:3100 isolated instance).
# The platform preview itself is down (no platform Restart yet); these are the
# same HTTP-level behaviors, run on the same compiled bundle with an isolated DB copy.
set -u
BASE=http://127.0.0.1:3100
OUT=/home/z/my-project/scripts/giftz-verify-out

cd /home/z/my-project/.next/standalone
NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  DATABASE_URL=file:/home/z/my-project/scripts/giftz-verify-out/verify.db \
  bun server.js > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null --max-time 2 "$BASE/" && break; sleep 1; done

echo "=== T1: UI loads (HTTP) ==="
curl -s -o /tmp/gz-home.html -w "GET / -> %{http_code}\n" "$BASE/"
grep -o "<title>[^<]*</title>" /tmp/gz-home.html | head -1
curl -s -o /dev/null -w "GET /api/health -> %{http_code}\n" "$BASE/api/health"

echo "=== T2: session (register on isolated copy) ==="
EMAIL="gzverify-$(date +%s)@bean-test.dev"
curl -s -c /tmp/gz-cookies.txt -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"VerifyOnly2026x\",\"name\":\"Final Verification\"}" \
  -o /tmp/gz-reg.json -w "register -> %{http_code}\n"
head -c 120 /tmp/gz-reg.json; echo

echo "=== T3: short prompt (gateway throttled -> typed failure path) ==="
PROMPT="Write a one-line JavaScript function that adds two numbers."
curl -s -b /tmp/gz-cookies.txt -X POST "$BASE/api/code-giftz/chat?stream=1" \
  -H 'content-type: application/json' -d "{\"message\":\"$PROMPT\"}" \
  -o "$OUT/t3-short-prompt.sse" -w "chat -> %{http_code}\n"
python3 - "$OUT/t3-short-prompt.sse" << 'PYEOF'
import json, sys
raw = open(sys.argv[1]).read()
frames = []
for chunk in raw.split('\n\n'):
    for line in chunk.split('\n'):
        if line.startswith('data: '):
            try: frames.append(json.loads(line[6:]))
            except Exception: pass
terminals = [f for f in frames if 'done' in f or 'error' in f]
deltas = [f for f in frames if 'delta' in f]
print(f"frames={len(frames)} deltas={len(deltas)} terminal_frames={len(terminals)}")
for t in terminals:
    print("terminal:", json.dumps(t)[:220])
err = terminals[0] if terminals and 'error' in terminals[0] else None
print("HAS_DONE:", any('done' in t for t in terminals))
print("TYPED_CODE:", err.get('code') if err else None)
print("PARTIAL_FLAG:", err.get('partial') if err else None)
print("ACTIONABLE(not generic network error):", bool(err and 'network error' not in err.get('error','').lower() and len(err.get('error',''))>40))
PYEOF

echo "=== T4: retry the failed generation (same prompt) ==="
curl -s -b /tmp/gz-cookies.txt -X POST "$BASE/api/code-giftz/chat?stream=1" \
  -H 'content-type: application/json' -d "{\"message\":\"$PROMPT\"}" \
  -o "$OUT/t4-retry.sse" -w "retry -> %{http_code}\n"
python3 - "$OUT/t4-retry.sse" << 'PYEOF'
import json, sys
raw = open(sys.argv[1]).read()
frames = []
for chunk in raw.split('\n\n'):
    for line in chunk.split('\n'):
        if line.startswith('data: '):
            try: frames.append(json.loads(line[6:]))
            except Exception: pass
terminals = [f for f in frames if 'done' in f or 'error' in f]
print(f"retry terminal_frames={len(terminals)}")
for t in terminals:
    print("terminal:", json.dumps(t)[:180])
PYEOF

echo "=== T5: DB assertions (isolated copy): no duplicate user row, zero assistant rows ==="
cd /home/z/my-project && bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('scripts/giftz-verify-out/verify.db', { readonly: true });
const user = db.query(\"SELECT email FROM User WHERE email LIKE 'gzverify-%'\").get();
const proj = db.query(\"SELECT id, name FROM CodeProject ORDER BY rowid DESC LIMIT 1\").get();
const rows = db.query('SELECT role, content FROM CodeMessage WHERE projectId = ? ORDER BY rowid').all(proj.id);
console.log('account:', user.email, '| latest project:', proj.id);
console.log('message rows:', JSON.stringify(rows.map(r => ({ role: r.role, len: r.content.length }))));
const users = rows.filter(r => r.role === 'user').length;
const assistants = rows.filter(r => r.role === 'assistant').length;
console.log('USER_ROWS:', users, '(expected 1 — retry collapsed the duplicate)');
console.log('ASSISTANT_ROWS:', assistants, '(expected 0 — failed turns never persist a reply)');
console.log('PROMPT_VERBATIM:', rows.find(r => r.role === 'user')?.content === process.argv[1] ? 'yes' : 'NO');
" "$PROMPT"

echo "=== T6: server logs (typed failure events) ==="
grep -E "codegiftz\.(chat_failed|persist_failed|client_disconnected)" "$OUT/server.log" | tail -4 || echo "(no lifecycle failure events logged)"
grep -c "Invalid state: Controller is already closed" "$OUT/server.log" | xargs echo "controller-closed occurrences (must be 0):"
