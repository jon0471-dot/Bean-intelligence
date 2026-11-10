#!/bin/bash
# CODE GIFTZ eval verification session (one-shot, nothing platform-managed).
# - works on a COPY of the real DB (real user data is never touched)
# - starts the fresh standalone production build on :3100 (loopback)
# - runs ONE eval mode ($1: stream-e2e | benchmark)
# - always stops the instance afterwards
set -u
OUT=/home/z/my-project/scripts/e2e-verify-out
mkdir -p "$OUT"
cp /home/z/my-project/db/custom.db "$OUT/verify-giftz.db"
cd /home/z/my-project/.next/standalone
DATABASE_URL="file:$OUT/verify-giftz.db" PORT=3100 HOSTNAME=127.0.0.1 NODE_ENV=production bun server.js > "$OUT/giftz-server.log" 2>&1 &
SRV=$!
CODE=000
for i in $(seq 1 30); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3100/api/health 2>/dev/null)
  if [ "$CODE" = "200" ]; then break; fi
done
echo "verify instance ready (health=$CODE, pid=$SRV)"
if [ "$CODE" != "200" ]; then kill $SRV 2>/dev/null; echo "instance failed to come up"; exit 1; fi
MODE="$1"
bun /home/z/my-project/evals/code-giftz/run-eval.ts $MODE --base-url http://127.0.0.1:3100
RC=$?
kill $SRV 2>/dev/null
echo "verify instance stopped (eval rc=$RC, mode=$MODE)"
exit $RC
