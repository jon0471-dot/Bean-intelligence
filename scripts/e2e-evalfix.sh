#!/bin/bash
# 2026-11-02 live E2E for the Q1-15 / streaming fix verification.
# Real account, real gateway, against the platform-managed dev server on :3000
# (read-only usage — the server is NOT started/stopped/restarted by this script).
# Bounded: 4 turns total, spaced to respect the upstream 429 cooldown.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-evalfix-out"
mkdir -p "$OUT"
EMAIL="e2e-evalfix-1102@bean.dev"
PASS="EvalFix-1102-Pw!"

# --- account (register idempotently, then session) ---
CODE=$(curl -s -o "$OUT/reg.json" -w '%{http_code}' -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Eval Fix E2E\"}")
echo "register: $CODE"
curl -s -c "$OUT/cookies.txt" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o "$OUT/login.json"
echo "login: $(head -c 120 "$OUT/login.json")"

# --- turn runner: POST + stream to a file, print done/error summary ---
turn() {
  local name="$1"; local message="$2"; local extra="${3:-}"
  local t0=$(date +%s%3N)
  curl -s -N -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "{\"message\":${message}${extra}}" -o "$OUT/$name.sse" --max-time 300
  local t1=$(date +%s%3N)
  python3 - "$OUT/$name.sse" "$t0" "$t1" <<'PYEOF'
import json, sys
path, t0, t1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
deltas = 0; chars = 0; done = None; err = None; keepalives = 0
for line in open(path, encoding='utf-8', errors='replace'):
    if line.startswith(': '):
        keepalives += 1
        continue
    if line.startswith('data: '):
        try: evt = json.loads(line[6:])
        except Exception: continue
        if 'delta' in evt:
            deltas += 1; chars += len(evt['delta'])
        if evt.get('done'): done = evt
        if evt.get('error'): err = evt
print(f"deltas={deltas} chars={chars} keepalives={keepalives} wall={t1-t0}ms")
if done:
    print(f"done: partial={done.get('partial')} messageId={done.get('messageId')} durationMs={done.get('durationMs')}")
if err:
    print(f"error: code={err.get('code')} msg={err.get('error','')[:160]}")
PYEOF
}

case "$1" in
  auth) echo "auth done" ;;
  long)
    # PART 3: a long coding answer must stream to completion (JSON + code).
    turn long "\"Write a REST API tutorial for a Node.js and Express books service. Include full Express setup, a GET /books endpoint, a POST /books endpoint, and show the complete JSON response for the book list with three example books. Finish with verification steps.\""
    ;;
  scene)
    # Q13: exact-title entity search must now run.
    turn scene "\"Tell me about the movie Scene: release date, hero and villain.\""
    ;;
  nextjs)
    # Q11: version question must target official release sources.
    turn nextjs "\"What is the latest stable version of Next.js? Give its release date.\""
    ;;
  worldcup)
    # Q15: completeness of a multi-part answer.
    turn worldcup "\"Which country won the 2026 FIFA World Cup? Give the final score and goal details.\""
    ;;
  history)
    # Association check: dump the newest conversation's rows.
    curl -s -b "$OUT/cookies.txt" "$BASE/api/riishe/chat" -o "$OUT/convlist.json"
    python3 - <<'PYEOF'
import json
d = json.load(open('/home/z/my-project/scripts/e2e-evalfix-out/convlist.json'))
for c in d.get('conversations', [])[:6]:
    print(c['id'], '|', c['title'][:60], '| msgs:', c['messages'])
PYEOF
    ;;
  *) echo "usage: $0 auth|long|scene|nextjs|worldcup|history" ;;
esac
