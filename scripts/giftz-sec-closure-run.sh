#!/usr/bin/env bash
# W1–W5 closure — Task F security/credential E2E on the isolated :3100 instance.
# Phase nocred: server WITHOUT BEAN_CREDENTIALS_MASTER_KEY (fail-closed proof).
# Phase cred:   server WITH a disposable master key (generated here, never printed).
set -u
BASE=http://127.0.0.1:3100
OUT=/home/z/my-project/scripts/giftz-verify-out
cd /home/z/my-project

run_server() { # $1 = extra env (KEY=VALUE or empty)
  cd /home/z/my-project/.next/standalone
  env NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
    DATABASE_URL=file:/home/z/my-project/scripts/giftz-verify-out/verify.db \
    $1 bun server.js > "$OUT/server-sec-closure.log" 2>&1 &
  SERVER_PID=$!
  cd /home/z/my-project
}

stop_server() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }

wait_up() {
  for i in $(seq 1 30); do
    curl -s -o /dev/null --max-time 2 "$BASE/" && return 0
    sleep 1
  done
  echo "server never came up"; return 1
}

echo "===== PHASE nocred ====="
run_server ""
trap 'kill $SERVER_PID 2>/dev/null' EXIT
wait_up || exit 1
bun scripts/giftz-sec-e2e.ts "$BASE" nocred 2>&1 | tee "$OUT/sec-e2e-closure-nocred.log"
NOCRED_EXIT=${PIPESTATUS[0]}
stop_server

echo "===== PHASE cred ====="
DISPOSABLE_MASTER_KEY=$(openssl rand -hex 32)   # never printed, never saved
run_server "BEAN_CREDENTIALS_MASTER_KEY=$DISPOSABLE_MASTER_KEY"
wait_up || exit 1
bun scripts/giftz-sec-e2e.ts "$BASE" cred 2>&1 | tee "$OUT/sec-e2e-closure-cred.log"
CRED_EXIT=${PIPESTATUS[0]}
stop_server
unset DISPOSABLE_MASTER_KEY

echo "nocred exit=$NOCRED_EXIT cred exit=$CRED_EXIT"
[ "$NOCRED_EXIT" = "0" ] && [ "$CRED_EXIT" = "0" ]
