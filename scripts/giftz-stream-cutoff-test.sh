#!/usr/bin/env bash
# Disambiguate the ~30s streaming cutoff: public ingress vs direct localhost.
# Same dev server (:3000), same account type, same long prompt.
set -u
OUT=/home/z/my-project/scripts/giftz-verify-out
PUB="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOC="http://127.0.0.1:3000"
PROMPT='Build THREE complete mini apps in one project, every file fully written: (1) task-manager with index.html, styles.css, app.js (task form with title, priority, due date, list rendering, filter buttons, stats bar, localStorage); (2) pomodoro timer with its own timer.html, timer.css, timer.js (work/break cycles, sound toggle, progress ring); (3) sticky-notes app with notes.html, notes.css, notes.js (add, drag, color, delete, localStorage). Include a README.md summarizing all three apps.'
TS=$(date +%s)

run_one(){ # $1=base $2=label
  local BASE="$1" LABEL="$2"
  local COOKIE="/tmp/gz-$LABEL-cookies.txt"
  local EMAIL="gz-streamtest-$LABEL-$TS@bean-test.dev"
  curl -s -c "$COOKIE" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
    -H "Origin: $BASE" -d "{\"email\":\"$EMAIL\",\"password\":\"StreamTest2026x\",\"name\":\"Stream Test $LABEL\"}" \
    -o /dev/null
  echo "--- $LABEL: register done, starting long stream ($(date +%H:%M:%S))"
  curl -s -N --max-time 180 -b "$COOKIE" -X POST "$BASE/api/code-giftz/chat?stream=1" \
    -H 'content-type: application/json' -H "Origin: $BASE" \
    -d "{\"message\":\"$PROMPT\"}" -o "$OUT/stream-$LABEL.sse" -w "http=%{http_code} time_total=%{time_total}s\n"
  python3 - "$OUT/stream-$LABEL.sse" "$LABEL" << 'PYEOF'
import json, sys
raw = open(sys.argv[1]).read()
frames = []
for chunk in raw.split('\n\n'):
    for line in chunk.split('\n'):
        if line.startswith('data: '):
            try: frames.append(json.loads(line[6:]))
            except Exception: pass
deltas = [f for f in frames if 'delta' in f]
terms = [f for f in frames if 'done' in f or 'error' in f]
chars = sum(len(d['delta']) for d in deltas)
print(f"[{sys.argv[2]}] frames={len(frames)} deltas={len(deltas)} chars={chars}")
for t in terms:
    k = 'done' if 'done' in t else 'error'
    print(f"[{sys.argv[2]}] terminal({k}):", json.dumps({k: t[k], **({'code': t['code']} if 'code' in t else {}), **({'partial': t['partial']} if 'partial' in t else {})})[:160])
PYEOF
}

run_one "$PUB" "public"
# ingress-only: run the >30s public test twice
run_one "$PUB" "public2"
run_one "$PUB" "public3"
