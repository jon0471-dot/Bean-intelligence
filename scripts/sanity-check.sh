#!/usr/bin/env bash
# Post-restart sanity: one live retrieval round on the exact screenshot prompt.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/sanity-cookies.txt"
OUT="/home/z/my-project/scripts/retrieval-e2e-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="sanity-$(date +%s)@bean-test.dev"
PASS="Sanity#Passw0rd!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
R=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$LOCAL/api/auth/register" -H 'content-type: application/json' "${hdrs[@]}" -b "$JAR" -c "$JAR" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Sanity\"}")
echo "register: $R"
T0=$(date +%s%3N)
R=$(curl -sS -o "$OUT/sanity.sse" -w "%{http_code}" -X POST --max-time 120 "$LOCAL/api/riishe/chat?stream=1" -H 'content-type: application/json' "${hdrs[@]}" -b "$JAR" -c "$JAR" -d '{"message":"who is the cm of tamilnadu"}')
T1=$(date +%s%3N)
HTTP=$R WALL=$((T1-T0)) python3 - "$OUT/sanity.sse" << 'PYEOF'
import json, os, sys
raw = open(sys.argv[1]).read()
events = []
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except Exception: pass
stages = [e.get('stage') for e in events if e.get('type') == 'stage']
done = next((e for e in events if e.get('done')), None)
md = (done or {}).get('meta') or {}
text = ''.join(e.get('delta','') for e in events if e.get('delta'))
sources = md.get('sources') or []
print(f"sanity: HTTP={os.environ['HTTP']} wall={os.environ['WALL']}ms stages={stages}")
print(f"  states={md.get('states')} sources={len(sources)} retrievedAt={md.get('retrievedAt')}")
hosts = [s.get('hostName') for s in sources]
print(f"  hosts={hosts}")
print(f"  answer[:160]={text[:160]!r}")
PYEOF
