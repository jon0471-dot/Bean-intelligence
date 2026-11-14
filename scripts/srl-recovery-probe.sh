#!/bin/bash
# Recovery probe loop: one REAL chat probe per breaker window (~600s cap).
# On the FIRST success, immediately runs the other products' real tests
# (GIFTZ chat, LAXII t2i resubmit, JAZMII t2v resubmit) and logs everything.
LOG=/tmp/srl-recovery.log
: > "$LOG"
probe_chat() {
  curl -s -b /tmp/bean-cookies.txt -X POST 'http://localhost:3000/api/riishe/chat?stream=1' \
    -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
    -d '{"message":"Reply with exactly: BEAN-RATELIMIT-TEST-OK and nothing else."}' \
    --max-time 180 -o /tmp/probe.sse -w "%{time_total}" 2>/dev/null
}
ok_chat() {
  rg -q 'BEAN-RATELIMIT-TEST-OK' /tmp/probe.sse 2>/dev/null
}
for i in 1 2 3 4 5; do
  sleep 615
  echo "[$(date -u +%H:%M:%S)] probe $i" >> "$LOG"
  T=$(probe_chat)
  if ok_chat; then
    echo "[$(date -u +%H:%M:%S)] RIISHE chat SUCCESS (time=${T}s)" >> "$LOG"
    tail -c 400 /tmp/probe.sse >> "$LOG"; echo >> "$LOG"
    # CODE GIFTZ coding chat
    curl -s -b /tmp/bean-cookies.txt -X POST 'http://localhost:3000/api/code-giftz/chat' \
      -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
      -d '{"message":"Reply with exactly: GIFTZ-RATELIMIT-OK","mode":"chat"}' --max-time 180 -o /tmp/g.sse -w "giftz_time=%{time_total}\n" >> "$LOG" 2>&1
    rg -o 'GIFTZ-RATELIMIT-OK' /tmp/g.sse | head -1 >> "$LOG" 2>&1
    # LAXII t2i
    L=$(curl -s -b /tmp/bean-cookies.txt -X POST 'http://localhost:3000/api/laxii/generate' \
      -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
      -d '{"prompt":"A single crisp red apple on a matte slate surface, soft studio light","size":"1024x1024"}' --max-time 60)
    echo "laxii submit: $L" >> "$LOG"
    # JAZMII t2v
    J=$(curl -s -b /tmp/bean-cookies.txt -X POST 'http://localhost:3000/api/jazmii/generate' \
      -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
      -d '{"prompt":"A slow aerial drone shot flying over misty green mountains at sunrise","quality":"quality","durationSec":5}' --max-time 60)
    echo "jazmii submit: $J" >> "$LOG"
    echo "RECOVERY-COMPLETE" >> "$LOG"
    exit 0
  else
    echo "[$(date -u +%H:%M:%S)] chat still throttled (real 429, breaker re-opened)" >> "$LOG"
  fi
done
echo "STILL-THROTTLED-AFTER-5-PROBES" >> "$LOG"
