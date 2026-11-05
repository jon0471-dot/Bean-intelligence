#!/usr/bin/env bash
# JAZMII pipeline verification against the EXISTING real artifact (no new
# generation burned): playback/persistence/refresh/status accuracy/IDOR.
set -u
BASE=http://localhost:3000
OUT=/home/z/my-project/scripts/golive-out
mkdir -p "$OUT"
EMAIL=golive-acc-1793808340@bean-e2e.test
PASS='E2eTest!Passw0rd'
JOB=cmw2c0r0d0038ss9f4ypskxjv
JAR="$OUT/jazmii-verify-cookies.txt"
rm -f "$JAR"

echo "== login as artifact owner =="
curl -s -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$BASE/api/auth/login" | head -c 200; echo

echo "== jobs list (refresh restore) =="
curl -s -b "$JAR" "$BASE/api/jazmii/generate" > "$OUT/jazmii-verify-jobs.json"
python3 - <<'EOF'
import json
d=json.load(open('/home/z/my-project/scripts/golive-out/jazmii-verify-jobs.json'))
jobs=d.get('jobs',[])
print('jobs visible:',len(jobs))
for j in jobs[:6]:
    print(' ',j.get('id'),j.get('status'),j.get('bytes'),j.get('format'),str(j.get('videoUrl'))[:60])
target=[j for j in jobs if j.get('id')=='cmw2c0r0d0038ss9f4ypskxjv']
print('completed job restored after refresh:', bool(target), target[0].get('status') if target else None)
if target:
    print('  bytes:',target[0].get('bytes'),'(db says 1506330)','match:',target[0].get('bytes')==1506330)
    print('  provider fields leaked?', any(k in json.dumps(target[0]) for k in ('providerTaskId','taskId')))
EOF

echo "== media fetch (full) =="
curl -s -b "$JAR" -o "$OUT/jazmii-verify-media.mp4" -w "http=%{http_code} type=%{content_type} size=%{size_download}\n" "$BASE/api/jazmii/jobs/$JOB/media"
python3 -c "
b=open('/home/z/my-project/scripts/golive-out/jazmii-verify-media.mp4','rb').read(12)
print('magic:',b, 'isMp4:', b[4:8]==b'ftyp')"

echo "== media Range request (streaming playback) =="
curl -s -b "$JAR" -r 0-1023 -o /dev/null -w "http=%{http_code} size=%{size_download} range-echo=%header{content-range}\n" "$BASE/api/jazmii/jobs/$JOB/media" 2>/dev/null || \
curl -s -b "$JAR" -r 0-1023 -o /dev/null -D - "$BASE/api/jazmii/jobs/$JOB/media" -o /dev/null | head -6

echo "== job status route =="
curl -s -b "$JAR" "$BASE/api/jazmii/jobs/$JOB" | python3 -c "
import json,sys
j=json.load(sys.stdin).get('job',{})
print('status:',j.get('status'),'bytes:',j.get('bytes'),'format:',j.get('format'),'videoUrl:',j.get('videoUrl'))
s=json.dumps(j)
print('provider task id leaked?', 'providerTaskId' in s or '20261105002927' in s)"

echo "== cross-user guard (fresh user must NOT fetch the artifact) =="
R=$(curl -s -c "$OUT/jazmii-verify-cookies2.txt" -H 'Content-Type: application/json' -d '{"email":"golive-idor-2@bean-e2e.test","password":"E2eTest!Passw0rd"}' "$BASE/api/auth/login" -o /dev/null -w "%{http_code}")
if [ "$R" != "200" ]; then
  curl -s -c "$OUT/jazmii-verify-cookies2.txt" -H 'Content-Type: application/json' -d '{"email":"golive-idor-2@bean-e2e.test","password":"E2eTest!Passw0rd","name":"IDOR Check"}' "$BASE/api/auth/register" -o /dev/null -w "register=%{http_code}\n"
  curl -s -c "$OUT/jazmii-verify-cookies2.txt" -H 'Content-Type: application/json' -d '{"email":"golive-idor-2@bean-e2e.test","password":"E2eTest!Passw0rd"}' "$BASE/api/auth/login" -o /dev/null -w "login=%{http_code}\n"
fi
curl -s -b "$OUT/jazmii-verify-cookies2.txt" -o /dev/null -w "intruder media fetch http=%{http_code} (expect 401/403/404)\n" "$BASE/api/jazmii/jobs/$JOB/media"
curl -s -b "$OUT/jazmii-verify-cookies2.txt" -o /dev/null -w "intruder job fetch http=%{http_code} (expect 401/403/404)\n" "$BASE/api/jazmii/jobs/$JOB"
