#!/bin/bash
# Bounded patient retry: waits for the platform gateway quota window to clear,
# then completes the fresh-chat live verification (TN CM auto-retrieval turn).
# Attempts every 180s, up to 8 attempts (~24 min). Non-destructive: each
# attempt uses a FRESH conversation to avoid dedup/regenerate interference.
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
COOKIE="$OUT/fresh-chat-cookies.txt"
TS=$(date +%s)
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"

attempt() {
  curl -s -N -b "$COOKIE" -X POST "$BASE/api/riishe/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d '{"message":"who is the cm of tamilnadu"}' -o "$OUT/fresh-chat-tn-retry.sse" --max-time 240
  python3 - << 'PYEOF'
import json
done = None
rate_limited = False
for line in open('/home/z/my-project/scripts/e2e-out/fresh-chat-tn-retry.sse'):
    if line.startswith('data: '):
        try:
            evt = json.loads(line[6:])
            if evt.get('done'): done = evt
            if evt.get('code') == 'RATE_LIMITED': rate_limited = True
        except Exception: pass
if done and done.get('ok'):
    print('SUCCESS')
elif rate_limited:
    print('RATE_LIMITED')
else:
    print('OTHER')
PYEOF
}

for i in 1 2 3 4 5 6 7 8; do
  echo "[attempt $i/8 @ $(date -u +%H:%M:%S)]"
  RESULT=$(attempt)
  echo "  -> $RESULT"
  if [ "$RESULT" = "SUCCESS" ]; then
    echo "LIVE VERIFICATION COMPLETE"
    exit 0
  fi
  [ "$i" -lt 8 ] && sleep 180
done
echo "GATEWAY STILL THROTTLED AFTER 8 ATTEMPTS"
exit 2
