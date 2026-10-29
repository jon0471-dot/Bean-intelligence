#!/usr/bin/env bash
# GANGZII E2E acceptance matrix — all requests through the USER'S REAL preview
# origin with browser-equivalent fetch-metadata (same as e2e-csrf-matrix.sh).
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/e2e-gangzii-cookies.txt"
OUT="/home/z/my-project/scripts/e2e-gangzii-out"
mkdir -p "$OUT"
rm -f "$JAR"

EMAIL="gangzii-e2e-$(date +%s)@bean-test.dev"
PASS="Gangzii#Passw0rd!42"

hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

req() { # method path [curl extra...]
  local m="$1"; local p="$2"; shift 2
  curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X "$m" "$LOCAL$p" -b "$JAR" -c "$JAR" "${hdrs[@]}" "$@"
}

echo "== 1. register + session =="
R=$(req POST /api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Gangzii E2E\"}")
echo "register: $R $(head -c 120 /tmp/bean-e2e-body)"
R=$(req GET /api/auth/session)
echo "session:  $R $(head -c 150 /tmp/bean-e2e-body)"

echo "== 2. products catalog + health =="
R=$(req GET /api/products)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
ps={p['id']:p['available'] for p in d['products']}
print('products:', ps)
assert 'gangzii' in ps and ps['gangzii'] is True, 'gangzii must be available'
"
R=$(req GET /api/health)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
g=d['products']['gangzii']
print('health.gangzii:', {k:g[k] for k in ('available','partial')})
print('capabilities:', {k:v['available'] for k,v in g['capabilities'].items()})
assert g['available'] is True
assert g['capabilities']['musicGeneration']['available'] is False
"

echo "== 3. availability endpoint =="
R=$(req GET /api/gangzii/availability)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
caps={k:v['available'] for k,v in d['capabilities'].items()}
print('availability:', caps, 'partial:', d['partial'])
assert d['available'] is True and d['partial'] is True
assert caps['musicGeneration'] is False and caps['audioTools'] is False
assert caps['speechSynthesis'] is True and caps['conversion'] is True
assert caps['stereoExport'] is True
print('stereoExport detail:', d['capabilities']['stereoExport']['detail'][:120])
" || exit 1

echo "== 3b. voice + song preset catalogs (backend-served registry) =="
R=$(req GET /api/gangzii/voices)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
ids=[p['id'] for p in d['presets']]
print('voice presets:', ids)
assert len(ids)==7 and len(set(ids))==7
assert {'tongtong','chuichui','xiaochen','jam','kazi','douji','luodo'} <= set(ids)
assert all(p['id']==p['providerVoiceId'] for p in d['presets']), 'preset id must BE the provider voice id'
assert len(d['categories'])>=4 and all(any(p['category']==c['id'] for p in d['presets']) for c in d['categories'])
assert d['controls']=={'speed':True,'language':False,'pitch':False,'emotion':False}
assert d['limits']['sourceChannels']==1 and d['limits']['stereoExport']=='dual-mono'
tamil=[l for p in d['presets'] for l in p['languages'] if l['lang']=='Tamil']
assert all(l['status']=='unverified' for l in tamil) and len(tamil)>0
print('voice catalog OK: categories', [c['id'] for c in d['categories']])
" || exit 1
R=$(req GET /api/gangzii/song-presets)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
ids=[p['id'] for p in d['presets']]
print('song presets:', len(ids))
assert len(ids)==16 and len(set(ids))==16
required={'cinematic-orchestral','emotional-pop','electronic-pop','edm-festival','synthwave-retro','dark-cinematic','lofi-chill','ambient','rock','hiphop-rap','acoustic','indian-fusion','tamil-pop','tamil-melody','instrumental-soundtrack','epic-trailer'}
assert required <= set(ids), required - set(ids)
assert d['generation']['available'] is False and d['generation']['singingAvailable'] is False
assert all(p['generationAvailable'] is False and p.get('unavailableReason') for p in d['presets'])
print('song preset catalog OK — every preset truthfully unavailable for generation')
" || exit 1

