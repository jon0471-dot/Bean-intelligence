#!/usr/bin/env python3
"""Parse saved perf-measure SSE files into the JSONL aggregate format.
Usage: perf-parse-sse.py <label> — reads scripts/perf-out/<label>-<scenario>-*.sse
"""
import json, glob, os, sys, re

label = sys.argv[1] if len(sys.argv) > 1 else 'baseline'
out_dir = '/home/z/my-project/scripts/perf-out'
out_path = os.path.join(out_dir, f'{label}.jsonl')
rows = []
for path in sorted(glob.glob(os.path.join(out_dir, f'{label}-*-*.sse'))):
    base = os.path.basename(path)[:-4]  # label-scenario-rand
    scen = base[len(label) + 1:].rsplit('-', 1)[0]
    raw = open(path).read()
    events = []
    for line in raw.split('\n'):
        if line.startswith('data: '):
            try: events.append(json.loads(line[6:]))
            except Exception: pass
    done = next((e for e in events if e.get('done')), None)
    err = next((e for e in events if e.get('error')), None)
    md = (done or {}).get('meta') or {}
    text = ''.join(e.get('delta', '') for e in events if e.get('delta'))
    rows.append({
        'label': label, 'scenario': scen,
        'http': 200 if done else 0,
        'wallClientMs': None, 'message': None,
        'firstTokenMs': (done or {}).get('firstTokenMs'),
        'durationServerMs': (done or {}).get('durationMs'),
        'timings': md.get('timings'),
        'states': md.get('states'),
        'sources': len(md.get('sources') or []),
        'degraded': md.get('degraded') or [],
        'error': (err or {}).get('error'),
        'answerChars': len(text),
        'answerHead': text[:160],
    })
with open(out_path, 'w') as f:
    for r in rows:
        f.write(json.dumps(r) + '\n')
print(f'wrote {len(rows)} records -> {out_path}')
