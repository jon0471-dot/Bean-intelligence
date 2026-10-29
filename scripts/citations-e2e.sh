#!/usr/bin/env bash
# Work-order live verification: clean citations + verification UX + stale-news fix.
# Matrix: greeting, math, CM current-events, Gingee case, old-reporting, unrelated-results.
# Records HTTP status, latency, stages, queries, sources (with dates), states,
# verification notes, degraded notes, and raw markers per prompt.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/citations-cookies.txt"
OUT="/home/z/my-project/scripts/retrieval-e2e-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="citations-$(date +%s)@bean-test.dev"
PASS="Retrieval#Passw0rd!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/last-body" -w "%{http_code}" -X "$m" --max-time 240 "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Citations Verifier\"}")
echo "register: $R"

run_stream () { # label, message
  local label="$1"; local message="$2"
  echo "---- $label"
  T0=$(date +%s%3N)
  R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}")
  T1=$(date +%s%3N)
  cp "$OUT/last-body" "$OUT/$label.sse"
  HTTP=$R WALL=$((T1-T0)) LABEL=$label MSG="$message" python3 - "$OUT/$label.sse" << 'PYEOF'
import json, os, sys, re
label, http, wall, message = os.environ['LABEL'], os.environ['HTTP'], os.environ['WALL'], os.environ['MSG']
raw = open(sys.argv[1]).read()
events = []
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except Exception: pass
stages = [e.get('stage') for e in events if e.get('type') == 'stage']
research = [e.get('research', {}).get('queries') for e in events if e.get('research')]
resets = sum(1 for e in events if e.get('reset'))
done = next((e for e in events if e.get('done')), None)
md = (done or {}).get('meta') or {}
text = ''.join(e.get('delta','') for e in events if e.get('delta'))
sources = md.get('sources') or []
states = md.get('states') or []
degraded = md.get('degraded') or []
note = md.get('verificationNote')
msg_id = (done or {}).get('messageId')
print(f'{label}: HTTP={http} wall={wall}ms msgId={msg_id}')
print(f'  prompt: {message}')
print(f'  stages={stages} resets={resets}')
if research: print(f'  queries={research}')
print(f'  states={states}')
print(f'  sources={len(sources)}')
for s in sources:
    print(f'    [{s.get("id")}] {s.get("hostName")} | date={s.get("date")} | {str(s.get("title"))[:70]}')
markers = sorted(set(re.findall(r'\[(\d{1,2})\]', text)))
resolved = {s.get("id") for s in sources}
orphan = [m for m in markers if int(m) not in resolved]
print(f'  rawMarkersInPersistedText={markers} ORPHANS={orphan}')
print(f'  verificationNote={note}')
print(f'  degraded={degraded}')
open(f'/home/z/my-project/scripts/retrieval-e2e-out/{label}.answer.txt','w').write(text)
PYEOF
}

LABELS="${*:-hello math cm gingee old-reporting unrelated}"
for label in $LABELS; do
  case "$label" in
    hello) run_stream hello 'Hello!' ;;
    math) run_stream math 'What is 17 * 23 + 8 / 2? Show the steps.' ;;
    cm) run_stream cm 'who is the cm of tamilnadu' ;;
    gingee) run_stream gingee 'Research a current topic: Gingee girl missing' ;;
    old-reporting) run_stream old-reporting 'Research the Jallikattu protests in Tamil Nadu — what happened?' ;;
    unrelated) run_stream unrelated 'Research a current topic: Gingee airport inauguration' ;;
  esac
done
echo "done."
