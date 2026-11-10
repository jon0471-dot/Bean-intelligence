#!/usr/bin/env bash
# Incident E2E (2026-10-27) — real-backend verification for all five products
# through the USER'S REAL preview origin with browser-equivalent fetch-metadata.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/incident-cookies.txt"
OUT="/home/z/my-project/scripts/incident-e2e-out"
mkdir -p "$OUT"
rm -f "$JAR"

EMAIL="incident-$(date +%s)@bean-test.dev"
PASS="Incident#Passw0rd!42"

hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

req() { # method path [curl extra...]
  local m="$1"; local p="$2"; shift 2
  curl -sS -o /tmp/bean-inc-body -w "%{http_code}" -X "$m" "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"
}

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Incident Verifier\"}")
echo "register: $R $(head -c 100 /tmp/bean-inc-body)"

echo "== RIISHE (real chat — auto-creates conversation, JSON path) =="
R=$(req POST /api/riishe/chat -H 'content-type: application/json' -d '{"message":"Reply with exactly: OK","stream":false}')
echo "real chat (JSON): $R $(head -c 260 /tmp/bean-inc-body)"
echo "--"
R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d '{"message":"Reply with exactly: OK"}')
echo "real chat (SSE first 240B): $R"
head -c 240 /tmp/bean-inc-body; echo

echo "== CODE GIFTZ (real code generation) =="
R=$(req POST /api/code-giftz/tasks -H 'content-type: application/json' -d '{"mode":"generate","prompt":"Write a JavaScript function that returns the sum of two numbers. Reply with code only."}')
echo "generate: $R $(head -c 260 /tmp/bean-inc-body)"
TASK=$(python3 -c "import json;d=json.load(open('/tmp/bean-inc-body'));print(d.get('task',{}).get('id') or d.get('job',{}).get('id') or '')" 2>/dev/null || true)
if [ -n "${TASK:-}" ]; then
  for i in 1 2 3 4 5 6; do
    sleep 2
    R=$(req GET "/api/code-giftz/tasks/$TASK")
    ST=$(python3 -c "import json;d=json.load(open('/tmp/bean-inc-body'));t=d.get('task',{});print(t.get('status','?'))" 2>/dev/null || echo '?')
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then
      echo "code task final: $R status=$ST $(python3 -c "
import json
d=json.load(open('/tmp/bean-inc-body'));t=d.get('task',{})
r=t.get('result') or {}
c=(r.get('content') or t.get('errorMessage') or '')[:110]
print('content/error:', repr(c))" 2>/dev/null || head -c 150 /tmp/bean-inc-body)"
      break
    fi
  done
fi

echo "== LAXII (real image generation) =="
R=$(req POST /api/laxii/generate -H 'content-type: application/json' -d '{"prompt":"a single small gold coin on black velvet, minimal","size":"1024x1024"}')
echo "image job: $R $(head -c 160 /tmp/bean-inc-body)"
IMGJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-inc-body'))['job']['id'])" 2>/dev/null || true)
if [ -n "${IMGJOB:-}" ]; then
  for i in $(seq 1 40); do
    sleep 3
    R=$(req GET "/api/laxii/jobs/$IMGJOB")
    ST=$(python3 -c "import json;d=json.load(open('/tmp/bean-inc-body'));print(d.get('job',{}).get('status','?'))" 2>/dev/null || echo '?')
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then
      IMG=$(python3 -c "import json;d=json.load(open('/tmp/bean-inc-body'));print(d.get('job',{}).get('imageId') or d.get('job',{}).get('result',{}).get('imageId') or '-')" 2>/dev/null || echo '-')
      echo "image job final: $R status=$ST imageId=$IMG $(python3 -c "
import json
d=json.load(open('/tmp/bean-inc-body'));j=d.get('job',{})
print('error:', (j.get('errorCode') or '-'), (j.get('errorMessage') or '')[:90])" 2>/dev/null || head -c 130 /tmp/bean-inc-body)"
      if [ "$ST" = "completed" ] && [ "$IMG" != "-" ]; then
        req GET "/api/laxii/images/$IMG" > "$OUT/laxii.jpg" 2>/dev/null
        python3 -c "
b=open('$OUT/laxii.jpg','rb').read()
print(f'image bytes: {len(b)} magic={b[:3].hex()} (ffd8ff=JPEG)')" 2>/dev/null || true
      fi
      break
    fi
  done
fi

echo "== JAZMII (real generate — expects truthful NO_BACKEND) =="
R=$(req POST /api/jazmii/generate -H 'content-type: application/json' -d '{"prompt":"a gold coin spinning on black velvet, 3 seconds"}')
echo "generate: $R $(head -c 240 /tmp/bean-inc-body)"

echo "== GANGZII (real TTS + availability) =="
R=$(req POST /api/gangzii/tts -H 'content-type: application/json' -d '{"text":"BEAN status check.","voice":"tongtong","speed":1.0,"source":"studio"}')
echo "tts job: $R $(head -c 160 /tmp/bean-inc-body)"
TTSJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-inc-body'))['job']['id'])" 2>/dev/null || true)
if [ -n "${TTSJOB:-}" ]; then
  for i in $(seq 1 15); do
    sleep 2
    R=$(req GET "/api/gangzii/jobs/$TTSJOB")
    ST=$(python3 -c "import json;d=json.load(open('/tmp/bean-inc-body'));print(d.get('job',{}).get('status','?'))" 2>/dev/null || echo '?')
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then
      echo "tts final: $R status=$ST $(python3 -c "
import json
d=json.load(open('/tmp/bean-inc-body'));j=d.get('job',{})
print('error:', (j.get('errorCode') or '-'), (j.get('errorMessage') or '')[:100])" 2>/dev/null || head -c 140 /tmp/bean-inc-body)"
      break
    fi
  done
fi
R=$(req GET /api/gangzii/availability)
echo "availability: $R $(python3 -c "
import json
d=json.load(open('/tmp/bean-inc-body'))
c=d.get('capabilities',{})
caps=' '.join(f'{k}={\"OK\" if v[\"available\"] else \"NO\"}' for k,v in c.items())
print(f\"available={d.get('available')} partial={d.get('partial')} [{caps}]\")" 2>/dev/null || head -c 200 /tmp/bean-inc-body)"
echo "done."
