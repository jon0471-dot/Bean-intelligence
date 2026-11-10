#!/bin/bash
# 2026-11-02 — PENDING live re-runs from the 30-question eval session.
# The previous run verified 14 turns live but the authorized gateway began
# returning REAL HTTP 429 on chat completions partway through. Four cells
# were left pending: Q11 (Next.js patch-level latest), Q29 (Node.js LTS vs
# Current), Q15 (FIFA 2026 final — honest degradation confirmed, retry
# needed for the researched answer), Q27 (multi-page PDF extraction QA).
# This script WAITS for the quota window to clear (sparse /api/health
# probes — never restarts the platform server) and then runs the pending
# turns with generous spacing to respect the breaker.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-30q-out"
mkdir -p "$OUT"
EMAIL="e2e-30q-1102@bean.dev"
PASS="Q30-Reg-1102-Pw!"
DOC_ID="cmvypqp7d00fvrmvnht5pj9pr" # bean-multipage.pdf uploaded 2026-11-02T03:42 (same account)

# --- session (idempotent) ---
curl -s -c "$OUT/cookies.txt" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o "$OUT/login.json"
echo "login: $(head -c 80 "$OUT/login.json")"

# --- wait for the chat-class quota window to clear (bounded 40 min) ---
probe() {
  curl -s "$BASE/api/health" --max-time 20 | \
    python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print("healthy" if d.get("products",{}).get("riishe",{}).get("available") else "limited")
except Exception:
  print("unreachable")'
}
for i in $(seq 1 10); do
  STATE=$(probe)
  echo "[$(date +%H:%M:%S)] gateway chat probe: $STATE"
  if [ "$STATE" = "healthy" ]; then break; fi
  if [ "$i" -lt 10 ]; then sleep 240; fi
done
if [ "$(probe)" != "healthy" ]; then
  echo "QUOTA STILL LIMITED after wait window — pending turns NOT executed."
  exit 2
fi

# --- turn runner (identical contract to e2e-30q.sh) ---
turn() {
  local name="$1"; local message="$2"; local sleep_after="${3:-45}"; local doc_ids="${4:-}"
  local t0=$(date +%s%3N)
  curl -s -N -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "{\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$message")$( [ -n "$doc_ids" ] && printf ',"documentIds":["%s"]' "$doc_ids")}" \
    -o "$OUT/$name.sse" --max-time 300
  local t1=$(date +%s%3N)
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
    print(f"[{name}] done: partial={done.get('partial')} messageId={str(done.get('messageId'))[:8]} durationMs={done.get('durationMs')}")
if err:
    print(f"[{name}] ERROR: code={err.get('code')} msg={err.get('error','')[:140]}")
PYEOF
  sleep "$sleep_after"
}

case "${1:-pending}" in
  pending)
    turn q11d "What is the latest stable version of Next.js, and when was it released? Verify online and cite sources." 60
    turn q29f "What is the latest stable version of Node.js? Distinguish LTS from Current if both exist, give the release date, and cite official sources." 60
    turn q15b "Who won the FIFA World Cup 2026 final, what was the exact score, and who scored the winning goal? Cite sources." 60
    turn q27 "Look at the attached PDF. How many pages does it have, and what are the key financial figures in it? Tell me exactly which pages you were able to read." 20 "$DOC_ID"
    ;;
  streaming)
    # Streaming/regression batch (non-research, cheap): long structured answer,
    # Tamil multibyte integrity, math, calendar.
    turn long-code2 "Write a REST API tutorial for a Node.js and Express books service. Include full Express setup, a GET /books endpoint, a POST /books endpoint, and show the complete JSON response for the book list with three example books. Finish with verification steps." 15
    turn tamil2 "வணக்கம்! தமிழில் சிறிய அறிமுகம் ஒன்றைத் தாருங்கள்." 12
    turn math2 "What is 17 * 23 - 45? Give the exact number." 12
    turn calendar2 "If yesterday was Monday, what day is the day after tomorrow? Derive it step by step." 12
    ;;
  *) echo "unknown batch"; exit 1 ;;
esac
echo "PENDING BATCH COMPLETE"
