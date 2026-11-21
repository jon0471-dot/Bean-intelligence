#!/usr/bin/env bash
# M27 — patient Kokoro-82M model downloader (sandbox HF is rate-limited per-IP).
# Downloads the minimal file set for kokoro-js (voices are bundled in the npm package):
#   onnx-community/Kokoro-82M-v1.0-ONNX: config.json, onnx/model_quantized.onnx (q8)
# Uses resume (-C -), browser UA, long backoff. Records sha256 + revision manifest.
set -u
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
REPO="onnx-community/Kokoro-82M-v1.0-ONNX"
DEST="/home/z/my-project/storage/models/hf/onnx-community/Kokoro-82M-v1.0-ONNX"
mkdir -p "$DEST/onnx" /tmp/m27-hf
LOG=/tmp/m27-hf/download.log
echo "$(date -Iseconds) downloader start" >> "$LOG"

fetch() { # url outfile — retries with resume until 200/206 and non-HTML
  local url="$1" out="$2" tries=0 code size
  while [ $tries -lt 40 ]; do
    code=$(curl -sL --max-time 300 -C - -H "User-Agent: $UA" -w "%{http_code}" -o "$out" "$url" 2>>"$LOG")
    size=$(stat -c%s "$out" 2>/dev/null || echo 0)
    # HTML error pages start with '<!DOCTYPE' — detect and restart
    if head -c 15 "$out" 2>/dev/null | grep -q "<!DOCTYPE"; then
      echo "$(date -Iseconds) HTML error page (throttled) for $url, attempt $tries" >> "$LOG"
      rm -f "$out"
    elif [ "$code" = "200" ] || [ "$code" = "206" ]; then
      echo "$(date -Iseconds) OK $code $url ($size bytes)" >> "$LOG"
      return 0
    else
      echo "$(date -Iseconds) code=$code size=$size for $url, attempt $tries" >> "$LOG"
    fi
    tries=$((tries+1))
    sleep 45
  done
  echo "$(date -Iseconds) FAILED $url" >> "$LOG"
  return 1
}

fetch "https://huggingface.co/$REPO/resolve/main/config.json" "$DEST/config.json" || exit 1
fetch "https://huggingface.co/$REPO/resolve/main/tokenizer.json" "$DEST/tokenizer.json"
fetch "https://huggingface.co/$REPO/resolve/main/onnx/model_quantized.onnx" "$DEST/onnx/model_quantized.onnx" || exit 1

# checksums + revision manifest
REV=$(curl -s --max-time 30 -H "User-Agent: $UA" "https://huggingface.co/api/models/$REPO" | grep -oE '"sha":"[a-f0-9]+"' | head -1 | cut -d'"' -f4)
sha256sum "$DEST/config.json" "$DEST/onnx/model_quantized.onnx" > "$DEST/sha256sums.txt" 2>/dev/null
echo "revision=$REV" >> "$DEST/sha256sums.txt"
echo "$(date -Iseconds) downloader done rev=$REV" >> "$LOG"
ls -la "$DEST" "$DEST/onnx" >> "$LOG"
