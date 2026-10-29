#!/usr/bin/env python3
"""Aggregate a perf-measure output (JSONL) into per-scenario latency stats.

Reports count, median and p95 for client wall time, server-measured
firstTokenMs and totalMs, plus the measured sub-timings (research, search,
page reads, solve, verify). Honest: scenarios with zero successful samples
are reported as UNAVAILABLE, never fabricated.
"""
import json, statistics, sys

def pct95(xs):
    if not xs: return None
    xs = sorted(xs)
    # nearest-rank
    k = max(0, min(len(xs) - 1, round(0.95 * (len(xs) - 1))))
    return xs[k]

def main(path):
    recs = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                recs.append(json.loads(line))
    by = {}
    for r in recs:
        by.setdefault(r['scenario'], []).append(r)
    print(f"== {path} ==")
    for scen, rs in by.items():
        ok = [r for r in rs if r['http'] == 200 and not r['error']]
        walls = [r['wallClientMs'] for r in ok if r['wallClientMs'] is not None]
        ttft = [r['firstTokenMs'] for r in ok if r['firstTokenMs'] is not None]
        totals = [ (r.get('timings') or {}).get('totalMs') or r.get('durationServerMs') for r in ok ]
        totals = [t for t in totals if t is not None]
        def stat(xs):
            if not xs: return 'n/a'
            if len(xs) == 1: return f"{xs[0]}ms (n=1)"
            return f"p50={int(statistics.median(xs))}ms p95={int(pct95(xs))}ms (n={len(xs)})"
        print(f"\n[{scen}] runs={len(rs)} ok={len(ok)}")
        print(f"  wall:    {stat(walls)}")
        print(f"  ttft:    {stat(ttft)}")
        print(f"  total:   {stat(totals)}")
        # sub-timings from the first ok record with timings
        for r in ok:
            t = r.get('timings')
            if t:
                parts = {k: v for k, v in t.items() if k not in ('totalMs',)}
                print(f"  breakdown(run): {parts}")
                break
        for r in ok:
            if r['degraded']:
                print(f"  degraded: {r['degraded']}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/scripts/perf-out/baseline.jsonl')
