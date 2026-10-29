#!/usr/bin/env bash
# GANGZII conversion pipeline — REAL local-ffmpeg path (gateway-independent).
set -u
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
LOCAL="http://localhost:3000"
JAR="/home/z/my-project/scripts/incident-cookies.txt"
OUT="/home/z/my-project/scripts/incident-e2e-out"
mkdir -p "$OUT"
hdrs=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

# 1. real 2s stereo WAV via ffmpeg (sine) — a valid upload
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" -ac 2 -ar 24000 "$OUT/conv-src.wav" -loglevel error
echo "source wav: $(stat -c%s "$OUT/conv-src.wav") bytes"

# 2. upload + convert to MP3 stereo
R=$(curl -sS -o /tmp/bean-conv-body -w "%{http_code}" -X POST "$LOCAL/api/gangzii/convert" \
  -b "$JAR" -c "$JAR" "${hdrs[@]}" \
  -F "file=@$OUT/conv-src.wav;type=audio/wav" -F "target=mp3" -F "channels=stereo")
echo "convert job: $R $(head -c 160 /tmp/bean-conv-body)"
JOB=$(python3 -c "import json;print(json.load(open('/tmp/bean-conv-body'))['job']['id'])" 2>/dev/null || true)

if [ -n "${JOB:-}" ]; then
  for i in $(seq 1 15); do
    sleep 2
    curl -sS -o /tmp/bean-conv-job -w "" "$LOCAL/api/gangzii/jobs/$JOB" -b "$JAR" "${hdrs[@]}"
    ST=$(python3 -c "import json;d=json.load(open('/tmp/bean-conv-job'));print(d.get('job',{}).get('status','?'))" 2>/dev/null || echo '?')
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then
      echo "convert final: $ST $(python3 -c "
import json
d=json.load(open('/tmp/bean-conv-job'));j=d.get('job',{})
r=j.get('resultJson') or j.get('result') or {}
print(json.dumps(r)[:220])" 2>/dev/null || head -c 200 /tmp/bean-conv-job)"
      # 3. download and verify with ffprobe
      AUD=$(python3 -c "import json;d=json.load(open('/tmp/bean-conv-job'));j=d.get('job',{});r=j.get('resultJson') or '{}'
import json as j2
r=j2.loads(r) if isinstance(r,str) else r
print((r.get('audioId') or r.get('id') or '-'))" 2>/dev/null || echo '-')
      if [ "$AUD" != "-" ]; then
        curl -sS -o "$OUT/conv-out.mp3" "$LOCAL/api/gangzii/audio/$AUD" -b "$JAR" "${hdrs[@]}"
        echo "downloaded: $(stat -c%s "$OUT/conv-out.mp3") bytes"
        ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 "$OUT/conv-out.mp3"
      fi
      break
    fi
  done
fi
