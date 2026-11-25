#!/bin/bash
# M40.9 — live UI regression walk at the M40.9 code HEAD (desktop + mobile).
# Preserves the existing UI; no code interaction — capture + inspect only.
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=validation/m40-ui/m40.9
mkdir -p "$OUT"
# the dev server is already running (started for the M40.9 acceptance window)
curl -s -o /dev/null -w "server:%{http_code}\n" --max-time 5 http://localhost:3000/

agent-browser close 2>/dev/null || true
agent-browser set viewport 1440 900
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true
echo "=== sign in through the real UI form (fresh M40.9 account) ==="
agent-browser find label "Email" fill "m409-ui-walk@bean-test.local"
agent-browser find label "Password" fill "Bean-Accept-2026!"
agent-browser find role button click --name "Sign in to BEAN" --timeout 20000 || {
  echo "no existing account — registering through the real sign-up form"
  agent-browser find role button click --name "Sign up" --timeout 15000 || true
  agent-browser find label "Name" fill "M40.9 UI Walk" || true
  agent-browser find label "Email" fill "m409-ui-walk@bean-test.local" || true
  agent-browser find label "Password" fill "Bean-Accept-2026!" || true
  agent-browser find role button click --name "Create account" --timeout 20000 || \
  agent-browser find role button click --name "Sign up" --timeout 20000 || true
}
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser get url
agent-browser screenshot "$OUT/dashboard.png" && echo "shot: dashboard"

for W in RIISHE LAXII JAZMII "CODE GIFTZ" GANGZII; do
  agent-browser find role button click --name "$W" --timeout 20000 || echo "MISS $W"
  agent-browser wait --load networkidle --timeout 30000 || true
  sleep 2
  f=$(echo "$W" | tr ' ' '-' | tr 'A-Z' 'a-z')
  agent-browser screenshot "$OUT/$f.png" && echo "shot: $f"
done

echo "=== mobile 390x844 ==="
agent-browser set viewport 390 844
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/dashboard-mobile.png" && echo "shot: dashboard-mobile"
agent-browser find role button click --name "LAXII" --timeout 20000 || true
agent-browser wait --load networkidle --timeout 30000 || true
sleep 2
agent-browser screenshot "$OUT/laxii-mobile.png" && echo "shot: laxii-mobile"

agent-browser console > "$OUT/console.txt" 2>&1 || true
agent-browser errors > "$OUT/page-errors.txt" 2>&1 || true
echo "=== console tail ==="; tail -5 "$OUT/console.txt"
echo "=== page errors ==="; cat "$OUT/page-errors.txt"
agent-browser close || true
ls -la "$OUT"
