#!/bin/bash
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=validation/m40-ui/final-head
(bun run dev > /tmp/m40-dev-ui.log 2>&1 &)
for i in $(seq 1 40); do sleep 3; code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null); [ "$code" = "200" ] && echo "SERVER READY" && break; done
agent-browser close 2>/dev/null || true
agent-browser set viewport 1440 900
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true
echo "=== sign in with existing account (real UI form) ==="
agent-browser find label "Email" fill "m40-ui4-152121@bean-test.local"
agent-browser find label "Password" fill "Bean-Accept-2026!"
agent-browser find role button click --name "Sign in to BEAN" --timeout 20000
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser get url
agent-browser find role button click --name "JAZMII" --timeout 20000 || echo "MISS jazmii"
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/jazmii.png" && echo "shot: jazmii"
agent-browser find role button click --name "CODE GIFTZ" --timeout 20000 || echo "MISS giftz"
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/code-giftz.png" && echo "shot: code-giftz"
agent-browser find role button click --name "GANGZII" --timeout 20000 || echo "MISS gangzii"
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/gangzii.png" && echo "shot: gangzii"
agent-browser console > "$OUT/console.txt" 2>&1 || true
agent-browser errors > "$OUT/page-errors.txt" 2>&1 || true
agent-browser close || true
md5sum "$OUT"/jazmii.png "$OUT"/code-giftz.png "$OUT"/gangzii.png 2>/dev/null
