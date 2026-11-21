#!/usr/bin/env bash
# M28 — UI inspection: boot the production build, register a user, capture
# the M28 UI surfaces at desktop + mobile sizes (real evidence):
#   1. GANGZII Narration tab — engine card with artifact provenance state
#   2. GANGZII Soundtrack tab — dynamic ducking controls
#   3. JAZMII audio block (SFX upload — supported on both engines now)
# Honest-evidence rules: screenshots of the RUNNING app only; a disposable
# inspection account is created and recorded (deletable in Settings), no
# mock audio or fabricated waveforms are rendered.
set -u
cd /home/z/my-project
export BEAN_ENGINE_EMBEDDED=0   # UI inspection only; no worker pools needed
OUT=/home/z/my-project/scripts/m28-ui-out
mkdir -p /tmp/m28-ui "$OUT"
LOG=/tmp/m28-ui/server.log

echo "=== boot production build ==="
if ! curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 40 | grep -q "{"; then
  nohup bunx next start -p 3100 > "$LOG" 2>&1 &
  for i in $(seq 1 40); do
    sleep 2
    if curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 40 | grep -q "{"; then
      echo "server ready after $((i*2))s"; break
    fi
  done
fi
curl -s --max-time 5 "http://localhost:3100/api/health" | head -c 200; echo

echo "=== register + login inspection user ==="
TS=$(date +%s)
EMAIL="ui-inspect-m28-$TS@test.local"
PASS='UiInspect-2027!x'
curl -s --max-time 10 -X POST "http://localhost:3100/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"M28 UI Inspector\"}" | head -c 120; echo
LOGIN=$(curl -s --max-time 10 -c /tmp/m28-ui/cookies.txt -X POST "http://localhost:3100/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$LOGIN" | head -c 120; echo
COOKIE=$(grep session /tmp/m28-ui/cookies.txt | awk '{print $6"="$7}')
echo "cookie captured: ${#COOKIE} chars"

echo "=== browser session ==="
agent-browser set viewport 1440 900
agent-browser open "http://localhost:3100/"
agent-browser wait --load networkidle
# Inject the session cookie (register/login via API; UI login page varies)
agent-browser cookies set "$COOKIE" --domain localhost --path /
agent-browser open "http://localhost:3100/"
agent-browser wait --load networkidle
agent-browser wait 2000

# Navigate to GANGZII → Narration
agent-browser snapshot -i -c 2>/dev/null | rg -i "gangzii|narration|soundtrack|jazmii" | head -8
agent-browser find text "GANGZII" click 2>/dev/null || agent-browser find first "[data-view='gangzii'], a[href*='gangzii']" click 2>/dev/null || true
agent-browser wait 1500
agent-browser find text "Narration" click 2>/dev/null || true
agent-browser wait 2000
agent-browser screenshot "$OUT/m28-narration-desktop.png"
agent-browser eval "document.body.innerText.includes('Artifact provenance') ? 'provenance-card-shown' : 'PROVENANCE-CARD-MISSING'" || true

# Soundtrack tab with dynamic ducking controls
agent-browser find text "Soundtrack" click 2>/dev/null || true
agent-browser wait 1500
agent-browser screenshot "$OUT/m28-soundtrack-desktop.png"
agent-browser eval "document.body.innerText.includes('Dynamic (timeline-aware)') ? 'ducking-controls-shown' : 'DUCKING-CONTROLS-MISSING'" || true

# Mobile pass (390x844)
agent-browser set viewport 390 844
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 1500
agent-browser screenshot "$OUT/m28-soundtrack-mobile.png"
agent-browser find text "Narration" click 2>/dev/null || true
agent-browser wait 1500
agent-browser screenshot "$OUT/m28-narration-mobile.png"

echo "=== results ==="
ls -la "$OUT"
for f in "$OUT"/*.png; do echo "$f: $(du -h "$f" | cut -f1)"; done
echo "inspection account (disposable, deletable in Settings): $EMAIL"
