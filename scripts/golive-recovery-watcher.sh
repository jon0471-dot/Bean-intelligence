#!/usr/bin/env bash
# GO-LIVE recovery watcher (bounded, breaker-respecting).
# Polls /api/health every 60s. While a class breaker is OPEN the app defers
# its probes (zero upstream traffic), so this watcher never adds load to the
# throttled account: a real probe fires only when a breaker expires and the
# 20s probe cache is stale — i.e. the by-design ~1 probe / cooldown window.
# Exits 0 when the chat class reports a healthy real probe (provider
# recovered for RIISHE/CODE GIFTZ), or after MAX_MINUTES with BLOCKED.
set -u
BASE=http://localhost:3000/api/health
LOG=/home/z/my-project/scripts/golive-out/recovery-watch.log
MAX_MINUTES=210
START=$(date +%s)
mkdir -p "$(dirname "$LOG")"
echo "[$(date -Is)] watcher start (max ${MAX_MINUTES}min)" >> "$LOG"
while true; do
  NOW=$(date +%s)
  ELAPSED=$(( (NOW - START) / 60 ))
  if [ "$ELAPSED" -ge "$MAX_MINUTES" ]; then
    echo "[$(date -Is)] BLOCKED: chat class never recovered within ${MAX_MINUTES}min" >> "$LOG"
    exit 2
  fi
  J=$(curl -s --max-time 25 "$BASE") || { echo "[$(date -Is)] health fetch error" >> "$LOG"; sleep 60; continue; }
  LINE=$(printf '%s' "$J" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
  d=d.get("data",d)
except Exception as e:
  print("parse-error"); raise SystemExit
gw={c["class"]:c for c in d["gateway"]["breaker"]["classes"]}
r=d["products"]["riishe"]; g=d["products"]["code-giftz"]; l=d["products"]["laxii"]; v=d["products"]["jazmii"]
chat=gw["chat"]
print("chat cooling=%s streak=%s remaining=%ss | riishe=%s(%s) giftz=%s(%s) | laxii=%s jazmii=%s | riishe.lastHealthy=%s" % (
  chat["coolingDown"], chat["consecutive429s"], chat["remainingMs"]//1000,
  r["status"], r.get("probe",{}).get("failureCategory"),
  g["status"], g.get("probe",{}).get("failureCategory"),
  l["status"], v["status"], r.get("lastHealthyAt")))
')
  echo "[$(date -Is)] $LINE" >> "$LOG"
  HEALTHY=$(printf '%s' "$J" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
  d=d.get("data",d)
  print("yes" if d["products"]["riishe"].get("probe",{}).get("healthy") else "no")
except Exception:
  print("no")
')
  if [ "$HEALTHY" = "yes" ]; then
    echo "[$(date -Is)] RECOVERED: chat-class probe healthy — provider available for RIISHE/CODE GIFTZ" >> "$LOG"
    exit 0
  fi
  sleep 60
done
