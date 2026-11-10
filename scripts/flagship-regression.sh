#!/usr/bin/env bash
# Flagship regression scenarios that need NEW live evidence (real gateway).
# Scenarios 1/2/3/5 (greeting, factual, CM, Gingee) are already evidenced by
# scripts/perf-out/post.jsonl this session; this script covers 4 (PM of India
# + term), 6 (current software version), 7/11 (stale sources -> background
# labeling + verification note on a long multi-citation answer).
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/flagship-cookies.txt"
OUT="/home/z/my-project/scripts/perf-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="flagship-$(date +%s)@bean-test.dev"
PASS="Flagship#Regression!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/flagship-last" -w "%{http_code}" -X "$m" --max-time 240 "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Flagship Regression\"}")
echo "register: $R"

run_stream () { # name, message
  local name="$1"; local message="$2"
  T0=$(date +%s%3N)
  R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}")
  T1=$(date +%s%3N)
  WALL=$((T1-T0))
  cp "$OUT/flagship-last" "$OUT/regression-$name.sse"
  HTTP=$R SCEN="$name" WALL_MS="$WALL" python3 - "$OUT/flagship-last" << 'PYEOF'
import json, os, sys
scen, http, wall = os.environ['SCEN'], os.environ['HTTP'], os.environ['WALL_MS']
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
t = md.get('timings') or {}
print(f"[{scen}] http={http} wall={wall}ms total={t.get('totalMs')}ms repairMs={t.get('repairMs')} passes={t.get('solvePasses')}")
print(f"  states={md.get('states')} sources={len(md.get('sources') or [])} note={(md.get('verificationNote') or '')[:160]}")
print(f"  degraded={md.get('degraded')}")
print(f"  answer[:260]={text[:260]!r}")
PYEOF
  sleep 4
}

run_stream "pm-india-term" "Who is the current Prime Minister of India and when did his term start?"
run_stream "software-version" "What is the latest stable version of Next.js right now?"
run_stream "stale-sources" "Research the Jallikattu protests in Tamil Nadu"
echo "== done =="
