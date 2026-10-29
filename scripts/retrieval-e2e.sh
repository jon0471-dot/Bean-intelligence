#!/usr/bin/env bash
# Work-order live verification: RIISHE automatic retrieval + citations.
# Four required prompts + the exact screenshot prompt, all REAL (auth, CSRF,
# gateway search, page reads, solver). Records HTTP status, latency, stages,
# sources, citation counts and honest-degradation notes per prompt.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/retrieval-cookies.txt"
OUT="/home/z/my-project/scripts/retrieval-e2e-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="retrieval-$(date +%s)@bean-test.dev"
PASS="Retrieval#Passw0rd!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/last-body" -w "%{http_code}" -X "$m" --max-time 180 "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Retrieval Verifier\"}")
echo "register: $R"

run_stream () { # label, message
  local label="$1"; local message="$2"
  echo "---- $label"
  T0=$(date +%s%3N)
  R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}")
  T1=$(date +%s%3N)
  cp "$OUT/last-body" "$OUT/$label.sse"
  HTTP=$R WALL=$((T1-T0)) LABEL=$label MSG="$message" python3 - "$OUT/$label.sse" << 'PYEOF'
import json, os, sys
label, http, wall, message = os.environ['LABEL'], os.environ['HTTP'], os.environ['WALL'], os.environ['MSG']
raw = open(sys.argv[1]).read()
events = []
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except Exception: pass
stages = [e.get('stage') for e in events if e.get('type') == 'stage']
tool_events = [(e.get('name'), e.get('status')) for e in events if e.get('type') == 'tool']
resets = sum(1 for e in events if e.get('reset'))
done = next((e for e in events if e.get('done')), None)
md = (done or {}).get('meta') or {}
text = ''.join(e.get('delta','') for e in events if e.get('delta'))
sources = md.get('sources') or []
states = md.get('states') or []
degraded = md.get('degraded') or []
retrieved_at = md.get('retrievedAt')
# citation markers present in the answer text
import re
markers = sorted({int(m) for m in re.findall(r'\[(\d{1,2})\]', text)})
cited = [s for s in sources if s.get('id') in markers]
print(f'{label}: HTTP={http} wall={wall}ms')
print(f'  stages={stages} toolEvents={tool_events} resets={resets}')
print(f'  states={states} retrievedAt={retrieved_at}')
print(f'  sources={len(sources)} citedMarkers={markers} citedResolve={"YES" if cited else "no"}')
for s in sources[:6]:
    print(f'    [{s.get("id")}] {s.get("hostName")} | {str(s.get("date"))} | pageRead={s.get("pageRead")} | {str(s.get("title"))[:70]}')
print(f'  degraded={degraded}')
print(f'  answer[:240]={text[:240]!r}')
open(f'/home/z/my-project/scripts/retrieval-e2e-out/{label}.answer.txt','w').write(text)
PYEOF
}

run_stream cm-screenshot 'who is the cm of tamilnadu'
run_stream gingee 'Research a current topic: Gingee girl missing'
run_stream tn-cm 'Who is the Chief Minister of Tamil Nadu right now?'
run_stream nextjs 'What is the latest stable version of Next.js right now?'
run_stream hello 'Hello!'
echo "done."
