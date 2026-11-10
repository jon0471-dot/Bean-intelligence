#!/usr/bin/env bash
# CHECK 3 prep + CHECK 1/2 gateway probe — all in one invocation.
set -u
cd /home/z/my-project

# Start the platform's own boot path (dev script) on :3000 — detached.
setsid nohup npm run dev > /dev/null 2>&1 < /dev/null & disown
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/ && break; sleep 2; done
echo "--- :3000 status ---"
ss -tlnp 2>/dev/null | grep 3000 | head -1 || { echo "FAILED TO START"; exit 1; }

echo "--- route warmup (first-hit compiles) ---"
for p in / /api/health /api/products /login /register; do
  curl -s -o /dev/null -w "$p -> %{http_code} (%{time_total}s)\n" --max-time 90 "http://127.0.0.1:3000$p"
done

echo "--- health + real DB wiring ---"
curl -s --max-time 60 http://127.0.0.1:3000/api/health -o /tmp/hz.json -w "health -> %{http_code}\n"
python3 -c "
import json
d = json.load(open('/tmp/hz.json'))
r = d['products']['riishe']
print('ok:', d['ok'], '| live:', d.get('live'))
print('riishe.available:', r['available'])
print('detail:', str(r['probe'].get('detail',''))[:120])
"
echo "--- real-DB write-path proof: authenticated session query hits custom.db ---"
EMAIL="browsere2e-$(date +%s)@bean-test.dev"
curl -s -c /tmp/e2e-cookies.txt -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"PreviewE2E2026x\",\"name\":\"Preview E2E\"}" \
  -o /tmp/e2e-reg.json -w "register -> %{http_code}\n"
python3 -c "import json; d=json.load(open('/tmp/e2e-reg.json')); print('registered:', d.get('user',{}).get('email'))"
bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('db/custom.db', { readonly: true });
const u = db.query(\"SELECT email FROM User WHERE email LIKE 'browsere2e-%' ORDER BY rowid DESC LIMIT 1\").get();
console.log('row visible in REAL db:', u ? u.email : 'MISSING');
"
echo "$EMAIL" > /tmp/e2e-email.txt

echo "--- PUBLIC PREVIEW URL reachability (through ingress) ---"
curl -s -o /dev/null -w "preview / -> %{http_code}\n" --max-time 30 "https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai/"
curl -s --max-time 30 "https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai/api/health" | head -c 200; echo