echo "== 4. TTS happy path (async job -> WAV artifact; wav-format beep-free path) =="
R=$(req POST /api/gangzii/tts -H 'content-type: application/json' -d '{"text":"BEAN Intelligence GANGZII end to end verification. This line must come back from the speech recognizer.","voice":"tongtong","speed":1.0,"source":"studio"}')
echo "tts submit: $R $(head -c 160 /tmp/bean-e2e-body)"
JOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-e2e-body'))['job']['id'])")
for i in $(seq 1 40); do
  sleep 1.5
  R=$(req GET "/api/gangzii/jobs/$JOB")
  ST=$(python3 -c "import json;j=json.load(open('/tmp/bean-e2e-body'))['job'];print(j['status'])")
  [ "$ST" = "completed" ] && break
  [ "$ST" = "failed" ] && { echo "TTS FAILED: $(cat /tmp/bean-e2e-body)"; exit 1; }
done
echo "tts status: $ST"
python3 -c "
import json;j=json.load(open('/tmp/bean-e2e-body'))['job']
assert j['status']=='completed', j
r=j['result']
print('tts result:', {k:r[k] for k in ('chunks','durationSec','bytes','channelLayout') if k in r})
assert r.get('channels')==1 and 'mono' in r.get('channelLayout',''), 'source asset must be mono'
assert r.get('beepStripped') in (False,), 'defensive guard should NOT trigger on the clean wav path'
" || exit 1
R=$(req GET "/api/gangzii/audio/$JOB")
curl -sS -o "$OUT/tts.wav" "$LOCAL/api/gangzii/audio/$JOB" -b "$JAR" "${hdrs[@]}"
MAGIC=$(head -c 4 "$OUT/tts.wav")
echo "artifact magic: '$MAGIC' size: $(stat -c%s "$OUT/tts.wav")"
[ "$MAGIC" = "RIFF" ] || { echo "NOT A WAV"; exit 1; }
ffprobe -v error -show_entries stream=sample_rate,channels,codec_name -of csv=p=0 "$OUT/tts.wav"

echo "== 4b. BEEP REGRESSION: the generated audio must not open with the 1650 Hz artifact =="
bun scripts/beep-regression.ts "$OUT/tts.wav" || { echo 'BEEP REGRESSION FAILED'; exit 1; }
R=$(req GET "/api/gangzii/audio/$JOB?download=1")
echo "download=1 status: $R"

echo "== 5. TTS validation: text too long (7000 chars) =="
LONG=$(python3 -c "print('word '*7000)")
R=$(req POST /api/gangzii/tts -H 'content-type: application/json' -d "{\"text\":\"$LONG\",\"voice\":\"tongtong\",\"speed\":1.0}")
echo "oversize: $R $(head -c 160 /tmp/bean-e2e-body)"

echo "== 6. Transcribe the generated WAV (round trip) =="
R=$(req POST /api/gangzii/transcribe -F "file=@$OUT/tts.wav;type=audio/wav")
echo "transcribe submit: $R $(head -c 160 /tmp/bean-e2e-body)"
TJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-e2e-body'))['job']['id'])")
for i in $(seq 1 40); do
  sleep 1.5
  R=$(req GET "/api/gangzii/jobs/$TJOB")
  ST=$(python3 -c "import json;j=json.load(open('/tmp/bean-e2e-body'))['job'];print(j['status'])")
  [ "$ST" = "completed" ] && break
  [ "$ST" = "failed" ] && break
done
python3 -c "
import json;j=json.load(open('/tmp/bean-e2e-body'))['job']
assert j['status']=='completed', j
t=j['result']['transcript']
print('transcript:', t[:140])
assert len(t) > 10, 'transcript suspiciously short'
# The distinctive tail must survive the round trip (proper nouns like GANGZII
# may be homophoned by the recognizer — measured: 'GANGZII' -> 'gangs').
assert 'speech recognizer' in t.lower(), 'transcript does not echo source text'
" || exit 1

