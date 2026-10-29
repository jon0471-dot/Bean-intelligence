#!/usr/bin/env python3
"""Re-parse the recorded SSE transcripts with a citation regex that handles
both [1] and [3, 4, 6] forms; print full answers for accuracy review."""
import json, re, sys, pathlib

OUT = pathlib.Path('/home/z/my-project/scripts/retrieval-e2e-out')

def parse(label):
    raw = (OUT / f'{label}.sse').read_text()
    events = []
    for line in raw.split('\n'):
        if line.startswith('data: '):
            try:
                events.append(json.loads(line[6:]))
            except Exception:
                pass
    done = next((e for e in events if e.get('done')), None)
    md = (done or {}).get('meta') or {}
    text = ''.join(e.get('delta', '') for e in events if e.get('delta'))
    sources = md.get('sources') or []
    ids = {s['id'] for s in sources}
    # handles [1], [1, 2], [1,2, 3]
    markers = []
    for grp in re.findall(r'\[([\d,\s]+)\]', text):
        for part in grp.split(','):
            part = part.strip()
            if part.isdigit():
                markers.append(int(part))
    markers = sorted(set(markers))
    unresolved = [m for m in markers if m not in ids]
    print(f'== {label}: markers={markers} unresolved={unresolved} sources={len(sources)}')
    return text

for label in ['cm-screenshot', 'gingee', 'tn-cm', 'nextjs']:
    text = parse(label)
    print(text)
    print('=' * 100)
