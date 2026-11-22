#!/usr/bin/env python3
"""M29-CR.1 — exact commit-set arithmetic over all refs.
Proves the true universe (reported 498 vs actual), the sanitized/old split,
and the overlap (shared pre-split root). Read-only.
"""
import subprocess, json
from collections import defaultdict

R = "/home/z/my-project"

def run(*args):
    return subprocess.run(["git", "-C", R, *args], capture_output=True, text=True, check=True).stdout

refs = [l.strip() for l in run("for-each-ref", "--format=%(refname)").splitlines() if l.strip()]
print(f"total refs: {len(refs)}")

SAN_BASELINE = "4d134c5794cfe92ff7c8e477f536075e7c8bffb0"

def commit_set(revs):
    """set of full SHAs reachable from given tips"""
    if not revs:
        return set()
    out = run("rev-list", *revs)
    return set(out.split())

def is_descendant(tip, anc):
    r = subprocess.run(["git", "-C", R, "merge-base", "--is-ancestor", anc, tip],
                       capture_output=True, text=True)
    return r.returncode == 0

# classify refs: sanitized-side iff 4d134c5 is an ancestor of the tip
san_refs, old_refs = [], []
for r in refs:
    tip = run("rev-parse", r).strip()
    if is_descendant(tip, SAN_BASELINE):
        san_refs.append(r)
    else:
        old_refs.append(r)

print(f"sanitized-side refs ({len(san_refs)}):")
for r in san_refs: print("   ", r)
print(f"old-side refs ({len(old_refs)}):")
for r in old_refs: print("   ", r)

S = commit_set(san_refs)
O = commit_set(old_refs)
U = S | O
print(f"\n|S| sanitized reachable = {len(S)}")
print(f"|O| old-side reachable  = {len(O)}")
print(f"|S ∩ O| overlap         = {len(S & O)}")
print(f"|S ∪ O| universe        = {len(U)}")
print(f"|S - O| = {len(S - O)}   |O - S| = {len(O - S)}")

# cross-check with rev-list --all
allc = commit_set(["--all"]) if False else set(run("rev-list", "--all").split())
print(f"|rev-list --all|        = {len(allc)}  (must equal |S ∪ O|: {U == allc})")

# the overlap: shared pre-split root commits
ov = S & O
if ov:
    print(f"\noverlap commits ({len(ov)}):")
    lines = run("log", "--format=%H %s", *sorted(ov)).splitlines()
    for l in lines: print("   ", l[:100])

# key ancestry checks
def anc(a, b):
    return subprocess.run(["git", "-C", R, "merge-base", "--is-ancestor", a, b],
                          capture_output=True).returncode == 0

checks = [
    ("18c93ed ancestor of e96d83a (PR#4 FF)", anc("18c93ed", "e96d83a")),
    ("e96d83a ancestor of migration tip 1465cbb", anc("e96d83a", "1465cbb")),
    ("d2c232a ancestor of 1465cbb", anc("d2c232a", "1465cbb")),
    ("91a6809 (old main) NOT ancestor of 1465cbb", not anc("91a6809", "1465cbb")),
    ("a014862 NOT ancestor of 1465cbb", not anc("a014862", "1465cbb")),
    ("6f0a2b0 NOT ancestor of 1465cbb", not anc("6f0a2b0", "1465cbb")),
    ("e7d7003 NOT ancestor of 1465cbb", not anc("e7d7003", "1465cbb")),
    ("4d134c5 ancestor of 18c93ed", anc(SAN_BASELINE, "18c93ed")),
    ("4d134c5 ancestor of 8f61599", anc(SAN_BASELINE, "8f61599")),
    ("4d134c5 ancestor of 91a6809 (old main)?", anc(SAN_BASELINE, "91a6809")),
]
print("\nancestry checks:")
for name, ok in checks:
    print(f"   [{'PASS' if ok else 'FAIL'}] {name}")

# does the OLD line contain the sanitized baseline? (i.e., sanitized history leaked into old?)
print("\nold main ancestry contains sanitized-only commits?")
# sanitized-only = S - O
leak = [c for c in list(S - O)[:5]]
print("   (sample of S-O would be none if disjoint above)")

# save the sets for the reconciliation step
with open("/home/z/my-project/scripts/m29cr1_sets.json", "w") as f:
    json.dump({
        "san_refs": san_refs, "old_refs": old_refs,
        "S": sorted(S), "O": sorted(O), "overlap": sorted(ov),
        "universe": sorted(U),
    }, f)
print("\nsets saved -> scripts/m29cr1_sets.json")

# per-ref classification detail
print("\nper-ref tip classification:")
for r in refs:
    tip = run("rev-parse", r).strip()
    side = "SAN" if tip in S - O else ("OLD" if tip in O - S else ("SHARED" if tip in ov else "?"))
    print(f"   {tip[:7]} {side} {r}")
