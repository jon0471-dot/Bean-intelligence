#!/usr/bin/env bash
# RIISHE live research acceptance — real gateway, real route, real model.
# All requests through the real preview origin with browser fetch-metadata.
set -u

BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-research-cookies.txt"
rm -f "$JAR"
H=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

TS=$(date +%s)
EMAIL="e2e-research-$TS@bean-test.dev"

echo "=== register ==="
curl -s -o /tmp/rs-reg.json -w "HTTP %{http_code}\n" -c "$JAR" -X POST "$BASE/api/auth/register" \
  "${H[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Research!Pass1\",\"name\":\"Research E2E\"}"
head -c 200 /tmp/rs-reg.json; echo

echo "=== TEST 1: current-officeholder question (MUST search) ==="
echo "Q: Who is the current Chief Minister of Tamil Nadu?"
curl -s -o /tmp/rs-cm.sse -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
  -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Who is the current Chief Minister of Tamil Nadu?"}' --max-time 150

echo "--- event stream (stages/research/meta) ---"
grep -E '"type":"(stage|research)"|"done"' /tmp/rs-cm.sse | head -20

echo "--- final answer text (concatenated deltas) ---"
python3 - << 'EOF'
import json
deltas, meta = [], None
for line in open('/tmp/rs-cm.sse'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        e = json.loads(line[6:])
    except Exception:
        continue
    if 'delta' in e:
        deltas.append(e['delta'])
    if e.get('type') == 'done':
        meta = e.get('meta', {})
answer = ''.join(deltas)
print(answer[:1500])
print('...')
print('--- METADATA ---')
if meta:
    print('states:', meta.get('states'))
    print('retrievedAt:', meta.get('retrievedAt'))
    print('degraded:', meta.get('degraded'))
    print('verification:', json.dumps(meta.get('verification'), indent=1)[:600])
    for s in meta.get('sources', []):
        print(f"  [{s['id']}] {s['title'][:80]} | {s['url']} | date={s['date']} | official={s['official']} | pageRead={s['pageRead']}")
else:
    print('NO DONE EVENT')
EOF

echo
echo "=== TEST 2: stable question (must NOT search) ==="
curl -s -o /tmp/rs-math.sse -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
  -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"What is 17 multiplied by 23?"}' --max-time 90
python3 - << 'EOF'
import json
deltas, meta, stages = [], None, []
for line in open('/tmp/rs-math.sse'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        e = json.loads(line[6:])
    except Exception:
        continue
    if e.get('type') == 'stage':
        stages.append(e['stage'])
    if 'delta' in e:
        deltas.append(e['delta'])
    if e.get('type') == 'done':
        meta = e.get('meta', {})
print('answer:', ''.join(deltas)[:200])
print('stages observed:', stages)
print('researching stage present:', 'researching' in stages)
print('degraded:', meta.get('degraded') if meta else None)
print('retrievedAt:', meta.get('retrievedAt') if meta else None)
print('sources:', len(meta.get('sources', [])) if meta else 0)
EOF

rm -f "$JAR"
echo "=== DONE ==="
