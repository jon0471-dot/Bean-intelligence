#!/usr/bin/env bash
# One-shot disciplined gateway probe: capture the EXACT upstream response
# (status + body detail) for the delivery report, then stop. No retries.
set -u
BASE=http://127.0.0.1:3100
OUT=/home/z/my-project/scripts/giftz-verify-out

cd /home/z/my-project/.next/standalone
NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  DATABASE_URL=file:/home/z/my-project/scripts/giftz-verify-out/verify.db \
  bun server.js > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -s -o /dev/null --max-time 2 "$BASE/" && break
  sleep 1
done
echo "server up (pid $SERVER_PID)"

TS=$(date +%s)
HTTP=$(curl -s -m 90 -w "%{http_code}" "$BASE/api/health" -o "$OUT/gateway-probe-$TS.json")
echo "health HTTP status: $HTTP"
python3 - "$OUT/gateway-probe-$TS.json" <<'EOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("non-JSON body:", e); raise SystemExit
def walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:4]):
            walk(v, f"{path}[{i}]")
    else:
        s = str(obj)
        if any(t in s.lower() for t in ("429", "rate", "limit", "throttl", "unavailable", "fail", "error")):
            print(f"{path} = {s[:220]}")
print("riishe block:", json.dumps(d.get("products", {}).get("riishe", d.get("riishe", {})), ensure_ascii=False)[:500])
print("--- error/limit-shaped fields ---")
walk(d)
EOF
echo "probe done (single attempt, no retries)"
