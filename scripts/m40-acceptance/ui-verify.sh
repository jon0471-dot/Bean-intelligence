#!/bin/bash
# M40 Milestone 7 — UI & live-preview verification at the FINAL worktree HEAD.
# Full walk in ONE call: server up → register via the real UI → dashboard +
# five product workspaces (desktop screenshots) → mobile viewport check →
# console/page-error capture. Evidence: validation/m40-ui/final-head/
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=validation/m40-ui/final-head
mkdir -p "$OUT"

echo "=== starting dev server ==="
(bun run dev > /tmp/m40-dev-ui.log 2>&1 &)
for i in $(seq 1 40); do
  sleep 3
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null)
  [ "$code" = "200" ] && echo "SERVER READY ~$((i*3))s" && break
done
curl -s -o /dev/null -w "root=%{http_code}\n" --max-time 8 http://localhost:3000/ || exit 1

agent-browser close 2>/dev/null || true
agent-browser set viewport 1440 900
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true

STAMP=$(date -u +%H%M%S)
EMAIL="m40-ui-$STAMP@bean-test.local"
echo "=== register through the real UI: $EMAIL ==="
agent-browser find role button click --name "Create account" --timeout 20000
sleep 1
agent-browser find label "Name (optional)" fill "M40 UI Final" || true
agent-browser find label "Email" fill "$EMAIL"
agent-browser find label "Password" fill "Bean-Accept-2026!"
agent-browser find role button click --name "Create your account" --timeout 20000
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser get url
echo "=== dashboard (desktop) ==="
agent-browser screenshot "$OUT/dashboard.png" || true

shot() { # path-slug then click nav by name
  local slug="$1"; shift
  agent-browser find role link click --name "$1" --timeout 25000 || agent-browser find text "$1" click --timeout 20000 || { echo "NAV MISS: $1"; return 1; }
  agent-browser wait --load networkidle --timeout 30000 || true
  sleep 2
  agent-browser screenshot "$OUT/$slug.png"
  echo "shot: $slug"
}
echo "=== five product workspaces ==="
shot riishe "RIISHE"
shot laxii "LAXII"
shot jazmii "JAZMII"
shot code-giftz "CODE GIFTZ"
shot gangzii "GANGZII"

echo "=== mobile viewport check ==="
agent-browser set viewport 390 844
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/dashboard-mobile.png"
echo "=== console + page errors ==="
agent-browser console > "$OUT/console.txt" 2>&1 || true
agent-browser errors > "$OUT/page-errors.txt" 2>&1 || true
echo "console lines: $(wc -l < "$OUT/console.txt") | page-error lines: $(wc -l < "$OUT/page-errors.txt")"
agent-browser close || true
echo "=== UI walk complete — evidence in $OUT ==="
ls -la "$OUT"
