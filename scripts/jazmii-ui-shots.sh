#!/bin/bash
# JAZMII UI acceptance screenshots (desktop 1440 + mobile 390) against the
# standalone prod build. Server lives only for this invocation.
set -u
cd /home/z/my-project
OUT=scripts/jazmii-chat-acceptance-out
# Browser access needs the DEV server (next dev): the prod standalone build
# bakes NODE_ENV=production into the edge middleware, which compiles out the
# documented loopback-origin allowance and rejects local browser mutations.
# The dev server runs with NODE_ENV=development -> loopback allowance applies.
# This throwaway server serves ONLY this screenshot run on 127.0.0.1.
DATABASE_URL=file:/home/z/my-project/db/custom.db \
  bun run dev > /tmp/dev3000.log 2>&1 &
SRV=$!
for i in $(seq 1 90); do sleep 1; curl -s --max-time 3 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && UP=1 && break; done
[ "${UP:-0}" = "1" ] || { echo SERVER_FAILED; tail -20 /tmp/dev3000.log; exit 1; }
sleep 5
echo "server up"

B="agent-browser"
$B set viewport 1440 900
$B open http://127.0.0.1:3000/ >/dev/null 2>&1
sleep 6
# Login as the acceptance account (owner of the 3-real-submission conversation)
$B find label "Email" fill "jazmii-studio-1794469381428@bean.test" 2>/dev/null
$B find label "Password" fill "JazmiiStudio!2026" 2>/dev/null
$B find role button click --name "Sign in to BEAN" 2>/dev/null
sleep 5
$B wait --load networkidle 2>/dev/null
# Open the JAZMII product view
$B find role button click --name "JAZMII" 2>/dev/null
sleep 3
# Open the conversation that holds the three real job submissions
$B find text "A golden perfume bottle" click 2>/dev/null
sleep 3
$B screenshot "$OUT/jazmii-ui-desktop.png" >/dev/null 2>&1 && echo "desktop shot saved"
$B console 2>/dev/null | tail -3
$B errors 2>/dev/null | tail -3

# Mobile pass
$B set viewport 390 844
sleep 2
$B screenshot "$OUT/jazmii-ui-mobile.png" >/dev/null 2>&1 && echo "mobile shot saved"
$B find role button click --name "Conversations" 2>/dev/null
sleep 2
$B screenshot "$OUT/jazmii-ui-mobile-drawer.png" >/dev/null 2>&1 && echo "mobile drawer shot saved"
$B close >/dev/null 2>&1
kill $SRV 2>/dev/null
echo "done"
