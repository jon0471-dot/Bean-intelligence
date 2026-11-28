#!/usr/bin/env bash
# M50.3 verification tooling — per-file hermetic census (the repo's
# established memory-safe procedure: one bun process per test file).
# Usage: m502-census.sh <worktree-path> <output-report-path>
set -u
WT="$1"
OUT="$2"
cd "$WT" || exit 2
FILES=$(ls tests/unit/*.test.ts tests/integration/*.test.ts 2>/dev/null | sort)
TOTAL_FILES=0; TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SKIP=0; FAILED_FILES=""
for f in $FILES; do
  TOTAL_FILES=$((TOTAL_FILES+1))
  RES=$(timeout 300 bun test "$f" 2>&1)
  P=$(echo "$RES" | grep -oE "^ +([0-9]+) pass" | grep -oE "[0-9]+" | head -1)
  F=$(echo "$RES" | grep -oE "^ +([0-9]+) fail" | grep -oE "[0-9]+" | head -1)
  S=$(echo "$RES" | grep -oE "^ +([0-9]+) skip" | grep -oE "[0-9]+" | head -1)
  P=${P:-0}; F=${F:-0}; S=${S:-0}
  TOTAL_PASS=$((TOTAL_PASS+P)); TOTAL_FAIL=$((TOTAL_FAIL+F)); TOTAL_SKIP=$((TOTAL_SKIP+S))
  if [ "$F" != "0" ]; then FAILED_FILES="$FAILED_FILES $f($F)"; echo "FAIL: $f ($F failures)" >> "$OUT"; fi
done
echo "FILES=$TOTAL_FILES PASS=$TOTAL_PASS FAIL=$TOTAL_FAIL SKIP=$TOTAL_SKIP" >> "$OUT"
echo "FAILED_FILES:$FAILED_FILES" >> "$OUT"
