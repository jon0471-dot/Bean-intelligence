#!/usr/bin/env bash
# Rework E2E — RIISHE (welcome, stable Q, current Q, cached repeat, attachments)
# + CODE GIFTZ (chat-first project flow) against the real backends.
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/rework-cookies.txt"
OUT="/home/z/my-project/scripts/rework-e2e-out"
mkdir -p "$OUT"; rm -f "$JAR"
EMAIL="rework-$(date +%s)@bean-test.dev"
PASS="Rework#Passw0rd!42"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")
req() { local m="$1"; local p="$2"; shift 2; curl -sS -o "$OUT/last-body" -w "%{http_code}" -X "$m" "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"; }

echo "== auth =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Rework Verifier\"}")
echo "register: $R $(head -c 80 "$OUT/last-body")"

echo "== RIISHE stable question (expect NO search, fast) =="
T0=$(date +%s%3N)
R=$(req POST /api/riishe/chat -H 'content-type: application/json' -d '{"message":"What is 17 multiplied by 23?"}')
T1=$(date +%s%3N)
python3 -c "
import json;d=json.load(open('$OUT/last-body'))
print(f'stable Q: $R {($T1-$T0)}ms states={d[\"metadata\"][\"states\"]} sources={len(d[\"metadata\"][\"sources\"])} retrievedAt={\"retrievedAt\" in d[\"metadata\"]}')"

echo "== RIISHE current-fact question (expect real retrieval + citations) =="
T0=$(date +%s%3N)
R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d '{"message":"What is the latest stable version of Node.js right now?"}')
T1=$(date +%s%3N)
cp "$OUT/last-body" "$OUT/riishe-current.sse"
python3 - "$OUT/riishe-current.sse" << 'PYEOF'
import json,sys
raw=open(sys.argv[1]).read()
events=[]
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except: pass
stages=[e['stage'] for e in events if e.get('type')=='stage']
done=next((e for e in events if e.get('done')),None)
md=(done or {}).get('meta') or {}
text=''.join(e['delta'] for e in events if e.get('delta'))
resets=sum(1 for e in events if e.get('reset'))
print(f'current Q: stages={stages} resets={resets} states={md.get("states")} sources={len(md.get("sources") or [])}')
for s in (md.get('sources') or [])[:3]: print('  src:', s.get('hostName'), '|', str(s.get('date')))
print('answer head:', text[:180].replace('\n',' '))
PYEOF

echo "== RIISHE repeated identical current question (expect cache hit, faster) =="
T0=$(date +%s%3N)
R=$(req POST "/api/riishe/chat?stream=1" -H 'content-type: application/json' -d '{"message":"What is the latest stable version of Node.js right now?"}')
T1=$(date +%s%3N)
cp "$OUT/last-body" "$OUT/riishe-cached.sse"
python3 - "$OUT/riishe-cached.sse" << 'PYEOF'
import json,sys
raw=open(sys.argv[1]).read()
events=[]
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except: pass
done=next((e for e in events if e.get('done')),None)
md=(done or {}).get('meta') or {}
print(f'cached Q: wall={int(sys.argv[2])}ms states={md.get("states")} sources={len(md.get("sources") or [])}')
PYEOF

