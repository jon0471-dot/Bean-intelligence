#!/usr/bin/env bash
# M27 — HuggingFace probe with retry/backoff (rate-limited per-IP, works with browser UA).
# Maps the Kokoro-82M tree and tests one real binary download.
set -u
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
fetch() { # url outfile
  local url="$1" out="$2" tries=0
  while [ $tries -lt 6 ]; do
    code=$(curl -sL --max-time 60 -H "User-Agent: $UA" -w "%{http_code}" -o "$out" "$url")
    if [ "$code" = "200" ]; then echo "OK $code $url"; return 0; fi
    tries=$((tries+1)); echo "retry $tries code=$code $url" >&2; sleep $((tries*5))
  done
  echo "FAIL $url"; return 1
}
fetch "https://huggingface.co/api/models/hexgrad/Kokoro-82M/tree/main/onnx" /tmp/kokoro-onnx-tree.json
python3 - <<'EOF'
import json
try:
    d = json.load(open('/tmp/kokoro-onnx-tree.json'))
    for f in d:
        print(f['path'], round(f.get('size', 0)/1e6, 1), 'MB')
except Exception as e:
    print('tree parse failed:', e)
EOF
fetch "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices/af_heart.bin" /tmp/af_heart.bin
ls -la /tmp/af_heart.bin 2>/dev/null; file /tmp/af_heart.bin 2>/dev/null
