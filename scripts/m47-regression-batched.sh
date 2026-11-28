#!/bin/bash
# M47.7 — batched regression runner (the documented sandbox strategy).
# Chunks of 30 test files; exact pass/fail/skip totals per batch; failed
# test names captured; grand totals printed at the end.
cd /home/z/my-project/m47-wt
mapfile -t FILES < <(ls tests/unit/*.test.ts tests/integration/*.test.ts | sort)
TOTAL=${#FILES[@]}
CHUNK=30
PASS_TOTAL=0; FAIL_TOTAL=0; SKIP_TOTAL=0; BATCH=0
> /tmp/m47-regression-tally.txt
for ((start=0; start<TOTAL; start+=CHUNK)); do
  group=("${FILES[@]:start:CHUNK}")
  BATCH=$((BATCH+1))
  OUTFILE=/tmp/m47-reg-batch-$BATCH.txt
  timeout 360 bun test "${group[@]}" > "$OUTFILE" 2>&1
  P=$(grep -E "^\s*[0-9]+ pass" "$OUTFILE" | head -1 | grep -oE "[0-9]+")
  F=$(grep -E "^\s*[0-9]+ fail" "$OUTFILE" | head -1 | grep -oE "[0-9]+")
  S=$(grep -E "^\s*[0-9]+ skip" "$OUTFILE" | head -1 | grep -oE "[0-9]+")
  PASS_TOTAL=$((PASS_TOTAL + ${P:-0}))
  FAIL_TOTAL=$((FAIL_TOTAL + ${F:-0}))
  SKIP_TOTAL=$((SKIP_TOTAL + ${S:-0}))
  echo "batch $BATCH: files=${#group[@]} pass=${P:-0} fail=${F:-0} skip=${S:-0}" >> /tmp/m47-regression-tally.txt
  if [ "${F:-0}" -gt 0 ]; then
    grep -E "^\(fail\)" "$OUTFILE" | head -10 >> /tmp/m47-regression-tally.txt
  fi
done
{
  echo "=== TOTALS: files=$TOTAL batches=$BATCH pass=$PASS_TOTAL fail=$FAIL_TOTAL skip=$SKIP_TOTAL ==="
} >> /tmp/m47-regression-tally.txt
cat /tmp/m47-regression-tally.txt
