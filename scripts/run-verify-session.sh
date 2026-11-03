#!/bin/bash
# One-shot verification session: start the standalone production build on
# :3100, run the E2E suite against it, stop it. Nothing platform-managed.
cd /home/z/my-project/.next/standalone
DATABASE_URL="file:/home/z/my-project/scripts/e2e-verify-out/verify.db" PORT=3100 HOSTNAME=127.0.0.1 NODE_ENV=production bun server.js > /home/z/my-project/scripts/e2e-verify-out/server.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3100/api/health 2>/dev/null)
  if [ "$CODE" = "200" ]; then break; fi
done
echo "verify instance ready (health=$CODE, pid=$SRV)"
/home/z/my-project/scripts/e2e-streamfix-1103.sh
RC=$?
kill $SRV 2>/dev/null
echo "verify instance stopped (e2e rc=$RC)"
