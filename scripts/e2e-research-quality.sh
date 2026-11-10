#!/usr/bin/env bash
# RIISHE research-quality acceptance — the EXACT query from the task:
#   "Research a current topic: Gingee girl missing"
# Real gateway, real route, real model. Records actual source URLs,
# publishers, publication dates, dedup handling and answer support.
set -u

BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-quality-cookies.txt"
rm -f "$JAR"
H=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

TS=$(date +%s)
EMAIL="e2e-quality-$TS@bean-test.dev"

echo "=== register ==="
curl -s -o /tmp/rq-reg.json -w "HTTP %{http_code}\n" -c "$JAR" -X POST "$BASE/api/auth/register" \
  "${H[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Quality!Pass1\",\"name\":\"Quality E2E\"}"
head -c 160 /tmp/rq-reg.json; echo

echo
echo "=== TEST 1 (acceptance): Research a current topic: Gingee girl missing ==="
curl -s -o /tmp/rq-gingee.sse -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
  -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Research a current topic: Gingee girl missing"}' --max-time 240

python3 - << 'EOF'
import json
deltas, meta = [], None
stages, queries, tools = [], [], []
for line in open('/tmp/rq-gingee.sse'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        e = json.loads(line[6:])
    except Exception:
        continue
    if e.get('type') == 'stage':
        stages.append(e['stage'])
    if e.get('type') == 'research':
        queries = e.get('research', {}).get('queries', [])
    if 'tool' in e:
        tools.append(e['tool'])
    if 'delta' in e:
        deltas.append(e['delta'])
    if e.get('type') == 'done':
        meta = e.get('meta', {})
answer = ''.join(deltas)
print('stages:', ' -> '.join(stages) if stages else 'NONE')
print('queries:', queries)
print('tool events:', tools)
print('--- ANSWER (full) ---')
print(answer)
print('--- METADATA ---')
if meta:
    print('states:', meta.get('states'))
    print('retrievedAt:', meta.get('retrievedAt'))
    print('degraded:')
    for d in meta.get('degraded', []):
        print('  -', d)
    print('verification:')
    for v in meta.get('verification', []):
        print(f"  [{v['status']}] {v['check']}: {v['detail'][:140]}")
    print(f"sources ({len(meta.get('sources', []))}) — checking dedup:")
    seen = set()
    dups = 0
    for s in meta.get('sources', []):
        key = s['url'].split('?')[0].rstrip('/')
        tag = 'DUP!' if key in seen else ''
        if tag: dups += 1
        seen.add(key)
        print(f"  [{s['id']}] {s['title'][:70]} | {s['url'][:90]} | host={s['hostName']} | date={s['date']} | official={s.get('official')} social={s.get('social')} pageRead={s['pageRead']} {tag}")
    print('duplicate URLs in final list:', dups)
else:
    print('NO DONE EVENT')
EOF

echo
echo "=== TEST 2: plain researched question (officeholder; synthesis but no sensitive protocol) ==="
curl -s -o /tmp/rq-cm.sse -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
  -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Who is the current Chief Minister of Tamil Nadu?"}' --max-time 240

python3 - << 'EOF'
import json
deltas, meta = [], None
for line in open('/tmp/rq-cm.sse'):
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
print('--- ANSWER (first 900 chars) ---')
print(answer[:900])
print('--- METADATA (compact) ---')
if meta:
    print('states:', meta.get('states'))
    print('degraded count:', len(meta.get('degraded', [])))
    for v in meta.get('verification', []):
        print(f"  [{v['status']}] {v['check']}")
    seen = set()
    dups = 0
    for s in meta.get('sources', []):
        key = s['url'].split('?')[0].rstrip('/')
        if key in seen: dups += 1
        seen.add(key)
        print(f"  [{s['id']}] {s['title'][:60]} | {s['url'][:80]} | date={s['date']}")
    print('duplicate URLs in final list:', dups)
else:
    print('NO DONE EVENT')
EOF

echo
echo "=== TEST 3: stable question (must NOT search) ==="
curl -s -o /tmp/rq-math.sse -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
  -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"What is 17 multiplied by 23?"}' --max-time 120

python3 - << 'EOF'
import json
deltas, meta = [], None
stages = []
for line in open('/tmp/rq-math.sse'):
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
answer = ''.join(deltas)
print('answer:', answer[:300].replace('\n', ' '))
print('stages:', stages)
if meta:
    print('states:', meta.get('states'))
    print('retrievedAt present:', 'retrievedAt' in meta)
    print('sources:', len(meta.get('sources', [])))
EOF