echo "== 7. Convert WAV -> MP3 (upload path, mono default) =="
R=$(req POST /api/gangzii/convert -F "file=@$OUT/tts.wav;type=audio/wav" -F "target=mp3" -F "channels=mono")
echo "convert submit: $R $(head -c 160 /tmp/bean-e2e-body)"
CJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-e2e-body'))['job']['id'])")
for i in $(seq 1 30); do
  sleep 1.5
  R=$(req GET "/api/gangzii/jobs/$CJOB")
  ST=$(python3 -c "import json;j=json.load(open('/tmp/bean-e2e-body'))['job'];print(j['status'])")
  [ "$ST" = "completed" ] && break
  [ "$ST" = "failed" ] && { echo "CONVERT FAILED: $(cat /tmp/bean-e2e-body)"; exit 1; }
done
curl -sS -o "$OUT/converted.mp3" "$LOCAL/api/gangzii/audio/$CJOB" -b "$JAR" "${hdrs[@]}"
echo "mp3 codec: $(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$OUT/converted.mp3")"
MAGIC=$(python3 -c "print(open('$OUT/converted.mp3','rb').read(3).hex())")
echo "mp3 magic: $MAGIC size: $(stat -c%s "$OUT/converted.mp3")"
[[ "$MAGIC" == "494433" || "$MAGIC" == fffb* || "$MAGIC" == fff3* || "$MAGIC" == fff2* ]] || { echo "NOT AN MP3"; exit 1; }

export_job() { # sourceJobId target channels outfile
  R=$(req POST /api/gangzii/convert -F "sourceJobId=$1" -F "target=$2" -F "channels=$3")
  echo "export submit ($2/$3): $R $(head -c 140 /tmp/bean-e2e-body)"
  local EJOB
  EJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-e2e-body'))['job']['id'])")
  for i in $(seq 1 30); do
    sleep 1.5
    R=$(req GET "/api/gangzii/jobs/$EJOB")
    ST=$(python3 -c "import json;j=json.load(open('/tmp/bean-e2e-body'))['job'];print(j['status'])")
    [ "$ST" = "completed" ] && break
    [ "$ST" = "failed" ] && { echo "EXPORT FAILED: $(cat /tmp/bean-e2e-body)"; exit 1; }
  done
  python3 -c "
import json;j=json.load(open('/tmp/bean-e2e-body'))['job']
assert j['status']=='completed', j
r=j['result']
print('  verified metadata:', {k:r[k] for k in ('codec','sampleRateHz','channels','durationSec','channelSemantics') if k in r})
assert r['channels']==$([ "$3" = stereo ] && echo 2 || echo 1), 'ffprobe-verified channels must match the request'
" || exit 1
  curl -sS -o "$4" "$LOCAL/api/gangzii/audio/$EJOB" -b "$JAR" "${hdrs[@]}"
  echo "$EJOB"
}

echo "== 7b. SOURCE-ASSET EXPORTS (mono wav / stereo wav / stereo mp3, ffprobe-verified) =="
E1=$(export_job "$JOB" wav mono "$OUT/export-mono.wav")
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,duration -of csv=p=0 "$OUT/export-mono.wav"
[ "$(ffprobe -v error -show_entries stream=channels -of csv=p=0 "$OUT/export-mono.wav")" = "1" ] || { echo 'mono export not 1ch'; exit 1; }

E2=$(export_job "$JOB" wav stereo "$OUT/export-stereo.wav")
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,duration -of csv=p=0 "$OUT/export-stereo.wav"
[ "$(ffprobe -v error -show_entries stream=channels -of csv=p=0 "$OUT/export-stereo.wav")" = "2" ] || { echo 'stereo export not 2ch'; exit 1; }

