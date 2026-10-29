#!/usr/bin/env python3
"""Parse saved RIISHE SSE files: extract answer, stages, queries, metadata.
The route emits {delta}, {type:stage}, {research:{queries}}, {done:true, meta}."""
import json, sys

def parse(path, full_answer=True):
    deltas, meta, stages, queries, tools = [], None, [], [], []
    for line in open(path):
        line = line.strip()
        if not line.startswith('data: '):
            continue
        try:
            e = json.loads(line[6:])
        except Exception:
            continue
        if e.get('type') == 'stage':
            stages.append(e.get('stage'))
        if isinstance(e.get('research'), dict):
            queries = e['research'].get('queries', [])
        if isinstance(e.get('tool'), dict):
            tools.append(e['tool'])
        if 'delta' in e:
            deltas.append(e['delta'])
        if e.get('done') is True:
            meta = e.get('meta', {})
    answer = ''.join(deltas)
    print(f'--- {path} ---')
    print('stages:', ' -> '.join(s for s in stages if s) or 'NONE')
    print('queries:', queries)
    if tools:
        print('tools:', tools)
    if full_answer:
        print('--- ANSWER ---')
        print(answer)
    else:
        print('--- ANSWER (first 500) ---')
        print(answer[:500])
    print('--- METADATA ---')
    if meta:
        print('states:', meta.get('states'))
        print('retrievedAt:', meta.get('retrievedAt'))
        print('degraded:')
        for d in meta.get('degraded', []):
            print('  -', d)
        print('verification:')
        for v in meta.get('verification', []):
            print(f"  [{v['status']}] {v['check']}: {v['detail'][:150]}")
        sources = meta.get('sources', [])
        print(f'sources ({len(sources)}) — dedup check:')
        seen, dups = set(), 0
        for s in sources:
            key = s['url'].split('?')[0].rstrip('/')
            tag = ' DUP!' if key in seen else ''
            if tag:
                dups += 1
            seen.add(key)
            print(f"  [{s['id']}] {s['title'][:64]} | {s['url'][:95]}")
            print(f"        host={s['hostName']} | date={s['date']} | official={s.get('official')} social={s.get('social')} pageRead={s.get('pageRead')}{tag}")
        print('duplicate URLs in final list:', dups)
    else:
        print('NO done/meta EVENT IN FILE')

if __name__ == '__main__':
    parse(sys.argv[1], full_answer=(len(sys.argv) < 3 or sys.argv[2] != 'short'))
