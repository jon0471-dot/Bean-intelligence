#!/usr/bin/env python3
"""M30.1 — Final blocker-resolution & publication-readiness verification.

Read-only against refs (no push, no ref mutation; merge-tree dry-run writes
unreferenced objects only, per the established M29/M30 audit pattern).

Recomputes fresh, from live refs and objects:
  A. universe arithmetic (S / O / overlap) and the 505 -> 507 delta rows
  B. full disposition cross-tab (rows / on-GitHub / local-only) — no double counting
  C. the "six local-only patch-equivalent originals", identified concretely
  D. patch-id recompute for every OLD-PATCH-EQUIVALENT + OLD-PATCH-DUPLICATE row
  E. ancestry / fast-forward proofs for the three target branches
  F. LJ merge-in conflict surface (merge-tree dry run)
  G. manifest completeness (G1-G7 present, G8-G10 absent) at the live tip
  H. app-tree purity (tip vs verified d2c232a outside docs/ + audit scripts)
  I. deploy-automation surface (.github/workflows, vercel/netlify configs) in
     both the old-main tree and the sanitized tip tree

Evidence JSON -> /home/z/my-project/recovery/m30-1-audit/m301-verify.json
"""
import json, subprocess, os, sys, csv

R = "/home/z/my-project"
OUT = f"{R}/recovery/m30-1-audit"
os.makedirs(OUT, exist_ok=True)
E = {}

