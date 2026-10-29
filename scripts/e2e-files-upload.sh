#!/bin/bash
# RIISHE capability pipeline — live E2E upload matrix through the real API.
# Registers a fresh account, uploads every fixture class, and asserts the
# ACTUAL server behavior (status + code + extraction facts).
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
FILES="/home/z/my-project/scripts/e2e-files"
mkdir -p "$OUT"

PASS=0; FAIL=0
check() { # check <name> <condition-result 0/1> <detail>
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1 — $3";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 — $3"; fi
}

# ---- account ----------------------------------------------------------------
EMAIL="e2efiles-$(date +%s)@bean.test"
REG=$(curl -s -c "$OUT/cookies.txt" -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"E2e-Files-2026!\",\"name\":\"E2E Files\"}")
echo "$REG" | grep -q '"ok":true'; check "register" $? "$EMAIL"

up() { # up <file> <outfile>
  curl -s -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/documents" -F "file=@$1" -o "$2" -w '%{http_code}'
}

# ---- supported types --------------------------------------------------------
S=$(up "$FILES/test-doc.txt" "$OUT/txt.json")
check "txt upload" $([ "$S" = 200 ] && grep -q '"kind":"text"' "$OUT/txt.json" && grep -q '"characters":112' "$OUT/txt.json"; echo $?) "$S $(head -c 200 "$OUT/txt.json")"

S=$(up "$FILES/test-doc.md" "$OUT/md.json")
check "md upload" $([ "$S" = 200 ] && grep -q '"kind":"text"' "$OUT/md.json"; echo $?) "$S"

S=$(up "$FILES/test-data.csv" "$OUT/csv.json")
check "csv upload" $([ "$S" = 200 ] && grep -q '"kind":"csv"' "$OUT/csv.json" && grep -q '"characters":56' "$OUT/csv.json"; echo $?) "$S $(head -c 200 "$OUT/csv.json")"

S=$(up "$FILES/test-doc.docx" "$OUT/docx.json")
DOCX_CHARS=$(python3 -c "import json;print(json.load(open('$OUT/docx.json'))['document']['characters'])" 2>/dev/null || echo 0)
check "docx upload extracts REAL text" $([ "$S" = 200 ] && grep -q '"kind":"docx"' "$OUT/docx.json" && [ "$DOCX_CHARS" -gt 100 ]; echo $?) "$S chars=$DOCX_CHARS"

S=$(up "$FILES/test-data.xlsx" "$OUT/xlsx.json")
check "xlsx upload extracts sheets" $([ "$S" = 200 ] && grep -q '"kind":"xlsx"' "$OUT/xlsx.json" && grep -q 'hasSummary":true' "$OUT/xlsx.json" 2>/dev/null || grep -q '"characters":[1-9]' "$OUT/xlsx.json"; echo $?) "$S $(head -c 200 "$OUT/xlsx.json")"

S=$(up "$FILES/test-chart.png" "$OUT/png.json")
check "png upload runs REAL vision analysis" $([ "$S" = 200 ] && grep -q '"kind":"image"' "$OUT/png.json" && grep -q '"hasSummary":true' "$OUT/png.json"; echo $?) "$S $(head -c 240 "$OUT/png.json")"

S=$(up "$FILES/test-audio.wav" "$OUT/wav.json")
check "wav upload attempts ASR (transcript or honest partial)" $([ "$S" = 200 ] && grep -q '"kind":"audio"' "$OUT/wav.json"; echo $?) "$S $(head -c 300 "$OUT/wav.json")"

S=$(up "$FILES/tone.wav" "$OUT/tone.json")
check "tone.wav (no speech) still handled honestly" $([ "$S" = 200 ] || [ "$S" = 422 ]; echo $?) "$S $(head -c 240 "$OUT/tone.json")"

S=$(up "$FILES/test-archive.zip" "$OUT/zip.json")
check "zip upload inspects contents" $([ "$S" = 200 ] && grep -q '"kind":"archive"' "$OUT/zip.json"; echo $?) "$S $(head -c 200 "$OUT/zip.json")"

S=$(up "$FILES/test-doc.docx" "$OUT/docx2.json")
# storage: text-family bytes are discarded — only media extensions may exist
TEXT_STORED=$(find /home/z/my-project/.uploads -type f ! -path '*/tmp/*' ! -name '*.png' ! -name '*.jpg' ! -name '*.jpeg' ! -name '*.webp' ! -name '*.gif' ! -name '*.bmp' ! -name '*.mp3' ! -name '*.wav' ! -name '*.m4a' ! -name '*.ogg' ! -name '*.flac' ! -name '*.aac' ! -name '*.mp4' ! -name '*.mov' ! -name '*.webm' ! -name '*.mkv' ! -name '*.avi' 2>/dev/null | head -1)
check "no original bytes stored for text-family kinds" $([ -z "$TEXT_STORED" ]; echo $?) "found: ${TEXT_STORED:-none}"

# media originals DO exist (image kind)
IMG_STORED=$(find /home/z/my-project/.uploads -type f -name '*.png' ! -path '*/tmp/*' 2>/dev/null | head -1)
check "image original stored outside public/ for follow-ups" $([ -n "$IMG_STORED" ]; echo $?) "$IMG_STORED"
case "$IMG_STORED" in */public/*) check "image storage NOT under public" 1 "$IMG_STORED";; *) check "image storage NOT under public" 0 "$IMG_STORED";; esac

# ---- rejected / honest failures ---------------------------------------------
S=$(up "$FILES/program.exe" "$OUT/exe.json")
check "exe refused" $([ "$S" = 415 ] || [ "$S" = 422 ]; echo $?) "$S $(head -c 200 "$OUT/exe.json")"

S=$(up "$FILES/spoofed.png" "$OUT/spoof.json")
check "spoofed png (MZ bytes) rejected by signature" $([ "$S" = 415 ] || [ "$S" = 422 ]; echo $?) "$S $(head -c 200 "$OUT/spoof.json")"

S=$(up "$FILES/evil-traversal.zip" "$OUT/evil.json")
check "traversal zip rejected" $([ "$S" = 422 ] && grep -qi 'unsafe\|traversal' "$OUT/evil.json"; echo $?) "$S $(head -c 200 "$OUT/evil.json")"

S=$(up "$FILES/huge.txt" "$OUT/huge.json")
check "26MB text rejected (25MB cap)" $([ "$S" = 422 ] || [ "$S" = 413 ]; echo $?) "$S $(head -c 160 "$OUT/huge.json")"

S=$(up "$FILES/huge.png" "$OUT/hugepng.json")
check "32MB png rejected (10MB image cap)" $([ "$S" = 422 ] || [ "$S" = 413 ]; echo $?) "$S $(head -c 160 "$OUT/hugepng.json")"

S=$(curl -s -b "$OUT/cookies.txt" -X POST "$BASE/api/riishe/documents" -o "$OUT/unknown.json" -w '%{http_code}')
check "missing file field → validation error" $([ "$S" = 400 ]; echo $?) "$S"

echo "===================="
echo "PASS=$PASS FAIL=$FAIL"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
