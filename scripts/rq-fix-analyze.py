#!/usr/bin/env python3
"""Full analysis of a reproduced RIISHE run: answer, states, note, verification, sources, degraded."""
import json, sys

def parse(path):
    content, meta = "", None
    queries = None
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip()
        if not line.startswith('data:'): continue
        p = line[5:].strip()
        try: obj = json.loads(p)
        except Exception: continue
        if not isinstance(obj, dict): continue
        if obj.get('reset') is True: content = ''  # reset protocol: final replaces draft
        if isinstance(obj.get('content'), str): content += obj['content']
        if isinstance(obj.get('delta'), str): content += obj['delta']
        if isinstance(obj.get('research'), dict): queries = obj['research'].get('queries')
        if obj.get('meta') and isinstance(obj['meta'], dict): meta = obj['meta']
    return content, meta, queries

for path in sys.argv[1:]:
    c, m, q = parse(path)
    print('=' * 110)
    print('FILE:', path)
    print('QUERIES:', q)
    print('--- ANSWER ---')
    print(c)
    if m:
        print('STATES:', m.get('states'))
        print('NOTE:', json.dumps(m.get('verificationNote'), ensure_ascii=False))
        for v in m.get('verification') or []:
            print(f"  VERIFY [{v['status']}] {v['check']}: {v['detail'][:200]}")
        for s in m.get('sources') or []:
            print(f"  SRC [{s['id']}] {s['title'][:78]} | {s['hostName']} | date={s.get('date')} official={s.get('official')} social={s.get('social')} pageRead={s.get('pageRead')}")
            print('      ', s.get('url'))
        for d in m.get('degraded') or []:
            print('  DEGRADED:', d[:160])
        print('TIMINGS:', m.get('timings'))
