#!/bin/bash
# Focused Q11 re-run against a fresh verification instance (new build).
set -u
BASE="http://127.0.0.1:3100"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT="/home/z/my-project/scripts/e2e-verify-out"
curl -s -c "$OUT/cookies2.txt" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d '{"email":"e2e-stream-1103@bean.dev","password":"Stream-Rel-1103-Pw!"}' -o /dev/null
echo "login done"
t0=$(date +%s%3N)
curl -s -N -b "$OUT/cookies2.txt" -X POST "$BASE/api/riishe/chat?stream=1" \
  -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d '{"message":"What is the latest Node.js version right now? Distinguish the LTS and Current lines and give release dates."}' \
  -o "$OUT/q11-rerun.sse" --max-time 300
t1=$(date +%s%3N)
python3 - "$OUT/q11-rerun.sse" "$t0" "$t1" <<'PYEOF'
import json, sys
path, t0, t1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
deltas = []; resets = 0; done = None; err = None; queries = None; keepalives = 0
for line in open(path, encoding='utf-8', errors='replace'):
    if line.startswith(': '): keepalives += 1; continue
    if line.startswith('data: '):
        try: evt = json.loads(line[6:])
        except Exception: continue
        if evt.get('reset'): resets += 1; deltas = []
        if 'delta' in evt: deltas.append(evt['delta'])
        if 'research' in evt: queries = evt['research'].get('queries')
        if evt.get('done'): done = evt
        if evt.get('error'): err = evt
print(f"[q11-rerun] deltas={len(deltas)} keepalives={keepalives} wall={t1-t0}ms resets={resets}")
print(f"[q11-rerun] queries={json.dumps(queries, ensure_ascii=False)}")
if done: print(f"[q11-rerun] done: partial={done.get('partial')} states={','.join((done.get('meta') or {}).get('states', []))}")
if err: print(f"[q11-rerun] ERROR: {err}")
answer = ''.join(deltas)
open(path.replace('.sse', '.answer.txt'), 'w', encoding='utf-8').write(answer)
gt = ['26.13', 'Lithium']
hit = [g for g in gt if g in answer]
print(f"[q11-rerun] ground-truth hits: {hit} | mentions Oct 28: {'Oct 28' in answer or 'October 28' in answer} | calls 24.x latest-LTS: {'24.22' in answer and 'LTS' in answer and '26.1' not in answer}")
print("[q11-rerun] answer head:", answer[:300].replace(chr(10), ' '))
PYEOF
