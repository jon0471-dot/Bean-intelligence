#!/usr/bin/env python3
"""M22 forensic: find the minimal execution-order prefix that poisons a victim test file.

Mechanism under test: bun (without --isolate) runs all test files in ONE process with a
shared global object; module singletons / process.env mutations from earlier files leak
into later files. The documented repo command is `bun test --isolate tests/`, which
prevents this by design (fresh global per file).

Usage: python3 scripts/m22-poison-hunt.py <victim.test.ts> [worktree]
Reads the full execution order from /tmp/m22/runC-junit.xml, binary-searches the minimal
prefix (in that order) whose concatenation + victim-as-last-file makes the victim fail,
then reports the boundary file (the poisoner candidate) and captures the victim's
assertion diff for the report.
"""
import subprocess, sys, json, xml.etree.ElementTree as ET

victim = sys.argv[1]
wt = sys.argv[2] if len(sys.argv) > 2 else "/tmp/m22-baseline"

tree = ET.parse('/tmp/m22/runC-junit.xml')
root = tree.getroot()
order = []
def walk(s):
    f = s.get('file')
    if f and f not in order:
        order.append(f)
    for sub in s.findall('testsuite'):
        walk(sub)
for s in root.findall('testsuite'):
    walk(s)

vi = order.index(victim)
prefix_pool = order[:vi]
print(f"victim {victim} at execution index {vi}; prefix pool = {len(prefix_pool)} files")


def run(files, capture=False):
    cmd = ["bun", "test", *files]
    p = subprocess.run(cmd, cwd=wt, capture_output=True, text=True, timeout=580)
    out = p.stdout + p.stderr
    fail = " 0 fail" not in out
    if capture:
        return fail, out
    return fail


def check(k):
    """prefix of first k pool files + victim as last file -> victim fails?"""
    files = prefix_pool[:k] + [victim]
    return run(files)


lo, hi = 0, len(prefix_pool)  # check(hi) == full-suite behavior
if not check(hi):
    print("victim PASSES even with full prefix -> poisoner not in pool; stopping")
    sys.exit(0)
# invariant: check(hi) True; find minimal k with check(k) True
while lo < hi:
    mid = (lo + hi) // 2
    if check(mid):
        hi = mid
    else:
        lo = mid + 1
k = lo
poisoner = prefix_pool[k - 1] if k > 0 else "(none)"
print(f"minimal poisoning prefix: {k} files; boundary file (poisoner candidate): {poisoner}")

fail, out = run(prefix_pool[:k] + [victim], capture=True)
lines = out.splitlines()
# print the first failing assertion with context (expect diff lines)
for i, ln in enumerate(lines):
    if ln.startswith("(fail)") and victim.split('/')[-1] in out[:out.find(ln)]:
        pass
idx = out.find("(fail)")
print("=== first failure context ===")
print("\n".join(lines[max(0, idx - 6): idx + 14])[:2000])
print("=== summary ===")
print("\n".join(lines[-4:]))
