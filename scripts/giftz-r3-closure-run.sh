#!/usr/bin/env bash
# W1–W5 closure — Task A: targeted live R3 probe (N runs) on isolated :3100.
# Waits for a healthy gateway window first (bounded); exits 2 WITHOUT burning
# attempts if the window never opens. Usage: giftz-r3-closure-run.sh <runs> <max_wait>
set -u
RUNS="${1:-6}"; MAX_WAIT="${2:-240}"
BASE=http://127.0.0.1:3100
OUT=/home/z/my-project/scripts/giftz-verify-out
cd /home/z/my-project/.next/standalone
NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  DATABASE_URL=file:/home/z/my-project/scripts/giftz-verify-out/verify.db \
  bun server.js > "$OUT/server-r3-closure.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
cd /home/z/my-project

for i in $(seq 1 30); do curl -s -o /dev/null --max-time 2 "$BASE/" && break; sleep 1; done
echo "server up (pid $SERVER_PID)"

waited=0; healthy=0
while [ "$waited" -lt "$MAX_WAIT" ]; do
  AVAIL=$(curl -s --max-time 30 "$BASE/api/health" | python3 -c "import json,sys
try: print(json.load(sys.stdin)['products']['code-giftz']['available'])
except Exception: print('error')" 2>/dev/null)
  if [ "$AVAIL" = "True" ]; then echo "gateway healthy after ${waited}s"; healthy=1; break; fi
  sleep 30; waited=$((waited + 30)); echo "gateway still throttled (${waited}/${MAX_WAIT}s)…"
done
[ "$healthy" != "1" ] && { echo "GATEWAY NEVER HEALTHY — probe skipped (no attempts burned)"; exit 2; }

GIFTZ_EVAL_BASE_URL="$BASE" bun scripts/giftz-r3-probe.ts "$RUNS" "$BASE"
