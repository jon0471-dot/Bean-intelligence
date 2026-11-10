#!/bin/bash
# Remaining Q1-15 live retest turns, spaced for the upstream cooldown.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-evalfix-out"
COOKIE="$OUT/cookies.txt"

turn() {
  local name="$1"; local msg="$2"
  curl -s -N -b "$COOKIE" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "{\"message\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$msg")}" \
    -o "$OUT/$name.sse" --max-time 300
  python3 - "$OUT/$name.sse" <<'PYEOF'
import json, sys
path = sys.argv[1]
txt = ''; done = None; err = None
for line in open(path, encoding='utf-8', errors='replace'):
    if line.startswith('data: '):
        try: e = json.loads(line[6:])
        except Exception: continue
        if 'delta' in e: txt += e['delta']
        if e.get('done'): done = e
        if e.get('error'): err = e
status = 'OK' if (done and not done.get('partial') and not err) else f"PARTIAL/ERR ({err.get('code') if err else 'partial'})"
print(f"[{status}] {txt[:600]}")
print("---META---")
if done and done.get('meta'):
    md = done['meta']
    print('degraded:', md.get('degraded'))
    print('sources:', [(s['hostName'], (s.get('date') or '')[:10]) for s in md.get('sources', [])])
PYEOF
}

case "$1" in
  q2)  turn q2 "How does a quantum computer differ from a classical computer? Explain qubits in simple language." ;;
  q4)  turn q4 "Is there any material that can behave like both a liquid and a solid? Explain with an example." ;;
  q8)  turn q8 "Find the next number in this sequence: 2, 6, 12, 20, 30." ;;
  q10) turn q10 "If yesterday was Monday, what day will it be the day after tomorrow?" ;;
  q12) turn q12 "Who is the current Chief Minister of Tamil Nadu, and when did they take office?" ;;
  q14) turn q14 "What are the latest developments from NVIDIA?" ;;
  *) echo "usage: $0 q2|q4|q8|q10|q12|q14" ;;
esac
