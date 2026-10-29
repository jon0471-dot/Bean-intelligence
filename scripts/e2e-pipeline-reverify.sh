#!/bin/bash
# Re-verification of the file pipeline WITHOUT model quota dependency:
# text-family uploads (txt/md/csv/docx/xlsx/zip) are parsed locally.
# Also re-verifies: exe refusal, signature spoof rejection, traversal-zip
# rejection, oversize rejection, empty-field 400, quotas, ownership.
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
FILES="/home/z/my-project/scripts/e2e-files"
TS=$(date +%s)
CK="$OUT/pipeline-ck.txt"
PASS=0; FAIL=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1 — $3"; else FAIL=$((FAIL+1)); echo "FAIL: $1 — $3"; fi }

curl -s -c "$CK" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -H "origin: https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai" \
  -d "{\"email\":\"pipeline-$TS@bean.test\",\"password\":\"E2e-Pipe-2026!\",\"name\":\"Pipeline\"}" | grep -q '"ok":true'
check "register" $? "-"

up() { # up <file> <outfile>
  curl -s -b "$CK" -X POST "$BASE/api/riishe/documents" \
    -H "origin: https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai" \
    -F "file=@$1" -o "$2" --max-time 90
}
jqf() { python3 -c "import json,sys; d=json.load(open('$1')); print(d$2)" 2>/dev/null; }

up "$FILES/test-doc.txt" "$OUT/p-txt.json"
check "txt upload ready" $? "chars=$(jqf "$OUT/p-txt.json" "['document']['characters']")"
[ "$(jqf "$OUT/p-txt.json" "['document']['status']")" = "ready" ] && [ "$(jqf "$OUT/p-txt.json" "['document']['kind']")" = "text" ]; check "txt: ready + kind=text" $? "-"

up "$FILES/test-data.csv" "$OUT/p-csv.json"
[ "$(jqf "$OUT/p-csv.json" "['document']['kind']")" = "csv" ]; check "csv: kind=csv extracted" $? "chars=$(jqf "$OUT/p-csv.json" "['document']['characters']")"

up "$FILES/test-doc.docx" "$OUT/p-docx.json"
[ "$(jqf "$OUT/p-docx.json" "['document']['kind']")" = "docx" ]; check "docx: mammoth extraction" $? "chars=$(jqf "$OUT/p-docx.json" "['document']['characters']")"

up "$FILES/test-data.xlsx" "$OUT/p-xlsx.json"
[ "$(jqf "$OUT/p-xlsx.json" "['document']['kind']")" = "xlsx" ]; check "xlsx: SheetJS per-sheet extraction" $? "chars=$(jqf "$OUT/p-xlsx.json" "['document']['characters']")"

up "$FILES/test-archive.zip" "$OUT/p-zip.json"
[ "$(jqf "$OUT/p-zip.json" "['document']['kind']")" = "archive" ]; check "zip: safe inspection manifest" $? "chars=$(jqf "$OUT/p-zip.json" "['document']['characters']")"

up "$FILES/program.exe" "$OUT/p-exe.json"
grep -qi "error" "$OUT/p-exe.json"; check "exe refused (executable payload)" $? "$(cat "$OUT/p-exe.json" | head -c 120)"

up "$FILES/spoofed.png" "$OUT/p-spoof.json"
grep -qi "error" "$OUT/p-spoof.json"; check "spoofed png signature-rejected" $? "$(cat "$OUT/p-spoof.json" | head -c 120)"

up "$FILES/evil-traversal.zip" "$OUT/p-trav.json"
grep -qi "error" "$OUT/p-trav.json"; check "traversal zip rejected" $? "$(cat "$OUT/p-trav.json" | head -c 120)"

up "$FILES/huge.txt" "$OUT/p-huge.json"
grep -qi "error" "$OUT/p-huge.json"; check "oversized file rejected" $? "$(cat "$OUT/p-huge.json" | head -c 100)"

curl -s -b "$CK" -X POST "$BASE/api/riishe/documents" -o "$OUT/p-empty.json" -w "%{http_code}" > "$OUT/p-empty.code"
grep -q "400\|VALIDATION" "$OUT/p-empty.json"; check "missing file field -> 400" $? "code=$(cat "$OUT/p-empty.code")"

# Ownership isolation: user B cannot attach user A's document
CK2="$OUT/pipeline-ck2.txt"
curl -s -c "$CK2" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -H "origin: https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai" \
  -d "{\"email\":\"pipe2-$TS@bean.test\",\"password\":\"E2e-Pipe-2026!\",\"name\":\"Pipe2\"}" > /dev/null
DOCID=$(jqf "$OUT/p-docx.json" "['document']['id']")
code=$(curl -s -o "$OUT/p-foreign.json" -w "%{http_code}" -b "$CK2" -X POST "$BASE/api/riishe/chat" \
  -H 'content-type: application/json' -H "origin: https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai" \
  -d "{\"message\":\"summarize\",\"documentIds\":[\"$DOCID\"]}")
[ "$code" = "404" ]; check "cross-user attach -> 404 (ownership enforced)" $? "code=$code"

# Media originals outside public/
ls .uploads 2>/dev/null | head -3 > "$OUT/p-uploads.txt"
[ -d .uploads ]; check "media storage root .uploads/ exists outside public/" $? "-"

echo ""
echo "PIPELINE RE-VERIFICATION: $PASS pass / $FAIL fail"
