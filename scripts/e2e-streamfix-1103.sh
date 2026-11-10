#!/bin/bash
# 2026-11-03 live E2E — streaming reliability & accuracy work order.
# Runs against a VERIFICATION INSTANCE of the production build
# (.next/standalone on 127.0.0.1:3100, its own DB copy) — NOT the
# platform-managed dev server. Real account, real gateway, real research.
set -u
BASE="http://127.0.0.1:3100"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-verify-out"
mkdir -p "$OUT"
EMAIL="e2e-stream-1103@bean.dev"
PASS="Stream-Rel-1103-Pw!"

CODE=$(curl -s -o "$OUT/reg.json" -w '%{http_code}' -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Stream E2E\"}")
echo "register: $CODE"
curl -s -c "$OUT/cookies.txt" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o "$OUT/login.json"
echo "login: $(head -c 80 "$OUT/login.json")"

# --- turn runner: POST + stream to file, honest summary ---
turn() {
  local name="$1"; local message="$2"; local maxtime="${3:-300}"
  local t0=$(date +%s%3N)
  curl -s -N -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "{\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$message")}" \
    -o "$OUT/$name.sse" --max-time "$maxtime"
  local rc=$?
  local t1=$(date +%s%3N)
  echo "curl_rc=$rc" > "$OUT/$name.rc"
  python3 - "$OUT/$name.sse" "$t0" "$t1" "$name" <<'PYEOF'
import json, sys
path, t0, t1, name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
deltas = 0; chars = 0; done = None; err = None; keepalives = 0; stages = []
text = []
for line in open(path, encoding='utf-8', errors='replace'):
    if line.startswith(': '):
        keepalives += 1
        continue
    if line.startswith('data: '):
        try: evt = json.loads(line[6:])
        except Exception: continue
        if 'delta' in evt:
            deltas += 1
            chars += len(evt['delta'])
            text.append(evt['delta'])
        if evt.get('done'): done = evt
        if evt.get('error'): err = evt
        if evt.get('stage'): stages.append(evt['stage'])
answer = ''.join(text)
open(path.replace('.sse', '.answer.txt'), 'w', encoding='utf-8').write(answer)
print(f"[{name}] deltas={deltas} chars={chars} keepalives={keepalives} wall={t1-t0}ms stages={','.join(stages) or '-'}")
if done:
    print(f"[{name}] done: partial={done.get('partial')} messageId={str(done.get('messageId'))[:8]} durationMs={done.get('durationMs')} meta_states={','.join((done.get('meta') or {}).get('states', []))}")
if err:
    print(f"[{name}] SERVER ERROR: code={err.get('code')} msg={str(err.get('error'))[:160]}")
if not done and not err:
    print(f"[{name}] NO DONE EVENT (incomplete stream)")
PYEOF
}

# --- persistence checker: conversation rows match the streamed turn ---
check_persist() {
  local name="$1"; local convfile="$2"
  python3 - "$convfile" "$OUT/$name.answer.txt" <<'PYEOF'
import json, sys
conv = json.load(open(sys.argv[1], encoding='utf-8'))
answer = open(sys.argv[2], encoding='utf-8').read()
rows = conv.get('conversation', {}).get('messages', [])
last_user = next((r for r in reversed(rows) if r['role'] == 'user'), None)
last_asst = next((r for r in reversed(rows) if r['role'] == 'assistant'), None)
norm = lambda s: ' '.join(s.split())
head = norm(answer)[:80]
ok = bool(last_asst) and norm(last_asst['content'])[:80] == head and len(last_asst['content']) >= len(answer) - 40
print(f"PERSIST{'  OK' if ok else ' FAIL'}: rows={len(rows)} asst_len={len(last_asst['content']) if last_asst else 0} streamed_len={len(answer)} head_match={norm(last_asst['content'])[:80] == head if last_asst else False}")
PYEOF
}

echo "=== T1 short response ==="
turn t1-short "Reply with exactly one short sentence: what is 7 times 8?"
sleep 3

