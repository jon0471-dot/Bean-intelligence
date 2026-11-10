#!/usr/bin/env bash
# Waits for gateway 429 pressure to clear (probes with a tiny completion),
# then runs the research-quality acceptance suite once the gateway responds.
set -u
cd /home/z/my-project

ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-quality-cookies.txt"
MAX_TRIES=30

probe() {
  curl -s -X POST http://localhost:3000/api/riishe/chat --max-time 60 \
    -H "Content-Type: application/json" -H "Origin: $ORIGIN" -b "$JAR" \
    -d '{"message":"Reply with exactly: OK","searchMode":"off"}'
}

for i in $(seq 1 $MAX_TRIES); do
  RESP=$(probe)
  if echo "$RESP" | grep -q '"ok":true'; then
    echo "[probe $i] gateway recovered: $(echo "$RESP" | head -c 120)"
    exec bash scripts/e2e-research-quality.sh
    exit 0
  fi
  echo "[probe $i] still degraded: $(echo "$RESP" | head -c 100)"
  sleep 90
done
echo "GATEWAY DID NOT RECOVER AFTER $MAX_TRIES PROBES"
exit 1
