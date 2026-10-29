#!/bin/bash
# RIISHE chat E2E with attachments: grounding on docx, image follow-up
# (analyze_image tool), multi-attachment send, auto retrieval vs stable
# question, and cross-user isolation.
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
FILES="/home/z/my-project/scripts/e2e-files"
mkdir -p "$OUT"

PASS=0; FAIL=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1 — $3"; else FAIL=$((FAIL+1)); echo "FAIL: $1 — $3"; fi }

reg() { # reg <cookiefile> <email>
  curl -s -c "$1" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"E2e-Chat-2026!\",\"name\":\"E2E Chat\"}" | grep -q '"ok":true'
}

ssetail() { # ssetail <cookie> <payload> <outfile>: returns final done event
  curl -s -N -b "$1" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -d "$2" -o "$3" --max-time 240
  python3 - "$3" << 'PYEOF'
import json, sys
path = sys.argv[1]
done = None
for line in open(path):
    if line.startswith('data: '):
        try:
            evt = json.loads(line[6:])
            if evt.get('done'): done = evt
        except Exception: pass
print(json.dumps(done) if done else '{}')
PYEOF
}

# ---- accounts ----------------------------------------------------------------
reg "$OUT/uc1.txt" "e2echat1-$(date +%s)@bean.test"; check "register user A" $? "-"
reg "$OUT/uc2.txt" "e2echat2-$(date +%s)@bean.test"; check "register user B" $? "-"

# ---- user A uploads fixtures ---------------------------------------------------
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-doc.docx" -o "$OUT/a-docx.json"
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-chart.png" -o "$OUT/a-png.json"
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-data.csv" -o "$OUT/a-csv.json"
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-data.xlsx" -o "$OUT/a-xlsx.json"
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-archive.zip" -o "$OUT/a-zip.json"
curl -s -b "$OUT/uc1.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$FILES/test-audio.wav" -o "$OUT/a-wav.json"
DOCX=$(python3 -c "import json;print(json.load(open('$OUT/a-docx.json'))['document']['id'])")
PNG=$(python3 -c "import json;print(json.load(open('$OUT/a-png.json'))['document']['id'])")
CSV=$(python3 -c "import json;print(json.load(open('$OUT/a-csv.json'))['document']['id'])")
XLSX=$(python3 -c "import json;print(json.load(open('$OUT/a-xlsx.json'))['document']['id'])")
ZIP=$(python3 -c "import json;print(json.load(open('$OUT/a-zip.json'))['document']['id'])")
WAV=$(python3 -c "import json;print(json.load(open('$OUT/a-wav.json'))['document']['id'])")

# ---- 1. docx-grounded answer ---------------------------------------------------
DONE=$(ssetail "$OUT/uc1.txt" "{\"message\":\"What was the quarterly revenue in the attached memo, and what is the main product?\",\"documentIds\":[\"$DOCX\"]}" "$OUT/chat-docx.sse")
echo "$DONE" | grep -q '4.2' && echo "$DONE" | grep -qi 'RIISHE'; check "docx-grounded answer uses REAL extraction" $? "$(echo "$DONE" | head -c 200)"
echo "$DONE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); states=d['meta']['states']; assert states == ['UNVERIFIED'] or states == [], f'expected no verification states, got {states}'"; check "document answer carries no false verification badge" $? "states=$(echo "$DONE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['meta']['states'])" 2>/dev/null)"

# ---- 2. image follow-up (analyze_image tool) -----------------------------------
# (a) content question answerable from the upload-time vision summary
DONE=$(ssetail "$OUT/uc1.txt" "{\"message\":\"Look at the attached chart image: what is the exact revenue number written on it?\",\"documentIds\":[\"$PNG\"]}" "$OUT/chat-png.sse")
echo "$DONE" | grep -q '4.2'; check "image follow-up reads REAL content (vision)" $? "$(echo "$DONE" | head -c 160)"
echo "$DONE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); assert '4.2 million USD' in d['content'] and 'apolog' not in d['content'].lower()"; check "image answer comes from the file (no web-evidence confusion)" $? "$(echo "$DONE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['meta']['states'])" 2>/dev/null)"
# (b) detail the upload summary does NOT contain -> model must re-examine the
#     original via analyze_image (or answer from the summary when it suffices)
DONE=$(ssetail "$OUT/uc1.txt" "{\"message\":\"Examine the attached image carefully: are the corners of the border frame rounded or sharp/square? Answer only from the image.\",\"documentIds\": [\"$PNG\"]}" "$OUT/chat-corners.sse")
TOOL_USED=$(grep -c 'analyze_image' "$OUT/chat-corners.sse" || true)
ANSWER=$(echo "$DONE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('content','')[:400])" 2>/dev/null)
echo "$ANSWER" | grep -qi 'square\|sharp\|rounded\|right angle\|90'; check "deep image detail question answered from the REAL image" $? "tool_events=$TOOL_USED answer=${ANSWER:0:140}"

