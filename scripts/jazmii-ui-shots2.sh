#!/bin/bash
# JAZMII UI screenshots, part 2: reuse the running dev server on :3000,
# navigate deterministically via snapshot refs to JAZMII + the conversation
# holding the three real job submissions, then desktop + mobile shots.
set -u
cd /home/z/my-project
OUT=scripts/jazmii-chat-acceptance-out
B="agent-browser"

$B close >/dev/null 2>&1
$B set viewport 1440 900
$B open http://127.0.0.1:3000/ >/dev/null 2>&1
sleep 6
# still-authenticated session? if login form appears, sign in again
if $B find label "Email" fill "jazmii-studio-1794469381428@bean.test" 2>/dev/null; then
  $B find label "Password" fill "JazmiiStudio!2026" 2>/dev/null
  $B find role button click --name "Sign in to BEAN" 2>/dev/null
  sleep 6
fi
# wait for the product sidebar, then click JAZMII by text
$B wait --text "CODE GIFTZ" --timeout 20000 2>/dev/null
$B find text "JAZMII" click 2>/dev/null
sleep 4
# open the conversation holding the three real job messages
$B find text "A golden perfume bottle" click 2>/dev/null
sleep 4
$B screenshot "$OUT/jazmii-ui-desktop.png" >/dev/null 2>&1 && echo "desktop saved"
$B errors 2>/dev/null | tail -2

# mobile pass
$B set viewport 390 844
sleep 2
$B screenshot "$OUT/jazmii-ui-mobile.png" >/dev/null 2>&1 && echo "mobile saved"
$B find role button click --name "Conversations" 2>/dev/null
sleep 2
$B screenshot "$OUT/jazmii-ui-mobile-drawer.png" >/dev/null 2>&1 && echo "drawer saved"
$B close >/dev/null 2>&1
echo "done"
