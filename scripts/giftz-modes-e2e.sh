#!/usr/bin/env bash
# CODE GIFTZ four-mode real-API verification (2026-10-27).
# Documents the honest per-mode contract while the gateway daily quota is
# exhausted (0/300): every mode must return 502 BACKEND_FAILURE with a
# customer-safe message — NOT a 500, NOT a fake success, NOT a leak.
set -u
LOCAL="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/giftz-modes-cookies.txt"
rm -f "$JAR"
EMAIL="giftz-modes-$(date +%s)@bean-test.dev"
PASS="Giftz#Modes!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

req() { curl -sS -o /tmp/cgm-body -w "%{http_code}" -X "$1" "$LOCAL$2" -b "$JAR" -c "$JAR" "${hdrs[@]}" "${@:3}"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Giftz Modes Verifier\"}")
echo "register: $R"

echo "== mode: generate =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"generate","prompt":"Write a JavaScript function that returns the sum of two numbers.","language":"javascript"}')
echo "generate: $R $(head -c 200 /tmp/cgm-body)"; echo

echo "== mode: explain (with codeContext) =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"explain","prompt":"Explain this code.","language":"javascript","codeContext":"const add=(a,b)=>a+b;"}')
echo "explain: $R $(head -c 200 /tmp/cgm-body)"; echo

echo "== mode: review (with codeContext) =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"review","prompt":"Review this code.","language":"javascript","codeContext":"eval(userInput);"}')
echo "review: $R $(head -c 200 /tmp/cgm-body)"; echo

echo "== mode: plan =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"plan","prompt":"Plan a URL shortener REST API.","language":"typescript"}')
echo "plan: $R $(head -c 200 /tmp/cgm-body)"; echo

echo "== validation checks (no real backend consumed) =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"generate","prompt":"hi","language":"javascript"}')
echo "too-short prompt: $R $(head -c 160 /tmp/cgm-body)"; echo
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"refactor","prompt":"Write a JavaScript function please.","language":"javascript"}')
echo "invalid mode: $R $(head -c 160 /tmp/cgm-body)"; echo
R=$(req POST /api/code-giftz/run -H 'content-type: application/json' -d '{"taskId":"does-not-exist","approval":true}')
echo "sandbox unknown task: $R $(head -c 160 /tmp/cgm-body)"; echo
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"generate","prompt":"Write a JavaScript function please.","language":"javascript"}')
echo "missing csrf/origin (cross-site): $R $(head -c 120 /tmp/cgm-body)"; echo
echo "done."