echo "== RIISHE attachments: txt + image + xlsx + exe rejection =="
printf 'Quarterly report: revenue 1200, costs 800, profit 400.' > "$OUT/report.txt"
python3 - << 'PYEOF'
from PIL import Image
img = Image.new('RGB', (60, 40), (20, 16, 8))
for x in range(60):
    for y in range(40):
        if (x//8 + y//8) % 2 == 0: img.putpixel((x,y), (212,175,55))
img.save('/home/z/my-project/scripts/rework-e2e-out/checker.png')
print('PNG written')
PYEOF
python3 - << 'PYEOF'
import zipfile
z = zipfile.ZipFile('/home/z/my-project/scripts/rework-e2e-out/sheet.xlsx', 'w')
z.writestr('xl/sharedStrings.xml', '<sst><si><t>Item</t></si><si><t>Total</t></si></sst>')
z.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>42</v></c></row></sheetData></worksheet>')
z.writestr('[Content_Types].xml', '<Types/>')
z.close()
print('XLSX written')
PYEOF
head -c 64 /dev/urandom > "$OUT/program.exe"
for F in report.txt checker.png sheet.xlsx program.exe; do
  R=$(req POST /api/riishe/documents -F "file=@$OUT/$F")
  python3 -c "
import json;d=json.load(open('$OUT/last-body'))
doc=d.get('document') or {}
print(f'upload $F: $R kind={doc.get(\"kind\")} status={doc.get(\"status\")} chars={doc.get(\"characters\")} note={str(doc.get(\"note\"))[:70]}')" 2>/dev/null || echo "upload $F: $R $(head -c 120 "$OUT/last-body")"
done

echo "== RIISHE chat with txt+xlsx attached (grounded on real extraction) =="
TXTID=$(python3 -c "
import json" 2>/dev/null; true)
# Re-upload to capture ids:
req POST /api/riishe/documents -F "file=@$OUT/report.txt" > /dev/null
TXTID=$(python3 -c "import json;print(json.load(open('$OUT/last-body'))['document']['id'])")
req POST /api/riishe/documents -F "file=@$OUT/sheet.xlsx" > /dev/null
XLSID=$(python3 -c "import json;print(json.load(open('$OUT/last-body'))['document']['id'])")
R=$(req POST /api/riishe/chat -H 'content-type: application/json' -d "{\"message\":\"From the attached report and sheet: what is the profit margin if revenue is 1200 and the sheet total is 42? Answer briefly.\",\"documentIds\":[\"$TXTID\",\"$XLSID\"]}")
python3 -c "
import json;d=json.load(open('$OUT/last-body'))
print(f'attached chat: $R states={d[\"metadata\"][\"states\"]}')
print('answer:', d['content'][:220].replace(chr(10),' '))"

echo "== CODE GIFTZ: chat-first build a web app =="
R=$(req POST "/api/code-giftz/chat?stream=1" -H 'content-type: application/json' -d '{"message":"Create a tiny web app: index.html with an inline gold-on-black counter button using app.js, plus styles.css. Keep it minimal."}')
cp "$OUT/last-body" "$OUT/giftz-build.sse"
python3 - "$OUT/giftz-build.sse" << 'PYEOF'
import json,sys
raw=open(sys.argv[1]).read()
events=[]
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except: pass
done=next((e for e in events if e.get('done')),None)
deltas=''.join(e['delta'] for e in events if e.get('delta'))
proj=(done or {}).get('projectId')
changes=(done or {}).get('changes') or []
files=(done or {}).get('files') or []
print(f'giftz build: projectId={proj} streamChars={len(deltas)} changes={[(c["path"],c["change"]) for c in changes]}')
print('files:', [f['path'] for f in files])
PYEOF
PROJID=$(python3 -c "
import json,sys
raw=open('$OUT/giftz-build.sse').read()
for line in raw.split('\n'):
    if line.startswith('data: '):
        try:
            e=json.loads(line[6:])
            if e.get('projectId'): print(e['projectId']); break
        except: pass
")
echo "PROJID=$PROJID"

echo "== CODE GIFTZ: follow-up change through chat =="
R=$(req POST "/api/code-giftz/chat?stream=1" -H 'content-type: application/json' -d "{\"projectId\":\"$PROJID\",\"message\":\"Change the counter so it starts at 10 instead of 0.\"}")
cp "$OUT/last-body" "$OUT/giftz-followup.sse"
python3 - "$OUT/giftz-followup.sse" << 'PYEOF'
import json,sys
raw=open(sys.argv[1]).read()
events=[]
for line in raw.split('\n'):
    if line.startswith('data: '):
        try: events.append(json.loads(line[6:]))
        except: pass
done=next((e for e in events if e.get('done')),None)
changes=(done or {}).get('changes') or []
print('follow-up changes:', [(c['path'],c['change']) for c in changes])
for c in changes:
    adds=[l['text'] for l in c['diff'] if l['type']=='add']
    print(f'  {c["path"]} added lines: {adds[:4]}')
PYEOF

echo "== CODE GIFTZ: preview route (real HTML served) =="
R=$(req GET "/api/code-giftz/projects/$PROJID/preview")
python3 -c "
b=open('$OUT/last-body','rb').read()
print(f'preview: $R bytes={len(b)} isHTML={b[:20].lstrip().startswith(b\"<!DOCTYPE\") or b\"<html\" in b[:200] or b\"<!DOCTYPE\" in b[:400]}')"

echo "== CODE GIFTZ: sandbox run (real execution) =="
R=$(req POST "/api/code-giftz/projects/$PROJID/run" -H 'content-type: application/json' -d '{"approval":true}')
python3 -c "
import json;d=json.load(open('$OUT/last-body'))
r=d.get('run') or {}
print(f'run: $R exit={r.get(\"exitCode\")} timedOut={r.get(\"timedOut\")} stdout={repr((r.get(\"stdout\") or \"\")[:80])} stderr_head={repr((r.get(\"stderr\") or \"\")[:60])}')" 2>/dev/null || echo "run: $R $(head -c 200 "$OUT/last-body")"

echo "== ownership isolation (other user's project 404) =="
JAR2="/home/z/my-project/scripts/rework-cookies2.txt"; rm -f "$JAR2"
EMAIL2="rework2-$(date +%s)@bean-test.dev"
curl -sS -o /dev/null -X POST "$LOCAL/api/auth/register" -H 'content-type: application/json' "${hdrs[@]}" -b "$JAR2" -c "$JAR2" -d "{\"email\":\"$EMAIL2\",\"password\":\"$PASS\",\"name\":\"Rework Two\"}"
R=$(curl -sS -o "$OUT/last-body" -w "%{http_code}" "$LOCAL/api/code-giftz/chat/$PROJID" -b "$JAR2" -c "$JAR2" "${hdrs[@]}")
echo "foreign project GET: $R $(head -c 90 "$OUT/last-body")"
echo "done."
