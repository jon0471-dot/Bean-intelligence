#!/usr/bin/env bash
# M28 UI inspection — SINGLE-SESSION capture (server + browser in one go).
set -u
cd /home/z/my-project
export BEAN_ENGINE_EMBEDDED=0
export BEAN_TRUSTED_ORIGINS="http://localhost:3100,https://localhost:3100"
OUT=/home/z/my-project/scripts/m28-ui-out
mkdir -p "$OUT"

# --- boot (prod build) -------------------------------------------------------
pkill -f "next start" 2>/dev/null || true
sleep 1
nohup bunx next start -p 3100 > /tmp/m28-ui/server3.log 2>&1 &
for i in $(seq 1 40); do
  sleep 2
  curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 20 | grep -q "{" && { echo "server ready"; break; }
done

# --- session cookie ----------------------------------------------------------
CREDS=/tmp/m28-ui/creds.txt
if [ ! -f "$CREDS" ]; then
  TS=$(date +%s)
  EMAIL="ui28-$TS@test.local"
  PASS='UiInspect-2027!x'
  curl -s -X POST "http://localhost:3100/api/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"M28 UI\"}" > /dev/null
  echo "$EMAIL $PASS" > "$CREDS"
fi
EMAIL=$(cut -d' ' -f1 "$CREDS"); PASS=$(cut -d' ' -f2 "$CREDS")
curl -s --max-time 15 -c /tmp/m28-ui/ck2.txt -X POST "http://localhost:3100/api/auth/login" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | head -c 60; echo
SESSION=$(awk '/bean_session/{print $7}' /tmp/m28-ui/ck2.txt)
echo "session: ${SESSION:0:12}…"

# --- asset upload (curl, same session) ----------------------------------------
ASSET_COUNT=$(curl -s --max-time 10 -H "Cookie: bean_session=$SESSION" "http://localhost:3100/api/gangzii/assets" | grep -o '"id"' | wc -l)
if [ "$ASSET_COUNT" -eq 0 ]; then
  curl -s --max-time 30 -X POST "http://localhost:3100/api/gangzii/assets" \
    -H "Cookie: bean_session=$SESSION" -H "Origin: http://localhost:3100" \
    -F "file=@/tmp/m28-ui/duck-bed.wav;type=audio/wav" -F "kind=music" \
    -F "license=Owned (self-generated tone)" -F "attribution=M28 ducking inspection tone" | head -c 80; echo
fi

# --- browser: desktop ---------------------------------------------------------
agent-browser set viewport 1440 900
agent-browser open "http://localhost:3100/" > /dev/null
agent-browser cookies set bean_session "$SESSION" --domain localhost --path / > /dev/null
agent-browser open "http://localhost:3100/#gangzii"
agent-browser wait --load networkidle
agent-browser wait 2500
# Narration tab (provenance card)
agent-browser find first "button:has-text('Narration')" click 2>/dev/null || agent-browser snapshot -i -c | rg -o 'button "Narration" \[ref=(\w+)\]' -r '$1' | head -1 | xargs -I{} agent-browser click {} 2>/dev/null
agent-browser wait 2500
agent-browser screenshot "$OUT/m28-narration-desktop.png"
agent-browser eval "document.body.innerText.includes('Artifact provenance') ? 'provenance-card-shown' : 'PROVENANCE-CARD-MISSING'"

# Soundtrack tab → pick asset → ducking controls
agent-browser snapshot -i -c > /tmp/m28-ui/snap.txt 2>/dev/null
SND_REF=$(rg -o 'button "Soundtrack" \[ref=(\w+)\]' -r '$1' /tmp/m28-ui/snap.txt | head -1)
[ -n "$SND_REF" ] && agent-browser click "$SND_REF"
agent-browser wait 2000
# click the asset's "process"/use control (first row button after the list)
agent-browser snapshot -i -c > /tmp/m28-ui/snap2.txt 2>/dev/null
rg -i "duck-bed|process|use" /tmp/m28-ui/snap2.txt | head -4
USE_REF=$(rg -o 'button "(Process|Use|Mix)[^"]*" \[ref=(\w+)\]' -r '$2' /tmp/m28-ui/snap2.txt | head -1)
[ -n "$USE_REF" ] && agent-browser click "$USE_REF" && agent-browser wait 1500
# select dynamic ducking
agent-browser eval "
(() => { for (const s of document.querySelectorAll('select')) { if (Array.from(s.options).some(o => o.value === 'dynamic')) { s.value = 'dynamic'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'duck-dynamic-selected'; } } return 'SELECT-NOT-FOUND'; })()
"
agent-browser wait 800
agent-browser screenshot "$OUT/m28-soundtrack-ducking-desktop.png"
agent-browser eval "document.body.innerText.includes('Deterministic timeline automation') ? 'ducking-controls-shown' : 'DUCKING-CONTROLS-MISSING'"

# --- browser: mobile ----------------------------------------------------------
agent-browser set viewport 390 844
agent-browser reload > /dev/null
agent-browser wait --load networkidle
agent-browser wait 2000
agent-browser screenshot "$OUT/m28-gangzii-mobile.png"
agent-browser find first "button:has-text('Narration')" click 2>/dev/null
agent-browser wait 2000
agent-browser screenshot "$OUT/m28-narration-mobile.png"

echo "=== files ==="
ls -la "$OUT" | tail -8
echo "account: $EMAIL"