def run(*a, check=True):
    p = subprocess.run(["git", "-C", R, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {a} -> {p.returncode}: {p.stderr[:400]}")
    return p.stdout.strip()

def sha(ref):
    return run("rev-parse", ref)

# ---------- anchors ----------
TIP = sha("reconcile/sanitized-m27-m28-migration")      # expect a339544...
D2C = "d2c232a6fa225644e91e967d2148558ba67b9679"
E96 = "e96d83a5196f45712350aaf41d13a1e5dfcebae7"
M262 = "8f61599271b1aa66e86a2c4956f6dc01eef8b737"
M263 = "18c93ed7b1e433bb1c06c0a803d5adff0dcaf064"
LJ  = "e7d7003f36896b3ceaf07cde74d36275989469c1"
OLDMAIN = "91a68090ef72f71f52797bd88f9b83831fbeb997"
SNAP = "082e064c6e1244ad8b88971e99b65bd655c65044"      # M30 report snapshot
E["anchors"] = {"tip": TIP, "snapshot_082e064": SNAP, "old_main": OLDMAIN,
                "m262": M262, "fix": M263, "lj": LJ, "pr4_merge": E96}

# remote-tracking refs must equal live ls-remote (captured this session)
lsr = {}
for line in open("/tmp/m301-lsremote.txt"):
    if "\t" in line:
        s, r = line.strip().split("\t")
        lsr[r] = s
expect_remote = {
    "refs/heads/main": OLDMAIN, "refs/heads/feat/laxii-jazmii-restoration": LJ,
    "refs/heads/feat/m26-2-media-capabilities": M262, "refs/heads/fix/laxii-image-output-ux": M263}
local_track = {r: "origin" + r[len("refs/heads"):] for r in expect_remote}
E["remote_match"] = {r: lsr.get(r) == s for r, s in expect_remote.items()}
E["main_sanitized_absent_remote"] = "refs/heads/main-sanitized" not in lsr

# ---------- A. universe arithmetic ----------
# Ref classification EXACTLY as M29-CR.1 (scripts/m29cr1_set_arithmetic.py):
# a ref is sanitized-side iff SAN_BASELINE 4d134c57 is an ancestor of its tip.
SAN_BASELINE = "4d134c5794cfe92ff7c8e477f536075e7c8bffb0"
def is_desc(tip, anc):
    return subprocess.run(["git", "-C", R, "merge-base", "--is-ancestor", anc, tip]).returncode == 0
allrefs = set(run("rev-list", "--all").splitlines())
san_refs, old_refs = [], []
for r in run("for-each-ref", "--format=%(refname)").splitlines():
    (san_refs if is_desc(run("rev-parse", r), SAN_BASELINE) else old_refs).append(r)
S = set(run("rev-list", *san_refs).splitlines()) & allrefs
O = set(run("rev-list", *old_refs).splitlines()) & allrefs
overlap = S & O
E["A_universe"] = {
    "ref_definition": "sanitized-side iff 4d134c57 ancestor of tip (M29-CR.1 convention)",
    "san_refs_n": len(san_refs), "old_refs_n": len(old_refs),
    "rev_list_all": len(allrefs),
    "S": len(S), "O": len(O), "overlap": len(overlap),
    "S_plus_OminusS": len(S) + len(O - S),
    "identity_ok": len(allrefs) == len(S) + len(O - S),
    "tip_commit_count": int(run("rev-list", "--count", TIP)),
}

def csv_rows_source():
    out = set()
    with open(f"{R}/recovery/m29-audit/M29CR1-COMMIT-RECONCILIATION-TABLE-500.csv") as f:
        for row in csv.DictReader(f):
            out.add(row["sha_full"])
    return out

# delta rows since the M30 snapshot (505):
# recorded 505 = 500 CSV rows + docs 741156c/b87acb3/082e064 + archive 6b83697/4274b54
known_505 = csv_rows_source()
for short in ("741156c", "b87acb3", "6b83697", "4274b54"):
    known_505.add(run("rev-parse", short))
known_505.add(SNAP)
new_since_snap = [c for c in allrefs if c not in known_505]
E["A_delta"] = []
for c in sorted(new_since_snap):
    rec = run("log", "-1", "--format=%H|%P|%ad|%s", "--date=format:%Y-%m-%d %H:%M", c)
    h, p, d, s = rec.split("|", 3)
    side = "SAN (docs commit on sanitized line)" if c in S else "OLD (archive auto-snapshot)"
    E["A_delta"].append({"sha": h, "date": d, "side": side, "subject": s[:110]})

# ---------- B. cross-tab from the 500-row CSV + delta ----------
csv_rows = {}
with open(f"{R}/recovery/m29-audit/M29CR1-COMMIT-RECONCILIATION-TABLE-500.csv") as f:
    for row in csv.DictReader(f):
        csv_rows[row["sha_full"]] = row
remote_reachable = set()
for r in local_track.values():
    remote_reachable |= set(run("rev-list", r).splitlines())
remote_reachable.add(OLDMAIN)

buckets = {}
def add(c, bucket):
    b = buckets.setdefault(bucket, {"rows": 0, "on_github": 0, "local_only": 0, "shas": []})
    b["rows"] += 1
    b["shas"].append(c)
    if c in remote_reachable: b["on_github"] += 1
    else: b["local_only"] += 1

for c, row in csv_rows.items():
    add(c, row["disposition"])
for c in new_since_snap:
    if c in S: add(c, "SAN-UNPUBLISHED")
    else: add(c, "OLD-PRESERVATION-AUTO")
E["B_crosstab"] = {k: {kk: vv for kk, vv in v.items() if kk != "shas"} for k, v in buckets.items()}
tot = sum(v["rows"] for v in buckets.values())
totgh = sum(v["on_github"] for v in buckets.values())
totlo = sum(v["local_only"] for v in buckets.values())
E["B_totals"] = {"rows": tot, "on_github": totgh, "local_only": totlo,
                 "universe_match": tot == len(allrefs),
                 "github_match": totgh == len(remote_reachable & allrefs)}

# ---------- C. the six local-only patch-equivalent originals ----------
pe = buckets["OLD-PATCH-EQUIVALENT"]["shas"]
pe_local = [c for c in pe if c not in remote_reachable]
E["C_six_local_only"] = []
for c in sorted(pe_local):
    row = csv_rows[c]
    rec = run("log", "-1", "--format=%H|%ad|%s", "--date=short", c).split("|", 2)
    E["C_six_local_only"].append({
        "sha": c, "date": rec[1], "subject": rec[2][:100],
        "patch_id": row["patch_id_full"][:16], "sanitized_twin": row["equivalent_or_migration"]})
E["C_counts"] = {"patch_equivalent_total": len(pe),
                 "patch_equivalent_on_github": len(pe) - len(pe_local),
                 "patch_equivalent_local_only": len(pe_local),
                 "patch_duplicate": len(buckets["OLD-PATCH-DUPLICATE"]["shas"]),
                 "wider_ledger_158": len(pe) + len(buckets["OLD-PATCH-DUPLICATE"]["shas"])}

# ---------- D. patch-id recompute for all 158 ----------
def patch_id(c):
    p = subprocess.run(["git", "-C", R, "diff-tree", "-p", c], capture_output=True)
    if p.returncode != 0 or not p.stdout.strip(): return None
    q = subprocess.run(["git", "-C", R, "patch-id", "--stable"], input=p.stdout, capture_output=True)
    return q.stdout.decode("ascii", "replace").split()[0] if q.stdout.strip() else None

fails, ok = [], 0
for c in pe + buckets["OLD-PATCH-DUPLICATE"]["shas"]:
    row = csv_rows[c]
    want = row["patch_id_full"]
    got = patch_id(c)
    if got == want: ok += 1
    else: fails.append({"sha": c, "want": want, "got": got})
E["D_patchid"] = {"checked": ok + len(fails), "ok": ok, "failures": fails}

# ---------- E. ancestry / FF proofs ----------
def is_ancestor(a, b): return run("merge-base", "--is-ancestor", a, b, check=False) == "" and \
    subprocess.run(["git", "-C", R, "merge-base", "--is-ancestor", a, b]).returncode == 0
p1 = run("rev-parse", E96 + "^1")
lr_m262 = run("rev-list", "--left-right", "--count", f"{TIP}...{M262}").split()
lr_fix = run("rev-list", "--left-right", "--count", f"{TIP}...{M263}").split()
mb = run("merge-base", TIP, OLDMAIN)
E["E_proofs"] = {
    "FF_step1_parent1_of_e96d83a": p1,
    "FF_step1_is_18c93ed": p1 == M263,
    "e96d83a_ancestor_of_tip": is_ancestor(E96, TIP),
    "m262_ancestor_of_tip": is_ancestor(M262, TIP),
    "fix_ancestor_of_tip": is_ancestor(M263, TIP),
    "lj_ancestor_of_tip": is_ancestor(LJ, TIP),          # expect False
    "oldmain_ancestor_of_tip": is_ancestor(OLDMAIN, TIP),  # expect False
    "tip_vs_m262_left_right": {"tip_only": int(lr_m262[0]), "m262_only": int(lr_m262[1])},
    "tip_vs_fix_left_right": {"tip_only": int(lr_fix[0]), "fix_only": int(lr_fix[1])},
    "merge_base_tip_oldmain": mb,
    "merge_base_is_cafdb682": mb == "cafdb6826da9c4edcd62e2ead15d801869ae9c3a",
    "lj_tree_vs_oldmain_diff_empty": run("diff", OLDMAIN, LJ, check=False) == "",
    "lj_unique_nonmerge_commits_vs_oldmain": int(run("rev-list", "--count", "--no-merges", LJ, "^" + OLDMAIN)),
    "lj_unique_objects_vs_oldmain": int(run("rev-list", "--count", LJ, "^" + OLDMAIN)),
}
canon_diff = run("diff", D2C, TIP, "--", ".", ":(exclude)docs", ":(exclude)scripts", check=False)
E["E_proofs"]["app_tree_purity_diff_empty"] = canon_diff == ""

# ---------- F. LJ merge-in conflict surface ----------
mt = subprocess.run(["git", "-C", R, "merge-tree", "--write-tree", "--name-only", LJ, TIP],
                    capture_output=True, text=True)
conf = [l for l in mt.stdout.splitlines()[1:] if l.strip()]
E["F_lj_merge_in"] = {"conflicted_paths": len(conf), "sample": conf[:12]}

# ---------- G. manifest sweep at live tip ----------
man = json.loads(run("show", f"{TIP}:docs/M28-MIGRATION-MANIFEST.json"))
tree_files = set(run("ls-tree", "-r", "--name-only", TIP).splitlines())
mig_ids = set(man["migration_results"]["groups"].keys())            # G1..G7
g_paths, x_paths = set(), set()
for g in man["groups"]:                                             # G1..G10
    for m in g.get("members", []):
        for path in m.get("file_paths", []):
            (g_paths if g["id"] in mig_ids else x_paths).add(path)
g_ok = sum(1 for p in g_paths if p in tree_files)
g_miss = sorted(p for p in g_paths if p not in tree_files)
x_ok = sum(1 for p in x_paths if p not in tree_files)
E["G_manifest"] = {"g1_g7_paths": len(g_paths), "g1_g7_present": g_ok, "g1_g7_missing": g_miss,
                   "g8_g10_paths": len(x_paths), "g8_g10_intentionally_absent": x_ok,
                   "unexpectedly_present": sorted(p for p in x_paths if p in tree_files)}

# ---------- I. deploy-automation surface in both trees ----------
def scan_tree(commit):
    files = set(run("ls-tree", "-r", "--name-only", commit).splitlines())
    hits = {}
    pats = [".github/workflows/", "vercel.json", "netlify.toml", ".vercel/",
            "Dockerfile", "docker-compose", "ecosystem.config", "render.yaml",
            "fly.toml", ".gitlab-ci", "Jenkinsfile", "app.yml"]
    for p in pats:
        hits[p] = sorted(f for f in files if p in f)
    return hits
E["I_deploy_surface"] = {"old_main_91a6809": scan_tree(OLDMAIN), "tip": scan_tree(TIP)}

json.dump(E, open(f"{OUT}/m301-verify.json", "w"), indent=1)
print(json.dumps({k: v for k, v in E.items()
                  if k in ("remote_match", "main_sanitized_absent_remote", "A_universe",
                           "B_totals", "C_counts", "D_patchid", "E_proofs", "F_lj_merge_in",
                           "G_manifest")}, indent=1, default=str)[:6000])
print("\nA_delta:", json.dumps(E["A_delta"], indent=1))
print("\nB_crosstab:")
for k, v in E["B_crosstab"].items():
    print(f"  {k:26s} rows={v['rows']:4d} on_github={v['on_github']:4d} local_only={v['local_only']:4d}")
print(" ", json.dumps(E["B_totals"]))
print("\nC_six:", json.dumps(E["C_six_local_only"], indent=1))
print("\nI_deploy (non-empty hits):")
for t, hits in E["I_deploy_surface"].items():
    for p, v in hits.items():
        if v: print(" ", t, p, len(v), v[:4])
