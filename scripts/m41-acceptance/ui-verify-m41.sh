#!/bin/bash
# M41 Phase 10 — live UI walk v2 (in-app navigation; the workspaces are views
# inside the single-page app, not URL routes). Preserves the existing UI.
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=validation/m41-ui
mkdir -p "$OUT"
rm -f "$OUT"/*.png
agent-browser close 2>/dev/null || true
agent-browser set viewport 1440 900
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true
echo "=== sign in through the real UI form (existing M41 runner account) ==="
agent-browser find label "Email" fill "m41-runner-mwwg10n6@bean-accept.test"
agent-browser find label "Password" fill "Bean-Accept-2026!"
agent-browser find role button click --name "Sign in to BEAN" --timeout 20000 || agent-browser find role button click --timeout 15000 || true
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/dashboard.png" && echo "shot: dashboard"
# Workspaces are product cards on the dashboard (onNavigate(view)); click by
# product name text.
for name in "RIISHE" "LAXII" "JAZMII" "CODE GIFTZ" "GANGZII"; do
  agent-browser find text "$name" click --timeout 15000 || \
  agent-browser find "[class*='bean-glass']" click --timeout 8000 || true
  agent-browser wait --load networkidle --timeout 20000 || true
  sleep 2
  slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  agent-browser screenshot "$OUT/$slug.png" && echo "shot: $slug"
  # back to dashboard via the app's own home control if present
  agent-browser find text "Dashboard" click --timeout 8000 || agent-browser open http://localhost:3000/ --timeout 30000 || true
  agent-browser wait --load networkidle --timeout 20000 || true
  sleep 1
done
agent-browser set viewport 390 844
agent-browser open http://localhost:3000/ --timeout 60000 || true
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/dashboard-mobile.png" && echo "shot: dashboard-mobile"
agent-browser console 2>/dev/null | tail -40 > "$OUT/console.txt" || true
agent-browser close 2>/dev/null || true
echo "walk complete → $OUT"
