#!/usr/bin/env python3
"""M29-CR.1 — verify the published 258-row reconciliation table against actual Git objects. v2
Robust cell-splitting parser + bytes-safe patch-id computation.
"""
import subprocess, re, json
from collections import defaultdict

R = "/home/z/my-project"
def run(*a, check=True):
    return subprocess.run(["git", "-C", R, *a], capture_output=True, text=True, check=check).stdout

sets = json.load(open("/home/z/my-project/scripts/m29cr1_sets.json"))
S, O = set(sets["S"]), set(sets["O"])
OLD_ONLY = O - S
print(f"OLD-ONLY |O-S| = {len(OLD_ONLY)}")

# --- parse table (robust: split on '|') ---
text = open(f"{R}/download/M29-COMMIT-RECONCILIATION-TABLE.md").read()
rows = []
for line in text.splitlines():
    if not line.startswith("| "): continue
    cells = [c.strip() for c in line.split("|")]  # cells[0]='' cells[-1]=''
    if len(cells) < 9: continue
    num, sha12, short, date, merge = cells[1], cells[2], cells[3], cells[4], cells[5]
    if not re.fullmatch(r"\d+", num or ""): continue
    cat, ev, subj = cells[6], cells[7], cells[8] if len(cells) > 8 else ""
    rows.append((int(num), sha12.strip("`"), short.strip("`"), date, merge, cat, ev, subj))
print(f"parsed rows: {len(rows)}")
cat_count = defaultdict(int)
for row in rows: cat_count[row[5]] += 1
print("categories in published table:")
for k, v in sorted(cat_count.items(), key=lambda x: -x[1]):
    print(f"   {v:4d}  {k}")

# --- validate SHAs ---
full_by_short = {}
for line in run("rev-list", "--all").splitlines(): full_by_short[line[:8]] = line
row_shas, problems = set(), []
for num, sha12, short, date, merge, cat, ev, subj in rows:
    full = full_by_short.get(short)
    if not full:
        problems.append((num, short, "unresolvable")); continue
    row_shas.add(full)
    if full not in OLD_ONLY:
        problems.append((num, short, f"not OLD-ONLY (cat={cat})"))
print(f"\nrows resolving to real objects: {len(row_shas)+len([p for p in problems if p[2]=='unresolvable'])}/{len(rows)}")
print(f"rows not in OLD-ONLY or unresolvable: {len(problems)}")
for p in problems[:10]: print("   !!", p)
dup_count = len(rows) - len(row_shas)
print(f"duplicate SHAs across rows: {dup_count}")

missing_rows = OLD_ONLY - row_shas
print(f"\nOLD-ONLY commits NOT in the published table: {len(missing_rows)}")
for c in sorted(missing_rows):
    print(f"   {c[:8]}  {run('log','-1','--format=%ad %s','--date=short',c).strip()[:95]}")

# --- patch-id verification (bytes-safe) ---
def patch_id(c):
    p = subprocess.run(["git", "-C", R, "diff-tree", "-p", "--encoding=UTF-8", c],
                       capture_output=True)  # bytes
    if p.returncode != 0 or not p.stdout.strip(): return None
    q = subprocess.run(["git", "-C", R, "patch-id", "--stable"], input=p.stdout, capture_output=True)
    if not q.stdout.strip(): return None
    return q.stdout.decode("ascii", "replace").split()[0]

print("\ncomputing patch-ids for all OLD-ONLY commits (bytes-safe)…")
old_pid = {}
for i, c in enumerate(sorted(OLD_ONLY)):
    old_pid[c] = patch_id(c)
print("computing patch-ids for all SANITIZED-reachable commits…")
san_pid = {}
for c in sorted(S):
    san_pid[c] = patch_id(c)

pid_to_san = defaultdict(list)
for c, pid in san_pid.items():
    if pid: pid_to_san[pid].append(c)

matched = sum(1 for p in old_pid.values() if p and p in pid_to_san)
unmatched = [c for c, p in old_pid.items() if p and p not in pid_to_san]
no_pid = [c for c, p in old_pid.items() if p is None]
print(f"OLD-ONLY patch-id matches sanitized: {matched}")
print(f"OLD-ONLY patch-id unmatched: {len(unmatched)}")
print(f"OLD-ONLY no patch-id (root/empty): {len(no_pid)}")

# verify claimed twins on PATCH-EQUIVALENT rows
claim_bad = []; n_eq = 0
for num, sha12, short, date, merge, cat, ev, subj in rows:
    if cat.startswith("PATCH-EQUIVALENT"):
        n_eq += 1
        m = re.search(r"sanitized ([0-9a-f]{8})", ev)
        if not m: claim_bad.append((num, short, "no twin claim")); continue
        full = full_by_short.get(short); twin = full_by_short.get(m.group(1))
        if not full or not twin: claim_bad.append((num, short, "unresolvable twin")); continue
        op, sp = old_pid.get(full), san_pid.get(twin)
        if op is None or sp is None or op != sp:
            claim_bad.append((num, short, f"pid mismatch ({op} vs {sp})"))
print(f"\nPATCH-EQUIVALENT rows: {n_eq}; twin claims failing recomputation: {len(claim_bad)}")
for x in claim_bad[:15]: print("   !!", x)

# PATCH-DUPLICATE row
for num, sha12, short, date, merge, cat, ev, subj in rows:
    if cat.startswith("PATCH-DUPLICATE"):
        full = full_by_short.get(short)
        print(f"\nPATCH-DUPLICATE row #{num} {short}: pid={old_pid.get(full)}")
        twins = pid_to_san.get(old_pid.get(full), [])
        print(f"   sanitized twins: {[t[:8] for t in twins]}")

# are the 19 SHARED commits patch-identical to something too? (context info)
print("\nno-pid old-only commits (root or empty diff):")
for c in sorted(no_pid):
    npar = run("log", "-1", "--format=%P", c).strip().split()
    tree_same = ""
    if len(npar) == 1:
        t1 = run("log", "-1", "--format=%T", c).strip()
        t0 = run("log", "-1", "--format=%T", npar[0]).strip()
        tree_same = " [tree == parent: EMPTY commit]" if t1 == t0 else ""
    print(f"   {c[:8]} parents={len(npar)}{tree_same}")

json.dump({
    "row_count": len(rows), "cat_count": dict(cat_count),
    "old_only_not_in_table": sorted(missing_rows),
    "problems": problems,
    "patch_equiv_rows": n_eq, "patch_equiv_recompute_fail": claim_bad,
    "old_only_pid_matched": matched,
    "old_only_pid_unmatched": sorted(unmatched),
    "old_only_no_pid": sorted(no_pid),
    "old_pid": old_pid,
}, open("/home/z/my-project/scripts/m29cr1_table_verify.json", "w"))
print("\nsaved -> scripts/m29cr1_table_verify.json")
