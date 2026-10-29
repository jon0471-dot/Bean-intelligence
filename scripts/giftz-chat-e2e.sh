#!/usr/bin/env bash
# CODE GIFTZ chat-first rebuild — real-API verification (2026-10-27).
#
# Verifies against the REAL running app:
#  1. attachments parsing (text accepted, binary rejected with a reason, size cap)
#  2. chat SSE under the throttled gateway: honest error event, no fake success
#  3. project list/detail contracts (empty state, then fixture project)
#  4. REAL sandbox execution of a project (bun child process, exit code + stdout)
#  5. manual file edit (status flips to modified, version bumps)
#  6. auth/ownership guards (foreign project -> 404)
#
# The fixture project is clearly labeled and deleted at the end.
set -u
LOCAL="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/giftz-chat-cookies.txt"
rm -f "$JAR"
EMAIL="giftz-chat-$(date +%s)@bean-test.dev"
PASS="Giftz#Chat!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { curl -sS -o /tmp/cgc-body -w "%{http_code}" -X "$1" "$LOCAL$2" -b "$JAR" -c "$JAR" "${hdrs[@]}" "${@:3}"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Giftz Chat Verifier\"}")
echo "register: $R $(head -c 80 /tmp/cgc-body)"

echo "== projects: empty list =="
R=$(req GET /api/code-giftz/projects)
echo "list: $R $(head -c 80 /tmp/cgc-body)"

echo "== attachments: text file accepted =="
printf 'name,score\nalice,10\nbob,12\n' > /tmp/cgc-scores.csv
R=$(req POST /api/code-giftz/attachments -F "files=@/tmp/cgc-scores.csv;type=text/csv")
echo "csv: $R $(head -c 220 /tmp/cgc-body)"; echo

echo "== attachments: binary rejected with a plain reason =="
printf '\x89PNG\r\n\x1a\n\x00\x00binary-ish' > /tmp/cgc-fake.png
R=$(req POST /api/code-giftz/attachments -F "files=@/tmp/cgc-fake.png;type=image/png")
echo "png: $R $(head -c 260 /tmp/cgc-body)"; echo

echo "== attachments: over-cap text rejected with the size explanation =="
head -c 250000 /dev/zero | tr '\0' 'a' > /tmp/cgc-big.txt
R=$(req POST /api/code-giftz/attachments -F "files=@/tmp/cgc-big.txt;type=text/plain")
echo "big: $R $(head -c 220 /tmp/cgc-body)"; echo

echo "== chat SSE (no project): honest failure under the throttled gateway =="
R=$(req POST /api/code-giftz/chat?stream=1 -H 'content-type: application/json' -d '{"message":"Build a tiny counter web app"}')
echo "chat stream: $R"
cat /tmp/cgc-body | tr -d '\n' | head -c 500; echo; echo

echo "== chat JSON path (same honesty) =="
R=$(req POST /api/code-giftz/chat -H 'content-type: application/json' -d '{"message":"Explain what a closure is in one paragraph."}')
echo "chat json: $R $(head -c 220 /tmp/cgc-body)"; echo

echo "== fixture project (labeled, for workspace/execution verification) =="
bun /home/z/my-project/scripts/giftz-chat-fixture.ts | tee /tmp/cgc-fixture.json
PROJ=$(python3 -c "import json;print(json.load(open('/tmp/cgc-fixture.json'))['projectId'])")

echo "== project detail =="
R=$(req GET "/api/code-giftz/projects/$PROJ")
echo "detail: $R files=$(python3 -c "import json;d=json.load(open('/tmp/cgc-body'));print(len(d['project']['files']))" 2>/dev/null || head -c 80 /tmp/cgc-body)"

echo "== REAL sandbox run of the fixture project (no gateway involved) =="
R=$(req POST "/api/code-giftz/projects/$PROJ/run" -H 'content-type: application/json' -d '{"approval":true}')
echo "run: $R $(head -c 400 /tmp/cgc-body)"; echo

echo "== manual edit: app.js content change (status -> modified, version bump) =="
R=$(req POST "/api/code-giftz/projects/$PROJ/files" -H 'content-type: application/json' -d '{"path":"app.js","content":"console.log(\"edited-by-e2e\");\n"}')
echo "edit: $R $(head -c 200 /tmp/cgc-body)"; echo

echo "== REAL re-run after edit: the new output must appear =="
R=$(req POST "/api/code-giftz/projects/$PROJ/run" -H 'content-type: application/json' -d '{"approval":true,"entryPath":"app.js"}')
echo "rerun: $R $(head -c 400 /tmp/cgc-body)"; echo

echo "== ownership guard: foreign project id must 404 =="
R=$(req GET "/api/code-giftz/projects/nonexistent-id")
echo "foreign: $R $(head -c 120 /tmp/cgc-body)"; echo

echo "== run requires explicit approval =="
R=$(req POST "/api/code-giftz/projects/$PROJ/run" -H 'content-type: application/json' -d '{}')
echo "no-approval: $R $(head -c 160 /tmp/cgc-body)"; echo

echo "== cleanup fixture =="
R=$(req DELETE "/api/code-giftz/projects/$PROJ")
echo "delete: $R"
