#!/usr/bin/env bash
# RIISHE false-verification reproduction — the four cases from the work order:
#   1. TN CM (C. Joseph Vijay, official Lok Bhavan source)
#   2. PM of India (Narendra Modi, third term June 9 2024)
#   3. Latest stable Next.js version
#   4. Gingee missing-girl investigation
# Records full SSE so the claim-support audits can be traced offline.
set -u
BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/rq-fix-cookies.txt"
OUT="/home/z/my-project/scripts/rq-fix-out"
mkdir -p "$OUT"; rm -f "$JAR"
H=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
TS=$(date +%s)
EMAIL="rq-fix-$TS@bean-test.dev"

echo "=== register ==="
curl -s -o "$OUT/reg.json" -w "HTTP %{http_code}\n" -c "$JAR" -X POST "$BASE/api/auth/register" \
  "${H[@]}" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Rq!Fix2026\",\"name\":\"RQ Fix\"}"

run_q () { # label, message
  local label="$1"; local message="$2"
  echo
  echo "=== $label ==="
  curl -s -o "$OUT/$label.sse" -w "HTTP %{http_code} in %{time_total}s\n" -b "$JAR" \
    -X POST "$BASE/api/riishe/chat?stream=1" "${H[@]}" \
    -H "Content-Type: application/json" -H "Accept: text/event-stream" \
    -d "{\"message\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$message")}" --max-time 240
}

run_q case1-tn-cm "Who is the current Chief Minister of Tamil Nadu?"
run_q case2-pm-india "Who is the current Prime Minister of India?"
run_q case3-nextjs "What is the latest stable version of Next.js?"
run_q case4-gingee "Research a current topic: Gingee girl missing"
echo
echo "saved to $OUT"