echo "=== T2 LONG response (the screenshot failure class) ==="
turn t2-long "Write a detailed technical report of at least 900 words explaining how HTTP caching works. Include sections on: browser cache, CDN caching, proxy caches, the Cache-Control directives you consider most important, ETags and validation, stale-while-revalidate, and finish with a summary table of the directives. Be thorough and technical."
sleep 3

echo "=== T3 Tamil response ==="
turn t3-tamil "Answer ONLY in Tamil, in two or three sentences: what is the sun and why is it important for life on Earth?"
sleep 3

echo "=== T4 Q11 latest Node.js version (live research) ==="
turn q11-node "What is the latest Node.js version right now? Distinguish the LTS and Current lines and give release dates." 300
sleep 8

echo "=== T5 Q15 FIFA 2026 final status (live research) ==="
turn q15-fifa "What happened in the FIFA World Cup 2026 final? Who won and what was the score?"
sleep 8

echo "=== T6 Q14 NVIDIA latest announcements (live research) ==="
turn q14-nvidia "What are NVIDIA's most recent announcements? Give the newest items with dates."
sleep 3

echo "=== T7 cancellation: client drops mid-stream, server must contain it ==="
CONV_BEFORE=$(curl -s -b "$OUT/cookies.txt" "$BASE/api/riishe/chat" -H "origin: $ORIGIN" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('conversations', [])))")
curl -s -N -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d '{"message":"Write a detailed 600-word explanation of database indexing (B-trees, clustered vs non-clustered, write trade-offs)."}' \
  -o "$OUT/t7-cancel.sse" --max-time 6
echo "client dropped after ~6s (rc=$?)"
sleep 40
CONV_AFTER=$(curl -s -b "$OUT/cookies.txt" "$BASE/api/riishe/chat" -H "origin: $ORIGIN")
echo "$CONV_AFTER" > "$OUT/t7-convs.json"
python3 - "$OUT/t7-convs.json" "$CONV_BEFORE" <<'PYEOF'
import json, sys
convs = json.load(open(sys.argv[1], encoding='utf-8')).get('conversations', [])
before = int(sys.argv[2])
new = [c for c in convs if 'database indexing' in c['title'].lower()]
print(f"CANCEL: conversations before={before} after={len(convs)} indexing_conv={'yes' if new else 'no'}")
PYEOF
# The newest conversation holds the cancelled turn; fetch its rows.
CID=$(python3 -c "import json;print(json.load(open('$OUT/t7-convs.json'))['conversations'][0]['id'])")
curl -s -b "$OUT/cookies.txt" "$BASE/api/riishe/conversations/$CID" -H "origin: $ORIGIN" > "$OUT/t7-conv.json"
python3 - "$OUT/t7-conv.json" <<'PYEOF'
import json, sys
rows = json.load(open(sys.argv[1], encoding='utf-8')).get('conversation', {}).get('messages', [])
asst = [r for r in rows if r['role'] == 'assistant']
last = asst[-1] if asst else None
print(f"CANCEL-SERVER-SIDE: rows={len(rows)} assistant_rows={len(asst)} last_len={len(last['content']) if last else 0}")
print("  -> server finished and persisted the turn despite the client dropping" if last and len(last['content']) > 400 else "  -> server did NOT persist a completed answer (check)")
PYEOF

echo "=== T8 persistence checks for completed turns ==="
for t in t1-short t2-long t3-tamil; do
  CID=$(python3 - "$OUT/$t.sse" <<'PYEOF'
import json, sys
cid = None
for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
    if line.startswith('data: '):
        try: evt = json.loads(line[6:])
        except Exception: continue
        if evt.get('conversationId'): cid = evt['conversationId']
        if evt.get('done'): break
print(cid or '')
PYEOF
)
  if [ -n "$CID" ]; then
    curl -s -b "$OUT/cookies.txt" "$BASE/api/riishe/conversations/$CID" -H "origin: $ORIGIN" > "$OUT/$t-conv.json"
    check_persist "$t" "$OUT/$t-conv.json"
  else
    echo "PERSIST SKIP $t: no conversation id captured"
  fi
done
echo "E2E COMPLETE"
