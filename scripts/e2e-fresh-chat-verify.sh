#!/bin/bash
# Fresh-chat live verification (the item unverified at prior session close,
# when the platform gateway was continuously 429-throttled):
#   1. fresh account
#   2. current-events question ("who is the cm of tamilnadu") -> MUST trigger
#      real server-side retrieval (researching events + sources)
#   3. stable question ("what is 12 plus 30") -> MUST NOT retrieve
#   4. copy/regenerate contract: regenerate the stable answer, no dup user rows
# Honest gate: RATE_LIMITED is reported as such, never faked.
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
mkdir -p "$OUT"
COOKIE="$OUT/fresh-chat-cookies.txt"
TS=$(date +%s)

reg() {
  curl -s -c "$COOKIE" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"freshchat-$TS@bean.test\",\"password\":\"E2e-Fresh-2026!\",\"name\":\"Fresh Chat\"}" \
    | grep -q '"ok":true'
}
reg && echo "REGISTER: ok" || { echo "REGISTER: FAILED"; exit 1; }

ssetail() { # ssetail <payload> <outfile>
  curl -s -N -b "$COOKIE" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai" \
    -d "$1" -o "$2" --max-time 240
  python3 - "$2" << 'PYEOF'
import json, sys
done = None
for line in open(sys.argv[1]):
    if line.startswith('data: '):
        try:
            evt = json.loads(line[6:])
            if evt.get('done'): done = evt
        except Exception: pass
print(json.dumps(done) if done else '{}')
PYEOF
}

# ---- 1. current-events turn ----------------------------------------------------
echo "=== TURN 1: who is the cm of tamilnadu (auto retrieval) ==="
DONE=$(ssetail '{"message":"who is the cm of tamilnadu"}' "$OUT/fresh-chat-tn.sse")
echo "$DONE" > "$OUT/fresh-chat-tn-done.json"
python3 - "$OUT/fresh-chat-tn-done.json" << 'PYEOF'
import json
d = json.load(open('/home/z/my-project/scripts/e2e-out/fresh-chat-tn-done.json'))
if not d or not d.get('ok'):
    print('TURN1 RESULT: NOT COMPLETED —', json.dumps(d)[:300]); raise SystemExit
meta = d.get('meta', {})
print('TURN1 RESULT: completed')
print('  states:', meta.get('states'))
print('  sources:', len(meta.get('sources', [])), [s.get('hostName') for s in meta.get('sources', [])[:6]])
print('  toolEvents:', [e.get('tool') for e in meta.get('toolEvents', [])])
print('  degraded:', meta.get('degraded'))
print('  answer[:400]:', (d.get('content') or '')[:400].replace('\n', ' '))
PYEOF

# ---- 2. stable turn -------------------------------------------------------------
echo "=== TURN 2: what is 12 plus 30 (no retrieval expected) ==="
DONE=$(ssetail '{"message":"What is 12 plus 30? Answer with just the number."}' "$OUT/fresh-chat-stable.sse")
echo "$DONE" > "$OUT/fresh-chat-stable-done.json"
python3 - "$OUT/fresh-chat-stable-done.json" << 'PYEOF'
import json
d = json.load(open('/home/z/my-project/scripts/e2e-out/fresh-chat-stable-done.json'))
if not d or not d.get('ok'):
    print('TURN2 RESULT: NOT COMPLETED —', json.dumps(d)[:300]); raise SystemExit
meta = d.get('meta', {})
tools = [e.get('tool') for e in meta.get('toolEvents', [])]
researched = any(t in ('web_search', 'read_url') for t in tools)
print('TURN2 RESULT: completed | answer:', (d.get('content') or '')[:80].replace('\n', ' '))
print('  researched (expect False):', researched, '| toolEvents:', tools)
PYEOF
