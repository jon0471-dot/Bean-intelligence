#!/usr/bin/env bash
# GANGZII E2E continuation — sections that were fixed after the main matrix
# run (improve / music presets / live turn / auth). Reuses an existing cookie
# jar (fresh run of scripts/e2e-gangzii.sh covers everything in one pass).
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/e2e-gangzii-cookies.txt"

hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X "$m" "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== 0. session alive =="
R=$(req GET /api/auth/session)
echo "session: $R $(head -c 120 /tmp/bean-e2e-body)"
echo "$R" | grep -q 200 || { echo "NO SESSION — run scripts/e2e-gangzii.sh first"; exit 1; }

echo "== 1. Write Lyrics with RIISHE (fresh draft) =="
R=$(req POST /api/gangzii/lyrics -H 'content-type: application/json' -d '{"prompt":"A gentle midnight train ride home","presetId":"electronic-pop","preferences":"two verses, memorable chorus"}')
cp /tmp/bean-e2e-body /tmp/bean-e2e-lyrics.json
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-lyrics.json'))
assert d.get('writtenBy')=='RIISHE' and len(d.get('lyrics',''))>80
print('RIISHE draft OK:', len(d['lyrics']), 'chars')
" || exit 1

echo "== 2. Improve lyrics with RIISHE (full improved draft, compare flow) =="
python3 -c "
import json
p=json.load(open('/tmp/bean-e2e-lyrics.json'))
json.dump({'lyrics':p['lyrics'],'songIdea':'A gentle midnight train ride home','presetId':'electronic-pop','wantImprovedDraft':True}, open('/tmp/bean-e2e-improve.json','w'))
"
R=$(req POST /api/gangzii/lyrics/analyze -H 'content-type: application/json' -d @/tmp/bean-e2e-improve.json)
echo "improve status: $R"
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
dr=d.get('improvedDraft','')
print('improvedDraft chars:', len(dr)); print(dr[:200].replace(chr(10),' | '))
assert isinstance(dr,str) and len(dr)>80, 'improve must return a full draft'
print('analyzedBy:', d.get('analyzedBy'))
" || exit 1

echo "== 3. Music preset validation (unknown preset / preset-aware NO_BACKEND) =="
R=$(req POST /api/gangzii/music -H 'content-type: application/json' -d '{"prompt":"midnight train song","presetId":"not-a-real-preset"}')
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
assert d.get('rejected') is True and d.get('code')=='VALIDATION_ERROR', d
print('unknown preset ->', d['message'][:110])
"
R=$(req POST /api/gangzii/music -H 'content-type: application/json' -d '{"prompt":"midnight train song","presetId":"synthwave-retro","vocalMode":"instrumental","lyrics":"la la la"}')
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
assert d.get('rejected') is True and d.get('code')=='NO_BACKEND', d
assert 'does not simulate music' in d['message'] or 'unavailable' in d['message']
print('preset-aware music submit -> truthful NO_BACKEND')
"
R=$(req GET /api/gangzii/music)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
assert d['productAvailability']['available'] is False
assert len(d['attempts'])>=1 and d['attempts'][0]['status']=='unsupported'
assert d['attempts'][0]['presetId']=='synthwave-retro'
print('music attempts recorded with preset metadata:', len(d['attempts']))
"

echo "== 4. Live Voice turn (real STT->LLM pipeline step) =="
R=$(req POST /api/gangzii/live -H 'content-type: application/json' -d '{"transcript":"Hello GANGZII, who are you? Answer in one short sentence.","history":[]}')
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
r=d.get('reply','')
print('live reply:', r[:160])
assert len(r) > 10 and len(r) < 1200
"

echo "== 5. Unauthorized + cross-site attacks rejected =="
R=$(curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X POST "$LOCAL/api/gangzii/tts" -H 'content-type: application/json' -d '{"text":"hi","voice":"tongtong","speed":1.0}')
echo "no-cookie tts: $R"; [ "$R" = "401" ] || exit 1
R=$(curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X POST "$LOCAL/api/gangzii/tts" -H 'content-type: application/json' -H "Origin: https://evil.example.com" -H "Sec-Fetch-Site: cross-site" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty" -b "$JAR" -d '{"text":"hi","voice":"tongtong","speed":1.0}')
echo "cross-site tts: $R"; [ "$R" = "403" ] || exit 1

echo
echo "CONTINUATION: ALL PASSED"
