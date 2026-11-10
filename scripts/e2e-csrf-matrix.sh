#!/usr/bin/env bash
# BEAN Intelligence — E2E acceptance matrix for the cross-site rejection fix.
# All requests go through the real preview origin with the exact fetch-metadata
# a real browser sends (same-origin), cookies preserved across calls.
set -u

BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-cookies.txt"
rm -f "$JAR"

BR_HEADERS=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

req() { # method path data_outfile curl_extra...
  local method="$1" path="$2" out="$3"; shift 3
  local status ct
  status=$(curl -s -o "$out" -w "%{http_code}" -X "$method" "$BASE$path" \
    -b "$JAR" -c "$JAR" --max-time 90 "$@")
  ct=$(file -b --mime-type "$out" 2>/dev/null || echo "unknown")
  echo "### $method $path -> HTTP $status | content-type: $ct"
}

TS=$(date +%s)
EMAIL="e2e-csrf-$TS@bean-test.dev"

echo "================ 1. REGISTER (real preview origin) ================"
req POST /api/auth/register /tmp/e2e-reg.json "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"E2eTest!Passw0rd\",\"name\":\"E2E CSRF\"}"
head -c 300 /tmp/e2e-reg.json; echo

echo "================ 2. SESSION (cookie check) ================"
req GET /api/auth/session /tmp/e2e-sess.json "${BR_HEADERS[@]}"
head -c 300 /tmp/e2e-sess.json; echo

echo "================ 3. RIISHE chat (SSE, real model) ================"
req POST "/api/riishe/chat?stream=1" /tmp/e2e-riishe.sse "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"What is 17 multiplied by 23? Answer with just the number."}'
echo "--- SSE body excerpt (first 1200 chars) ---"
head -c 1200 /tmp/e2e-riishe.sse; echo
echo "--- SSE body excerpt (last 600 chars) ---"
tail -c 600 /tmp/e2e-riishe.sse; echo

echo "================ 4. CODE GIFTZ plan ================"
req POST /api/code-giftz/tasks /tmp/e2e-cg-plan.json "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"plan","prompt":"Build a URL shortener with a REST API and sqlite storage","language":"javascript"}'
echo "--- plan body excerpt (first 900 chars) ---"
head -c 900 /tmp/e2e-cg-plan.json; echo

echo "================ 5. CODE GIFTZ generate ================"
req POST /api/code-giftz/tasks /tmp/e2e-cg-gen.json "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"generate","prompt":"Write a function isPalindrome(s) that returns true if the string s is a palindrome, ignoring case","language":"javascript"}'
echo "--- generate body excerpt (first 900 chars) ---"
head -c 900 /tmp/e2e-cg-gen.json; echo

echo "================ 6. CODE GIFTZ explain ================"
req POST /api/code-giftz/tasks /tmp/e2e-cg-expl.json "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"explain","prompt":"Explain this code","codeContext":"function add(a,b){return a+b}","language":"javascript"}'
echo "--- explain body excerpt (first 600 chars) ---"
head -c 600 /tmp/e2e-cg-expl.json; echo

echo "================ 7. CODE GIFTZ review ================"
req POST /api/code-giftz/tasks /tmp/e2e-cg-rev.json "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"review","prompt":"Review this code","codeContext":"function get(t,k){return eval(t)[k]}","language":"javascript"}'
echo "--- review body excerpt (first 600 chars) ---"
head -c 600 /tmp/e2e-cg-rev.json; echo

echo "================ 8. CODE GIFTZ task history (GET, was failing UI) ================"
req GET /api/code-giftz/tasks /tmp/e2e-cg-list.json "${BR_HEADERS[@]}"
echo "--- history: number of tasks ---"
python3 -c "import json;d=json.load(open('/tmp/e2e-cg-list.json'));print(len(d.get('tasks',[])),'tasks; modes:',[t.get('mode') for t in d.get('tasks',[])])" 2>/dev/null || head -c 300 /tmp/e2e-cg-list.json

echo "================ 9. Unauthorized origins MUST stay rejected ================"
for atk in "https://evil.example.com|cross-site" "null|same-origin"; do
  o="${atk%%|*}"; sfs="${atk##*|}"
  status=$(curl -s -o /tmp/e2e-atk.json -w "%{http_code}" -X POST "$BASE/api/riishe/chat" \
    -H "Content-Type: application/json" -H "Origin: $o" -H "Sec-Fetch-Site: $sfs" \
    -d '{"message":"attack probe"}' --max-time 15)
  echo "attack Origin=$o Sec-Fetch-Site=$sfs -> HTTP $status | $(head -c 160 /tmp/e2e-atk.json)"
done

echo "================ 10. Unauthenticated mutation -> 401 (no bypass) ================"
status=$(curl -s -o /tmp/e2e-noauth.json -w "%{http_code}" -X POST "$BASE/api/riishe/chat" \
  -H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Content-Type: application/json" \
  -d '{"message":"no cookie"}' --max-time 15)
echo "no-cookie POST -> HTTP $status | $(head -c 160 /tmp/e2e-noauth.json)"

echo "================ DONE ================"
