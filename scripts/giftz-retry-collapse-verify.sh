#!/usr/bin/env bash
# Retry-collapse verification WITHIN one project (the real UI retry flow):
# first POST creates project P; retry POST carries projectId=P; assert P ends
# with exactly ONE user row and ZERO assistant rows.
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

EMAIL="gzretry-$(date +%s)@bean-test.dev"
curl -s -c /tmp/gzr-cookies.txt -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"VerifyOnly2026x\",\"name\":\"Retry Verify\"}" -o /dev/null

PROMPT="Write a one-line JavaScript function that adds two numbers."

echo "--- first attempt (creates project) ---"
curl -s -b /tmp/gzr-cookies.txt -X POST "$BASE/api/code-giftz/chat?stream=1" \
  -H 'content-type: application/json' -d "{\"message\":\"$PROMPT\"}" -o "$OUT/rc1.sse" -w "chat -> %{http_code}\n"

PROJECT=$(cd /home/z/my-project && bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('scripts/giftz-verify-out/verify.db', { readonly: true });
const p = db.query(\"SELECT p.id FROM CodeProject p JOIN User u ON u.id=p.userId WHERE u.email=? ORDER BY p.rowid DESC LIMIT 1\").get('$EMAIL');
console.log(p.id);
")
echo "project: $PROJECT"

echo "--- retry WITH projectId (the UI flow) ---"
curl -s -b /tmp/gzr-cookies.txt -X POST "$BASE/api/code-giftz/chat?stream=1" \
  -H 'content-type: application/json' \
  -d "{\"message\":\"$PROMPT\",\"projectId\":\"$PROJECT\"}" -o "$OUT/rc2.sse" -w "retry -> %{http_code}\n"

echo "--- DB assertion ---"
cd /home/z/my-project && bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('scripts/giftz-verify-out/verify.db', { readonly: true });
const rows = db.query('SELECT role, length(content) as len FROM CodeMessage WHERE projectId = ? ORDER BY rowid').all('$PROJECT');
console.log('rows in retried project:', JSON.stringify(rows));
const users = rows.filter(r => r.role === 'user').length;
const assistants = rows.filter(r => r.role === 'assistant').length;
console.log(users === 1 && assistants === 0 ? 'RETRY-COLLAPSE PASS (1 user row, 0 assistant rows)' : 'RETRY-COLLAPSE FAIL');
"
echo "--- second retry must NOT collapse once an assistant answer exists (different-turn guard) ---"
echo "(skipped live: needs a healthy gateway to produce the answer; pinned by unit tests giftz-chat-stream/giftz-streaming)"
