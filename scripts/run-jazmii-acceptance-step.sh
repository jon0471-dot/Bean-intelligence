#!/bin/bash
# One-call JAZMII acceptance runner: the standalone prod server is started for
# THIS invocation only (background processes do not survive between tool calls
# in this sandbox), the acceptance step runs against it, then the server is
# stopped. Job rows + provider tasks persist in the DB; pollers re-attach on
# the next server read (recovery parity) if a generation outlives the call.
set -u
cd /home/z/my-project
PORT="${JAZMII_ACCEPT_PORT:-3199}"
STEPS=""
if [ -n "${JAZMII_ACCEPT_STEPS:-}" ]; then STEPS="$JAZMII_ACCEPT_STEPS"; fi
POLL_MS="${JAZMII_ACCEPT_POLL_MS:-450000}"
OBS="${JAZMII_ACCEPT_OBSERVE:-0}"

NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
  DATABASE_URL=file:/home/z/my-project/db/custom.db \
  bun .next/standalone/server.js > /tmp/standalone-$PORT.log 2>&1 &
SRV=$!
UP=0
for i in $(seq 1 30); do
  sleep 1
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then UP=1; break; fi
done
if [ "$UP" != "1" ]; then echo "SERVER_FAILED_TO_START"; kill $SRV 2>/dev/null; tail -20 /tmp/standalone-$PORT.log; exit 1; fi
echo "server up (pid $SRV, port $PORT)"

JAZMII_ACCEPT_BASE="http://127.0.0.1:$PORT" \
JAZMII_ACCEPT_STEPS="$STEPS" \
JAZMII_ACCEPT_POLL_MS="$POLL_MS" \
JAZMII_ACCEPT_OBSERVE="$OBS" \
timeout 540 bun scripts/jazmii-chat-acceptance.ts 2>&1 | tail -16
RC=$?
kill $SRV 2>/dev/null
echo "server stopped (acceptance rc=$RC)"
exit 0