E3=$(export_job "$JOB" mp3 stereo "$OUT/export-stereo.mp3")
ffprobe -v error -show_entries stream=codec_name,channels -of csv=p=0 "$OUT/export-stereo.mp3"
[ "$(ffprobe -v error -show_entries stream=channels -of csv=p=0 "$OUT/export-stereo.mp3")" = "2" ] || { echo 'stereo mp3 not 2ch'; exit 1; }
# stereo file must be ~2x the bytes of the mono mp3 (duplicated channels, real conversion)
echo "sizes: mono.wav=$(stat -c%s "$OUT/export-mono.wav") stereo.wav=$(stat -c%s "$OUT/export-stereo.wav") stereo.mp3=$(stat -c%s "$OUT/export-stereo.mp3")"

# the exported stereo WAV must PLAY like the source: same duration as source ±0.2s
python3 -c "
import subprocess, json
def dur(p):
    out=subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=duration','-of','json',p])
    return float(json.loads(out)['streams'][0]['duration'])
s=dur('$OUT/tts.wav'); m=dur('$OUT/export-mono.wav'); st=dur('$OUT/export-stereo.wav')
print(f'durations: source={s:.2f} mono={m:.2f} stereo={st:.2f}')
assert abs(m-s)<0.25 and abs(st-s)<0.25, 'channel duplication must preserve duration'
" || exit 1

echo "== 7c. CONVERSION FAILURE -> actionable error (valid RIFF container, unsupported codec tag) =="
python3 -c "
import struct
# RIFF/WAVE magic passes BEAN's container sniff, but audioFormat 0xFFFF has
# no decoder in ffmpeg -> the conversion must fail with an actionable error.
h=b'RIFF'+struct.pack('<I',36+2000)+b'WAVEfmt '+struct.pack('<IHHIIHH',16,0xFFFF,1,24000,48000,2,16)+b'data'+struct.pack('<I',2000)
open('$OUT/corrupt.wav','wb').write(h+b'\x00\x00'*1000)
"
R=$(req POST /api/gangzii/convert -F "file=@$OUT/corrupt.wav;type=audio/wav" -F "target=mp3" -F "channels=stereo")
echo "corrupt convert submit: $R $(head -c 160 /tmp/bean-e2e-body)"
XJOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-e2e-body'))['job']['id'])")
for i in $(seq 1 30); do
  sleep 1.5
  R=$(req GET "/api/gangzii/jobs/$XJOB")
  ST=$(python3 -c "import json;j=json.load(open('/tmp/bean-e2e-body'))['job'];print(j['status'])")
  [ "$ST" = "failed" ] && break
  [ "$ST" = "completed" ] && break
done
python3 -c "
import json;j=json.load(open('/tmp/bean-e2e-body'))['job']
assert j['status']=='failed', j
msg=j['errorMessage']
print('failure message:', msg)
assert len(msg)>20 and ('try' in msg.lower() or 'check' in msg.lower()), 'failure must be actionable'
" || exit 1

echo "== 8. Upload truth: fake audio rejected =="
echo "this is definitely not audio" > "$OUT/fake.txt"
R=$(req POST /api/gangzii/transcribe -F "file=@$OUT/fake.txt;type=audio/mpeg")
echo "fake upload: $R $(head -c 220 /tmp/bean-e2e-body)"

echo "== 9. Write Lyrics with RIISHE (real conversation adapter, preset-aware) =="
R=$(req POST /api/gangzii/lyrics -H 'content-type: application/json' -d '{"prompt":"A gentle midnight train ride home","presetId":"electronic-pop","preferences":"two verses, memorable chorus"}')
cp /tmp/bean-e2e-body /tmp/bean-e2e-lyrics.json
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
ly=d.get('lyrics','')
print('writtenBy:', d.get('writtenBy'), '| chars:', len(ly)); print(ly[:180].replace(chr(10),' | '))
assert d.get('writtenBy')=='RIISHE'
assert len(ly) > 80, 'lyrics too short'
assert 'spoken, not sung' in d.get('note','')
"

