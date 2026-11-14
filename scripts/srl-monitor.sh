#!/bin/bash
# Monitors the two live test jobs until terminal status (max ~9 min),
# snapshotting evidence lines to /tmp/srl-monitor.log.
JOBS="laxii:cmwg0onsa000lqen9t9bwtwhf jazmii:cmwg0ophe000qqen9gydm4kwi"
END=$((SECONDS + 540))
while [ $SECONDS -lt $END ]; do
  LINE="t=$((SECONDS))s"
  DONE=1
  for pair in $JOBS; do
    prod="${pair%%:*}"; id="${pair##*:}"
    if [ "$prod" = "laxii" ]; then url="http://localhost:3000/api/laxii/jobs/$id"; else url="http://localhost:3000/api/jazmii/jobs/$id"; fi
    S=$(curl -s -b /tmp/bean-cookies.txt "$url" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); j=d.get('job',d)
    print(f\"{j.get('status')}/{j.get('progress')}%/{j.get('errorCode')}\")
except Exception as e:
    print('ERR')
")
    LINE="$LINE $prod=$S"
    case "$S" in completed*|failed*|cancelled*) ;; *) DONE=0 ;; esac
  done
  echo "$LINE" >> /tmp/srl-monitor.log
  [ "$DONE" = "1" ] && break
  sleep 45
done
echo "monitor finished" >> /tmp/srl-monitor.log
