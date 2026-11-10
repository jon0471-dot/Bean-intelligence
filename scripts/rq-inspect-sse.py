#!/usr/bin/env python3
"""Inspect recorded SSE runs: extract verification notes, checks, sources."""
import json, sys, glob, re

def sse_records(path):
    data = {"meta": None, "content": "", "sources": [], "verification": [], "states": [], "degraded": [], "note": None}
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line.startswith('data:'):
                continue
            payload = line[5:].strip()
            if not payload or payload == '[DONE]':
                continue
            try:
                obj = json.loads(payload)
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue
            if 'content' in obj and isinstance(obj['content'], str):
                data['content'] += obj['content']
            if 'metadata' in obj and isinstance(obj['metadata'], dict):
                md = obj['metadata']
                data['sources'] = md.get('sources', [])
                data['verification'] = md.get('verification', [])
                data['states'] = md.get('states', [])
                data['degraded'] = md.get('degraded', [])
                data['note'] = md.get('verificationNote')
    return data

for path in sys.argv[1:]:
    d = sse_records(path)
    print('=' * 100)
    print('FILE:', path)
    print('STATES:', d['states'])
    print('NOTE:', d['note'])
    print('DEGRADED:')
    for g in d['degraded']:
        print('  -', g)
    print('VERIFICATION:')
    for v in d['verification']:
        print(f"  [{v.get('status')}] {v.get('check')}: {str(v.get('detail'))[:220]}")
    print('SOURCES:')
    for s in d['sources']:
        print(f"  [{s.get('id')}] {s.get('title')} | {s.get('hostName')} | date={s.get('date')} official={s.get('official')} pageRead={s.get('pageRead')}")
        print('       url:', s.get('url'))
    print('CONTENT (first 700 chars):')
    print(d['content'][:700])
