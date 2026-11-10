#!/usr/bin/env bash
# RIISHE performance measurement (real gateway, real retrieval).
# Usage: perf-measure.sh <label>            label: baseline | post
# Runs the four latency scenarios with fixed sample counts, appending one
# JSON line per run to scripts/perf-out/<label>.jsonl. Server-measured
# timings come from the done event (firstTokenMs + meta.timings); wall time
# is measured client-side. Sample counts are quota-conscious (shared gateway).
set -u
LABEL="${1:-baseline}"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/perf-cookies-$LABEL.txt"
OUT="/home/z/my-project/scripts/perf-out"
mkdir -p "$OUT"; rm -f "$JAR" "$OUT/$LABEL.jsonl"
EMAIL="perf-$LABEL-$(date +%s)@bean-test.dev"
PASS="Perf#Measure!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/last-body-$LABEL" -w "%{http_code}" -X "$m" --max-time 240 "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== auth ($LABEL) =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Perf $LABEL\"}")
echo "register: $R"

run_stream () { # label-name, message
  local name="$1"; local message="$2"
  T0=$(date +%s%3N)
  R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}")
  T1=$(date +%s%3N)
  WALL=$((T1-T0))
  cp "$OUT/last-body-$LABEL" "$OUT/$LABEL-$name-$RANDOM.sse"
  HTTP=$R SCEN="$name" MSG="$message" WALL_MS="$WALL" LABEL="$LABEL" python3 - "$OUT/last-body-$LABEL" >> "$OUT/$LABEL.jsonl" << 'PYEOF'
import json, os, sys
scen, label, http, wall, message = os.environ['SCEN'], os.environ['LABEL'], os.environ['HTTP'], os.environ['WALL_MS'], os.environ['MSG']
raw = open(sys.argv[1]).read()
events = []
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except Exception: pass
done = next((e for e in events if e.get('done')), None)
err = next((e for e in events if e.get('error')), None)
md = (done or {}).get('meta') or {}
text = ''.join(e.get('delta','') for e in events if e.get('delta'))
rec = {
  'label': label, 'scenario': scen, 'http': int(http), 'wallClientMs': int(wall),
  'message': message,
  'firstTokenMs': (done or {}).get('firstTokenMs'),
  'durationServerMs': (done or {}).get('durationMs'),
  'timings': md.get('timings'),
  'states': md.get('states'),
  'sources': len(md.get('sources') or []),
  'degraded': md.get('degraded') or [],
  'error': (err or {}).get('error'),
  'answerChars': len(text),
  'answerHead': text[:160],
}
print(json.dumps(rec))
PYEOF
  echo "  ($name -> http $R, ${WALL}ms)"
  sleep 4
}

# Fixed sample counts, quota-conscious: greeting 5, factual 5, current-affairs 3, multi-source 2.
for i in 1 2 3 4 5; do run_stream "greeting" "Hi"; done
for i in 1 2 3 4 5; do run_stream "factual" "Who wrote the play Hamlet?"; done
for i in 1 2 3; do run_stream "current-affairs" "Who is the Chief Minister of Tamil Nadu right now?"; done
for i in 1 2; do run_stream "multi-source" "Research a current topic: Gingee girl missing"; done
echo "== done: $OUT/$LABEL.jsonl =="
