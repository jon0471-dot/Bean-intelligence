#!/usr/bin/env bash
# BEAN Intelligence — live verification of the streaming reliability fix.
# Real route, real gateway, real model. Read-only HTTP against the
# platform-managed dev server (never started/stopped/restarted).
set -u

BASE="${BEAN_VERIFY_BASE:-http://localhost:3100}"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/stream-fix-cookies.txt"
OUT="/home/z/my-project/scripts/stream-fix-out"
mkdir -p "$OUT"
rm -f "$JAR"

BR_HEADERS=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

TS=$(date +%s)
EMAIL="e2e-stream-fix-$TS@bean-test.dev"

echo "================ 0. REGISTER ================"
S=$(curl -s -o "$OUT/reg.json" -w "%{http_code}" -X POST "$BASE/api/auth/register" \
  -b "$JAR" -c "$JAR" --max-time 60 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"E2eTest!Passw0rd\",\"name\":\"E2E Stream Fix\"}")
echo "register -> HTTP $S"

echo "================ 1. HEADERS + FIRST BYTES (short turn) ================"
# -N: unbuffered so we can observe the wire as the server writes it.
curl -s -N -D "$OUT/headers.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 120 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"What is 17 * 23? Answer with just the number."}' \
  -o "$OUT/sse-short.sse" -w "total_time=%{time_total}s starttransfer=%{time_starttransfer}s\n" \
  > "$OUT/curl-stats.txt"
cat "$OUT/curl-stats.txt"
echo "--- response headers ---"
cat "$OUT/headers.txt"
echo "--- first 3 wire frames ---"
head -c 400 "$OUT/sse-short.sse"
echo; echo "--- wire summary ---"
echo "connected-comment: $(grep -c '^: connected' "$OUT/sse-short.sse")"
echo "keepalive-comment: $(grep -c '^: keepalive' "$OUT/sse-short.sse")"
echo "done-events:       $(grep -c '"done":true' "$OUT/sse-short.sse")"
echo "partial-flag:      $(grep -o '"partial":[a-z]*' "$OUT/sse-short.sse" | tail -1)"

echo "================ 2. RESEARCH TURN (silent phase must survive) ================"
curl -s -N -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 180 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"What is the current Chief Minister of Tamil Nadu? Answer briefly."}' \
  -o "$OUT/sse-research.sse" -w "total_time=%{time_total}s starttransfer=%{time_starttransfer}s\n" \
  > "$OUT/curl-stats2.txt"
cat "$OUT/curl-stats2.txt"
echo "connected-comment: $(grep -c '^: connected' "$OUT/sse-research.sse")"
echo "keepalive-comment: $(grep -c '^: keepalive' "$OUT/sse-research.sse")"
echo "stage-events:      $(grep -o '"stage":"[a-z]*"' "$OUT/sse-research.sse" | sort | uniq -c | tr '\n' ' ')"
echo "done-events:       $(grep -c '"done":true' "$OUT/sse-research.sse")"
python3 - "$OUT/sse-research.sse" << 'PYEOF'
import json, sys
deltas = []; done = False; meta = None
for line in open(sys.argv[1]):
    if line.startswith('data: '):
        try: d = json.loads(line[6:])
        except Exception: continue
        if d.get('delta'): deltas.append(d['delta'])
        if d.get('done'): done = True; meta = d.get('meta')
print('answer-complete:', done)
print('answer length:', len(''.join(deltas)))
print('answer head:', ''.join(deltas)[:150].replace('\n',' '))
print('states:', (meta or {}).get('states'))
PYEOF

echo "================ 3. MID-STREAM DISCONNECT (client goes away) ================"
# Kill the connection 1.2s into generation. The server must NOT crash, must
# contain the disconnect, and (by design) finish + persist the full answer.
CONV_BEFORE=$(curl -s -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 120 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Reply with exactly: PERSIST-CHECK"}' -o "$OUT/sse-persist.sse" -w "%{http_code}")
echo "seed turn -> HTTP $CONV_BEFORE"
CONV_ID=$(python3 -c "
import json
for line in open('$OUT/sse-persist.sse'):
    if line.startswith('data: '):
        try: d=json.loads(line[6:])
        except Exception: continue
        if d.get('conversationId'): print(d['conversationId']); break
")
echo "conversation: $CONV_ID"
# Now the interrupted turn: long generation, connection killed early.
curl -s -N -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 2 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d "{\"message\":\"Write a detailed essay of at least 600 words about the history of computing.\",\"conversationId\":\"$CONV_ID\"}" \
  -o "$OUT/sse-killed.sse" -w "curl_exit_on_timeout(expected 28) status=%{http_code}\n" || echo "curl exit $? (28 = timed out as designed)"
echo "frames-received-before-kill: $(grep -c 'data:' "$OUT/sse-killed.sse" || true)"
sleep 45  # give the server time to finish generating + persisting
curl -s "$BASE/api/riishe/conversations/$CONV_ID" -b "$JAR" -c "$JAR" --max-time 30 \
  -H "Origin: $ORIGIN" -o "$OUT/conv-after.json" -w "conv-fetch -> HTTP %{http_code}\n"
python3 - "$OUT/conv-after.json" << 'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
msgs = d.get('conversation', {}).get('messages', [])
print('messages in history:', len(msgs))
for m in msgs:
    print(f"  role={m['role']} len={len(m['content'])} head={m['content'][:60]!r}")
PYEOF
echo "================ 4. SERVER HEALTH AFTER ALL TESTS ================"
curl -s -o /dev/null -w "health -> HTTP %{http_code}\n" --max-time 10 "$BASE/api/health"
