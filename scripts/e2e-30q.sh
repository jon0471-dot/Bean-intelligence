#!/bin/bash
# 2026-11-02 live E2E — 30-question evaluation regression (work order).
# Real account, real gateway, platform-managed dev server on :3000 (read-only
# usage — never started/stopped/restarted by this script). Bounded turns,
# spaced to respect the upstream 429 breaker. Research turns: Q11/Q13/Q14/Q15/
# Q29 + Q27 (PDF upload). Non-research: Q2/Q3/Q4/Q16/Q19/Q21/Q25/Q30 +
# regression spot checks.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-30q-out"
mkdir -p "$OUT"
EMAIL="e2e-30q-1102@bean.dev"
PASS="Q30-Reg-1102-Pw!"

# --- account (register idempotently, then session) ---
CODE=$(curl -s -o "$OUT/reg.json" -w '%{http_code}' -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"30Q Eval E2E\"}")
echo "register: $CODE"
curl -s -c "$OUT/cookies.txt" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o "$OUT/login.json"
echo "login: $(head -c 100 "$OUT/login.json")"

# --- turn runner: POST + stream to file, print honest summary ---
turn() {
  local name="$1"; local message="$2"; local sleep_after="${3:-20}"
  local t0=$(date +%s%3N)
  curl -s -N -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "{\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$message")}" \
    -o "$OUT/$name.sse" --max-time 300
  local t1=$(date +%s%3N)
  python3 - "$OUT/$name.sse" "$t0" "$t1" "$name" <<'PYEOF'
import json, sys
path, t0, t1, name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
deltas = 0; chars = 0; done = None; err = None; keepalives = 0; stages = []; first_delta_at = None
text = []
for line in open(path, encoding='utf-8', errors='replace'):
    if line.startswith(': '):
        keepalives += 1
        continue
    if line.startswith('data: '):
        try: evt = json.loads(line[6:])
        except Exception: continue
        if 'delta' in evt:
            deltas += 1
            chars += len(evt['delta'])
            text.append(evt['delta'])
            if first_delta_at is None: first_delta_at = True
        if evt.get('done'): done = evt
        if evt.get('error'): err = evt
        if evt.get('stage'): stages.append(evt['stage'])
answer = ''.join(text)
open(path.replace('.sse', '.answer.txt'), 'w', encoding='utf-8').write(answer)
print(f"[{name}] deltas={deltas} chars={chars} keepalives={keepalives} wall={t1-t0}ms stages={','.join(stages) or '-'}")
if done:
    print(f"[{name}] done: partial={done.get('partial')} messageId={str(done.get('messageId'))[:8]} durationMs={done.get('durationMs')}")
if err:
    print(f"[{name}] ERROR: code={err.get('code')} msg={err.get('error','')[:140]}")
PYEOF
  sleep "$sleep_after"
}

case "$1" in
  auth) echo "auth done" ;;
  reasoning)
    # Non-research batch: Q16, Q19, Q21, Q25, Q2, Q3, Q4, Q30.
    turn q16 "In JavaScript, what does [] == false evaluate to? Explain exactly why, step by step." 8
    turn q19 "How do JavaScript arrays differ from fixed-size low-level arrays in other languages? And does a JavaScript Map preserve the insertion order of its keys?" 8
    turn q21 "In BEAN Intelligence, which product should handle a voice transcription task — LAXII or JAZMII? And which one generates images?" 8
    turn q25 "Ice cream sales and drowning deaths are strongly correlated. Does ice cream cause drowning? Explain your reasoning." 8
    turn q2 "How does a quantum computer actually differ from a classical computer? Explain superposition accurately." 8
    turn q3 "Why is the daytime sky blue, and why does light from distant stars look redder when it reaches us? Are these the same mechanism?" 8
    turn q4 "What is oobleck (cornstarch and water)? Is it a solid, a liquid, or something else? Classify its behavior precisely." 8
    turn q30 "I want you to build me an e-commerce website with payment integration. I'll use Stripe. Draft the plan — and tell me honestly: after you reply, what is the implementation status of this website?" 8
    ;;
  research)
    # Research batch (spaced for the breaker): Q11, Q29, Q13, Q14, Q15.
    turn q11 "What is the latest stable version of Next.js, and when was it released? Verify online and cite sources." 45
    turn q29 "What is the latest stable version of Node.js? Distinguish LTS from Current if both exist, give the release date, and cite official sources." 45
    turn q13 "Search online for the movie Scene: who plays the protagonist and who plays the villain in it? Cite sources." 45
    turn q14 "What are the latest developments from NVIDIA? Cite official sources." 45
    turn q15 "Who won the FIFA World Cup 2026 final, what was the exact score, and who scored the winning goal? Cite sources." 30
    ;;
  pdf)
    # Q27: upload the multi-part PDF fixture, then ask extraction questions.
    DOC=$(curl -s -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/documents" \
      -H "origin: $ORIGIN" -F "file=@/home/z/my-project/scripts/e2e-riishe-upgrade-out/bean-brief.pdf;type=application/pdf" | \
      python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["document"]["id"])')
    echo "uploaded doc: $DOC"
    turn q27 "Look at the attached PDF. How many pages does it have, and what are the key financial figures in it? Tell me exactly which pages you were able to read." 10
    ;;
  streaming)
    # PART 3: long structured answer with JSON + code must stream to completion.
    turn long-code "Write a REST API tutorial for a Node.js and Express books service. Include full Express setup, a GET /books endpoint, a POST /books endpoint, and show the complete JSON response for the book list with three example books. Finish with verification steps." 10
    # Tamil + short regression spot checks.
    turn tamil "வணக்கம்! தமிழில் சிறிய அறிமுகம் ஒன்றைத் தாருங்கள்." 8
    turn math "What is 17 * 23 - 45? Give the exact number." 8
    turn calendar "If yesterday was Monday, what day is the day after tomorrow? Derive it step by step." 8
    ;;
esac
echo "BATCH $1 COMPLETE"
