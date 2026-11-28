#!/bin/bash
# M47.7 — PER-FILE regression run: the hermetic strategy. Each test file
# runs in its own bun process, so mock.module leakage across files cannot
# interfere. Exact per-file result lines are tallied; failures listed.
cd /home/z/my-project/m47-wt
mapfile -t FILES < <(ls tests/unit/*.test.ts tests/integration/*.test.ts | sort)
TOTAL=${#FILES[@]}
START=${1:-0}
END=${2:-$TOTAL}
PASS=0; FAIL=0; SKIP=0; RAN=0
> /tmp/m47-perfile-failures.txt
for ((i=START; i<END && i<TOTAL; i++)); do
  f="${FILES[$i]}"
  OUT=$(timeout 120 bun test "$f" 2>&1)
  P=$(echo "$OUT" | grep -E "^\s*[0-9]+ pass" | head -1 | grep -oE "[0-9]+")
  F=$(echo "$OUT" | grep -E "^\s*[0-9]+ fail" | head -1 | grep -oE "[0-9]+")
  S=$(echo "$OUT" | grep -E "^\s*[0-9]+ skip" | head -1 | grep -oE "[0-9]+")
  if [ -z "$P" ] && [ -z "$F" ]; then
    echo "NO-RUN $f" >> /tmp/m47-perfile-failures.txt
    continue
  fi
  RAN=$((RAN+1))
  PASS=$((PASS + ${P:-0})); FAIL=$((FAIL + ${F:-0})); SKIP=$((SKIP + ${S:-0}))
  if [ "${F:-0}" -gt 0 ]; then
    echo "FAILFILE $f (${F} fails)" >> /tmp/m47-perfile-failures.txt
  fi
done
echo "=== PER-FILE TOTALS: ran=$RAN files pass=$PASS fail=$FAIL skip=$SKIP (range $START..$END of $TOTAL) ==="
