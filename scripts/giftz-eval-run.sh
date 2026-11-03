#!/usr/bin/env bash
# GIFTZ live eval on the isolated :3100 verification instance.
# Usage: giftz-eval-run.sh <stream|bench> <max_wait_seconds>
# - starts the standalone production build on :3100 (own DB copy)
# - waits for the upstream gateway to leave its global 429 window
#   (probes the app's own /api/health, which does a live gateway probe)
# - runs the requested eval pack, then stops the server
set -u
MODE="$1"; MAX_WAIT="${2:-300}"
BASE=http://127.0.0.1:3100

cd /home/z/my-project/.next/standalone
NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  DATABASE_URL=file:/home/z/my-project/scripts/giftz-verify-out/verify.db \
  bun server.js > /home/z/my-project/scripts/giftz-verify-out/server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -s -o /dev/null --max-time 2 "$BASE/" && break
  sleep 1
done
echo "server up (pid $SERVER_PID)"

# Wait for a clear gateway window before burning eval attempts.
waited=0
healthy=0
while [ "$waited" -lt "$MAX_WAIT" ]; do
  AVAIL=$(curl -s --max-time 30 "$BASE/api/health" | python3 -c "import json,sys
try: print(json.load(sys.stdin)['products']['riishe']['available'])
except Exception: print('error')" 2>/dev/null)
  if [ "$AVAIL" = "True" ]; then
    echo "gateway healthy after ${waited}s of waiting"
    healthy=1
    break
  fi
  sleep 30; waited=$((waited + 30))
  echo "gateway still throttled (${waited}/${MAX_WAIT}s)…"
done

cd /home/z/my-project
if [ "$healthy" != "1" ]; then
  echo "GATEWAY NEVER HEALTHY — eval skipped (no attempts burned)"
  exit 2
fi
if [ "$MODE" = "stream" ]; then
  bun evals/code-giftz/run-eval.ts --stream-e2e --base-url "$BASE"
else
  bun evals/code-giftz/run-eval.ts --base-url "$BASE"
fi
EVAL_EXIT=$?
echo "EVAL EXIT: $EVAL_EXIT"
exit $EVAL_EXIT
