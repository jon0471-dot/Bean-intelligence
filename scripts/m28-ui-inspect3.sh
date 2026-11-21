#!/usr/bin/env bash
# M28 UI inspection — precise ref-based navigation, one session.
set -u
cd /home/z/my-project
export BEAN_ENGINE_EMBEDDED=0
export BEAN_TRUSTED_ORIGINS="http://localhost:3100,https://localhost:3100"
OUT=/home/z/my-project/scripts/m28-ui-out
mkdir -p "$OUT"

if ! curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 20 | grep -q "{"; then
  pkill -f "next start" 2>/dev/null || true; sleep 1
  nohup bunx next start -p 3100 > /tmp/m28-ui/server3.log 2>&1 &
  for i in $(seq 1 40); do
    sleep 2
    curl -s --max-time 3 "http://localhost:3100/api/health" | head -c 20 | grep -q "{" && { echo "server ready"; break; }
  done
fi

EMAIL=$(cut -d' ' -f1 /tmp/m28-ui/creds.txt); PASS=$(cut -d' ' -f2 /tmp/m28-ui/creds.txt)
curl -s --max-time 15 -c /tmp/m28-ui/ck3.txt -X POST "http://localhost:3100/api/auth/login" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" > /dev/null
SESSION=$(awk '/bean_session/{print $7}' /tmp/m28-ui/ck3.txt)

agent-browser set viewport 1440 900
agent-browser open "http://localhost:3100/" > /dev/null
agent-browser cookies set bean_session "$SESSION" --domain localhost --path / > /dev/null
agent-browser open "http://localhost:3100/#gangzii"
agent-browser wait --load networkidle
agent-browser wait 2500
agent-browser snapshot -i -c > /tmp/m28-ui/s1.txt 2>/dev/null

GREF=$(rg -o 'ref=(\w+)\]?$' /tmp/m28-ui/s1.txt | head -1)
# find GANGZII workspace open button
GZ=$(rg -o '"GANGZII[^"]*Open workspace" \[ref=(\w+)\]' -r '$1' /tmp/m28-ui/s1.txt | head -1)
[ -z "$GZ" ] && GZ=$(rg -o 'button "GANGZII[^"]*Open workspace[^"]*" \[ref=e[0-9]+' -o /tmp/m28-ui/s1.txt | rg -o 'e[0-9]+' | tail -1)
echo "GANGZII open ref: $GZ"
[ -n "$GZ" ] && agent-browser click "$GZ"
agent-browser wait 2200
agent-browser snapshot -i -c > /tmp/m28-ui/s2.txt 2>/dev/null
NAR=$(rg -o 'button "Narration" \[ref=(\w+)\]' -r '$1' /tmp/m28-ui/s2.txt | head -1)
SND=$(rg -o 'button "Soundtrack" \[ref=(\w+)\]' -r '$1' /tmp/m28-ui/s2.txt | head -1)
echo "narration=$NAR soundtrack=$SND"

agent-browser click "$NAR"; agent-browser wait 2500
agent-browser screenshot "$OUT/m28-narration-desktop.png"
agent-browser eval "document.body.innerText.includes('Artifact provenance') ? 'provenance-card-shown' : 'PROVENANCE-CARD-MISSING'"

agent-browser click "$SND"; agent-browser wait 2200
agent-browser snapshot -i -c > /tmp/m28-ui/s3.txt 2>/dev/null
# source asset select: combobox with option "Choose source asset…"
agent-browser eval "
(() => {
  for (const s of document.querySelectorAll('select')) {
    if (Array.from(s.options).some(o => o.textContent.includes('Choose source asset'))) {
      const opt = Array.from(s.options).find(o => o.value && o.value !== '');
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 'asset-selected'; }
    }
  }
  return 'ASSET-SELECT-NOT-FOUND';
})()
"
agent-browser wait 1200
agent-browser eval "
(() => { for (const s of document.querySelectorAll('select')) { if (Array.from(s.options).some(o => o.value === 'dynamic')) { s.value = 'dynamic'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'duck-dynamic-selected'; } } return 'SELECT-NOT-FOUND'; })()
"
agent-browser wait 1000
agent-browser screenshot "$OUT/m28-soundtrack-ducking-desktop.png"
agent-browser eval "document.body.innerText.includes('Deterministic timeline automation') ? 'ducking-controls-shown' : 'DUCKING-CONTROLS-MISSING'"

agent-browser set viewport 390 844
agent-browser reload > /dev/null
agent-browser wait --load networkidle
agent-browser wait 2500
agent-browser screenshot "$OUT/m28-gangzii-mobile.png"
agent-browser snapshot -i -c > /tmp/m28-ui/s4.txt 2>/dev/null
NARM=$(rg -o 'button "Narration" \[ref=(\w+)\]' -r '$1' /tmp/m28-ui/s4.txt | head -1)
[ -n "$NARM" ] && agent-browser click "$NARM" && agent-browser wait 2200
agent-browser screenshot "$OUT/m28-narration-mobile.png"
agent-browser eval "document.body.innerText.includes('Artifact provenance') ? 'provenance-card-shown-mobile' : 'PROVENANCE-CARD-MISSING-MOBILE'"
echo "=== files ==="; ls -la "$OUT" | tail -7
