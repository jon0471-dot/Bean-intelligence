#!/usr/bin/env bash
# Baseline reproduction: "Research a current topic: Gingee girl missing"
# Records the raw queries the pipeline ran, the sources selected, dates, and states.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/gingee-cookies.txt"
OUT="/home/z/my-project/scripts/retrieval-e2e-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="gingee-base-$(date +%s)@bean-test.dev"
PASS="Retrieval#Passw0rd!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/last-body" -w "%{http_code}" -X "$m" --max-time 180 "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Gingee Baseline\"}")
echo "register: $R"

T0=$(date +%s%3N)
HTTP=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d '{"message":"Research a current topic: Gingee girl missing"}')
T1=$(date +%s%3N)
cp "$OUT/last-body" "$OUT/gingee-baseline.sse"
LABEL=gingee-baseline HTTP=$HTTP WALL=$((T1-T0)) python3 - "$OUT/gingee-baseline.sse" << 'PYEOF'
import json, os, sys, re
label, http, wall = os.environ['LABEL'], os.environ['HTTP'], os.environ['WALL']
raw = open(sys.argv[1]).read()
events = []
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except Exception: pass
stages = [e.get('stage') for e in events if e.get('type') == 'stage']
research = [e for e in events if e.get('research')]
done = next((e for e in events if e.get('done')), None)
md = (done or {}).get('meta') or {}
text = ''.join(e.get('delta','') for e in events if e.get('delta'))
sources = md.get('sources') or []
states = md.get('states') or []
degraded = md.get('degraded') or []
print(f'{label}: HTTP={http} wall={wall}ms')
for r in research: print(f'  queries={r.get("research",{}).get("queries")}')
print(f'  stages={stages}')
print(f'  states={states}')
print(f'  sources={len(sources)}')
for s in sources:
    print(f'    [{s.get("id")}] {s.get("hostName")} | date={s.get("date")} | pageRead={s.get("pageRead")} | {str(s.get("title"))[:80]}')
    print(f'        url={s.get("url")}')
print(f'  degraded={degraded}')
markers = sorted(set(re.findall(r'\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]', text)))
print(f'  rawMarkersInAnswer={markers}')
open(f'/home/z/my-project/scripts/retrieval-e2e-out/{label}.answer.txt','w').write(text)
PYEOF
echo "done."
