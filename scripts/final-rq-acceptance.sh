#!/usr/bin/env bash
# FINAL research-quality acceptance — the EXACT work-order query:
#   "Research a current topic: Gingee girl missing"
# Records: queries, sources (URL/publisher/date/pageRead/official/social),
# dedup notes, degraded notes, states, verification, and the full answer.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/final-rq-cookies.txt"
OUT="/home/z/my-project/scripts/final-rq-out"
mkdir -p "$OUT"; rm -f "$JAR"
H=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
TS=$(date +%s)
EMAIL="final-rq-$TS@bean-test.dev"

echo "=== register ==="
curl -s -o "$OUT/reg.json" -w "HTTP %{http_code}\n" -c "$JAR" -X POST "$BASE/api/auth/register" \
  "${H[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Final!Rq2026\",\"name\":\"Final RQ\"}"

run_q () { # label, message
  local label="$1"; local message="$2"
  echo
  echo "=== $label ==="
  local T0=$(date +%s%3N)
  curl -s -o "$OUT/$label.sse" -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
    -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
    -H "Content-Type: application/json" -H "Accept: text/event-stream" \
    -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}" --max-time 240
  local T1=$(date +%s%3N)
  WALL=$((T1-T0)) LABEL="$label" python3 - "$OUT/$label.sse" << 'PYEOF'
import json, os, sys
label, wall = os.environ['LABEL'], os.environ['WALL']
deltas, meta, stages, queries, tools, errors, resets = [], None, [], [], [], [], []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith('data: '): continue
    try: e = json.loads(line[6:])
    except Exception: continue
    if e.get('type') == 'stage': stages.append(e.get('stage'))
    if isinstance(e.get('research'), dict): queries = e['research'].get('queries', [])
    if isinstance(e.get('tool'), dict): tools.append(e['tool'])
    if 'delta' in e: deltas.append(e['delta'])
    if e.get('reset') is True: resets.append(True)
    if e.get('error'): errors.append(e['error'])
    if e.get('done') is True: meta = e.get('meta') or {}
answer = ''.join(deltas)
open(f"/home/z/my-project/scripts/final-rq-out/{label}.answer.txt", 'w').write(answer)
md = meta or {}
srcs = md.get('sources') or []
print(f'[{label}] wall={wall}ms stages={" -> ".join(stages) or "NONE"}')
print(f'  queries={queries}')
if tools: print(f'  tools={tools}')
print(f'  states={md.get("states")}')
print(f'  sources={len(srcs)}')
for s in srcs:
    print(f'    [{s.get("id")}] {s.get("hostName")} | date={s.get("date")} | pageRead={s.get("pageRead")} | official={s.get("official")} | social={s.get("social")}')
    print(f'        title={str(s.get("title"))[:90]}')
    print(f'        url={s.get("url")}')
ver = md.get('verification') or []
for v in ver: print(f'  verify: {v.get("check")} = {v.get("status")} :: {str(v.get("detail"))[:130]}')
deg = md.get('degraded') or []
for d in deg: print(f'  degraded: {str(d)[:150]}')
print(f'  timings={md.get("timings")}')
print(f'  resets={len(resets)} errors={errors}')
print(f'  --- ANSWER ---')
print(answer[:1800])
PYEOF
}

run_q gingee-final "Research a current topic: Gingee girl missing"
run_q cm-final "Who is the current Chief Minister of Tamil Nadu?"
run_q stable-final "What is 17 multiplied by 23?"
echo
echo "saved to $OUT"