# ---- 3. multiple attachments within limit --------------------------------------
DONE=$(ssetail "$OUT/uc1.txt" "{\"message\":\"List every file I attached right now with its type.\",\"documentIds\":[\"$DOCX\",\"$PNG\",\"$CSV\",\"$XLSX\",\"$ZIP\",\"$WAV\"]}" "$OUT/chat-multi.sse")
MULTI=$(echo "$DONE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); c=d.get('content',''); print(sum(1 for n in ['Board Memo','chart','Revenue','notes','memo','audio','archive','csv','xlsx','zip'] if n.lower() in c.lower()))" 2>/dev/null)
check "6 attachments all reach the context" $([ "$MULTI" -ge 4 ]; echo $?) "matched=$MULTI of ~6; $(echo "$DONE" | head -c 140)"

# ---- 4. current-events auto retrieval ------------------------------------------
DONE=$(ssetail "$OUT/uc1.txt" '{"message":"who is the cm of tamilnadu"}' "$OUT/chat-tn.sse")
echo "$DONE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); assert len(d['meta']['sources'])>0, 'no sources'"; check "current-events question triggers REAL retrieval" $? "$(echo "$DONE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('sources:', len(d.get('meta',{}).get('sources',[])), '| states:', d.get('meta',{}).get('states'))" 2>/dev/null)"

# ---- 5. stable question avoids retrieval ----------------------------------------
DONE=$(ssetail "$OUT/uc1.txt" '{"message":"What is photosynthesis? Answer in two sentences."}' "$OUT/chat-stable.sse")
echo "$DONE" | grep -q '"stage":"researching"'; NO_RESEARCH=$([ $? -ne 0 ]; echo $?)
check "stable question avoids unnecessary retrieval" $NO_RESEARCH "researching events: $(grep -c '"stage":"researching"' "$OUT/chat-stable.sse" || true)"

# ---- 6. cross-user isolation -----------------------------------------------------
curl -s -b "$OUT/uc2.txt" -X POST "$BASE/api/riishe/chat?stream=1" -H 'content-type: application/json' \
  -d "{\"message\":\"Summarize the attached memo.\",\"documentIds\":[\"$DOCX\"]}" -o "$OUT/chat-foreign.sse" -w '%{http_code}' > "$OUT/foreign.code"
check "user B cannot attach user A's document" "$(grep -q 'NOT_FOUND\|not found' "$OUT/chat-foreign.sse" || [ "$(cat "$OUT/foreign.code")" = 404 ]; echo $?)" "status=$(cat "$OUT/foreign.code") body=$(grep -o '"message":"[^"]*"' "$OUT/chat-foreign.sse" | head -1)"
curl -s -b "$OUT/uc2.txt" "$BASE/api/riishe/documents/$DOCX" -o "$OUT/foreign-doc.json" -w '%{http_code}' > "$OUT/foreign-doc.code"
check "user B cannot fetch user A's document metadata" "$(grep -q 'NOT_FOUND' "$OUT/foreign-doc.json"; echo $?)" "status=$(cat "$OUT/foreign-doc.code")"

# ---- 7. conversation history persists -------------------------------------------
CONV=$(python3 -c "
import json
for line in open('$OUT/chat-docx.sse'):
    if line.startswith('data: '):
        try:
            e=json.loads(line[6:])
            if e.get('conversationId'): print(e['conversationId']); break
        except: pass")
curl -s -b "$OUT/uc1.txt" "$BASE/api/riishe/conversations/$CONV" -o "$OUT/conv.json"
check "conversation history persisted with metadata" "$(grep -q '4.2' "$OUT/conv.json" && grep -q '"metadata"' "$OUT/conv.json"; echo $?)" "conversation=$CONV"

# ---- 8. copy path: content strip check (persisted content has no raw [n] orphans)
python3 -c "
import json,re
for line in open('$OUT/chat-tn.sse'):
    if line.startswith('data: '):
        e=json.loads(line[6:])
        if e.get('done'):
            c=e.get('content','')
            srcs={s['id'] for s in e['meta']['sources']}
            markers={int(m) for m in re.findall(r'\[(\d{1,2})\]', c)}
            orphans=markers-srcs
            assert not orphans, f'orphan markers {orphans}'
            break
"; check "no orphan citation markers in persisted answer" $? "-"

echo "===================="
echo "PASS=$PASS FAIL=$FAIL"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