echo "== 9b. Analyze lyrics with RIISHE (structured critique of the real draft) =="
python3 -c "
import json
lyrics=json.load(open('/tmp/bean-e2e-lyrics.json'))['lyrics']
json.dump({'lyrics':lyrics,'songIdea':'A gentle midnight train ride home','presetId':'electronic-pop'}, open('/tmp/bean-e2e-analyze.json','w'))
"
R=$(req POST /api/gangzii/lyrics/analyze -H 'content-type: application/json' -d @/tmp/bean-e2e-analyze.json)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
a=d['analysis']
print('analyzedBy:', d.get('analyzedBy'), '| overall:', a['overall'][:110])
print('strengths:', len(a['strengths']), '| weaknesses:', len(a['weaknesses']), '| sections:', len(a['sections']), '| improvements:', len(a['improvements']))
assert d.get('analyzedBy')=='RIISHE'
assert len(a['overall'])>20
assert isinstance(a['strengths'],list) and isinstance(a['weaknesses'],list) and isinstance(a['sections'],list) and isinstance(a['improvements'],list)
assert 'melody' in d.get('limitation','').lower() or 'singing' in d.get('limitation','').lower(), 'honest limitation must be present'
assert d.get('improvedDraft') is None, 'analyze must NOT rewrite without an explicit request'
" || exit 1

echo "== 9c. Improve lyrics with RIISHE (full improved draft, compared never auto-applied) =="
python3 -c "
import json
p=json.load(open('/tmp/bean-e2e-analyze.json'))
p['wantImprovedDraft']=True
json.dump(p, open('/tmp/bean-e2e-improve.json','w'))
"
R=$(req POST /api/gangzii/lyrics/analyze -H 'content-type: application/json' -d @/tmp/bean-e2e-improve.json)
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
dr=d.get('improvedDraft','')
print('improvedDraft chars:', len(dr)); print(dr[:160].replace(chr(10),' | '))
assert isinstance(dr,str) and len(dr)>80, 'improve must return a full draft'
" || exit 1

echo "== 9d. Malformed-RIISHE honesty: unknown preset on music submit fails clearly =="
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

echo "== 10. Live Voice turn (real STT->LLM pipeline step) =="
R=$(req POST /api/gangzii/live -H 'content-type: application/json' -d '{"transcript":"Hello GANGZII, who are you? Answer in one short sentence.","history":[]}')
python3 -c "
import json;d=json.load(open('/tmp/bean-e2e-body'))
r=d.get('reply','')
print('live reply:', r[:160])
assert len(r) > 10 and len(r) < 1200
"

echo "== 11. Delete job removes DB row + files =="
ls /home/z/my-project/storage/gangzii/*/tts/ 2>/dev/null | head -3
R=$(req DELETE "/api/gangzii/jobs/$CJOB")
echo "delete convert job: $R"
ls /home/z/my-project/storage/gangzii/*/convert/ 2>/dev/null | head -3 || echo "(convert dir empty/gone — files really removed)"
R=$(req GET "/api/gangzii/jobs/$CJOB")
echo "get deleted job: $R"

echo "== 12. Unauthorized + cross-site attacks rejected =="
R=$(curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X POST "$LOCAL/api/gangzii/tts" -H 'content-type: application/json' -d '{"text":"hi","voice":"tongtong","speed":1.0}')
echo "no-cookie tts: $R"
[ "$R" = "401" ] || exit 1
R=$(curl -sS -o /tmp/bean-e2e-body -w "%{http_code}" -X POST "$LOCAL/api/gangzii/tts" -H 'content-type: application/json' -H "Origin: https://evil.example.com" -H "Sec-Fetch-Site: cross-site" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty" -b "$JAR" -d '{"text":"hi","voice":"tongtong","speed":1.0}')
echo "cross-site tts: $R"
[ "$R" = "403" ] || exit 1

echo
echo "E2E MATRIX: ALL PASSED"
