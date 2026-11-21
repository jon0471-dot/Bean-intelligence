#!/bin/bash
# BEAN client-compute — LAXII UI end-to-end verification (single-invocation).
# Starts the dev server, registers a user via the real API, drives the real
# browser through the LAXII consent toggle + >4MB on-device preprocessing,
# captures evidence, and cleans up. Honest: any step failure is recorded.
set -u
cd /home/z/my-project
OUT=validation/client-compute/ui-e2e
CRED_DIR=/tmp/cc-e2e-creds
mkdir -p "$OUT" "$CRED_DIR"
LOG() { echo "[e2e] $*" | tee -a "$OUT/e2e-log.txt"; }

# ---- 1. dev server -----------------------------------------------------------
rm -f dev.log
bun run dev > /dev/null 2>&1 &
SERVER_PID=$!
LOG "dev server starting (pid $SERVER_PID)"
code=000
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health --max-time 60)
  [ "$code" = "200" ] && break
  sleep 3
done
LOG "health probe: HTTP $code"
if [ "$code" != "200" ]; then LOG "FATAL: server not healthy"; kill $SERVER_PID 2>/dev/null; exit 1; fi

# ---- 2. register a fresh throwaway user via the real API (cookie jar) --------
# Credentials are RANDOM PER RUN and stored only in the (uncommitted) evidence
# dir — no fixed credential material exists in this script.
E2E_EMAIL="clientcompute-e2e-$(date +%s)@example.test"
E2E_PASSWORD="Cc-E2E!$(openssl rand -hex 12 2>/dev/null || echo "$(date +%s)$$")-Aa1"
rm -f "$CRED_DIR/cookies.txt"
REG=$(curl -s -c "$CRED_DIR/cookies.txt" -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\",\"name\":\"CC E2E\"}" \
  -w '\n%{http_code}' --max-time 60)
REG_CODE=$(echo "$REG" | tail -1)
if [ "$REG_CODE" != "200" ]; then
  LOG "register returned $REG_CODE — cannot continue with a fresh account"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
printf 'email=%s\npassword=%s\n' "$E2E_EMAIL" "$E2E_PASSWORD" > "$CRED_DIR/test-account.txt"
LOG "auth: HTTP $(echo "$REG" | tail -1) (fresh account, credentials in test-account.txt)"
SESSION_COOKIE=$(grep bean_session "$CRED_DIR/cookies.txt" | awk '{print $6"="$7}')
if [ -z "$SESSION_COOKIE" ]; then LOG "FATAL: no session cookie"; kill $SERVER_PID 2>/dev/null; exit 1; fi
LOG "session cookie present (value withheld)"

# ---- 3. browser flow ---------------------------------------------------------
agent-browser close 2>/dev/null || true
agent-browser open http://127.0.0.1:3000/ || { LOG "FATAL: open failed"; kill $SERVER_PID; exit 1; }
agent-browser cookies set bean_session "$(echo "$SESSION_COOKIE" | cut -d= -f2-)" >/dev/null 2>&1
agent-browser reload
agent-browser wait --load networkidle --timeout 120000 || true
sleep 2

# Navigate to the LAXII product view (sidebar nav).
agent-browser snapshot -i -c > "$OUT/snapshot-app.txt" 2>&1 || true
if grep -qi "laxii" "$OUT/snapshot-app.txt"; then
  LAXII_REF=$(grep -i 'button "LAXII"' "$OUT/snapshot-app.txt" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=e/@e/')
  LOG "clicking LAXII nav ref: $LAXII_REF"
  agent-browser click "$LAXII_REF" || agent-browser find text "LAXII" click || true
else
  agent-browser find text "LAXII" click || true
fi
sleep 2
agent-browser snapshot -i -c > "$OUT/snapshot-laxii.txt" 2>&1 || true

# Find the consent toggle by its aria-label.
TOGGLE_LINE=$(grep -i "Process large images on this device" "$OUT/snapshot-laxii.txt" | head -1)
TOGGLE_REF=$(echo "$TOGGLE_LINE" | grep -oE "ref=e[0-9]+" | head -1 | sed 's/ref=e/@e/')
LOG "consent toggle ref: ${TOGGLE_REF:-NOT-FOUND}"
if [ -n "$TOGGLE_REF" ]; then
  agent-browser click "$TOGGLE_REF" && LOG "consent toggle clicked"
  sleep 1
  agent-browser eval "JSON.stringify({ariaChecked: document.querySelector('[aria-label=\"Process large images on this device before upload\"]')?.getAttribute('aria-checked'), note: (Array.from(document.querySelectorAll('div')).find(d=>d.textContent==='On — images over 4 MB are downscaled/compressed on this device before upload. The server still validates every upload.')?true:false)})" > "$OUT/toggle-state.json" 2>&1
  LOG "toggle state: $(cat "$OUT/toggle-state.json")"
else
  LOG "FAIL: consent toggle not found"
fi

# Upload the >4MB image through the real file input.
agent-browser set viewport 1440 900
if agent-browser upload "#laxii-chat-upload" /tmp/upload-big.png; then
  LOG "upload started"
  sleep 12
  agent-browser eval "JSON.stringify((Array.from(document.querySelectorAll('div')).map(d=>d.textContent).filter(t=>t && (t.includes('Processed on device')||t.includes('Device processing skipped')||t.includes('Device processing failed')||t.includes('Uploaded ·')))).slice(-4))" > "$OUT/upload-note.txt" 2>&1
  LOG "upload notes: $(cat "$OUT/upload-note.txt")"
else
  LOG "FAIL: upload interaction"
fi
agent-browser screenshot "$OUT/laxii-after-upload.png" || true

# Persisted consent check (localStorage) — the toggle wrote engine consent.
agent-browser eval "JSON.stringify({consent: localStorage.getItem('bean.clientCompute.consent.v1')})" > "$OUT/consent-storage.json" 2>&1
LOG "consent storage: $(cat "$OUT/consent-storage.json")"

# Console + page errors (honest capture).
agent-browser errors > "$OUT/page-errors.txt" 2>&1 || true
LOG "page errors: $(cat "$OUT/page-errors.txt")"
agent-browser close 2>/dev/null || true

# ---- 4. cleanup --------------------------------------------------------------
kill $SERVER_PID 2>/dev/null
LOG "done — server stopped"
