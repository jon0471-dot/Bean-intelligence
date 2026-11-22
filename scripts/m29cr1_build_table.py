#!/usr/bin/env python3
"""M29-CR.1 — generate the corrected commit reconciliation table (500 rows).
Every commit reachable from any ref gets exactly one primary disposition.
Sources: m29cr1_sets.json (S/O/OLD_ONLY/shared), the verified 258-row published
table (row evidence reused — independently re-verified by m29cr1_verify_table.py),
M28-MIGRATION-MANIFEST.json migration_results (destination commits per group).
Outputs:
  download/M29CR1-COMMIT-RECONCILIATION-TABLE-500.md
  download/M29CR1-COMMIT-RECONCILIATION-TABLE-500.csv
Read-only against the repository.
"""
import subprocess, re, json, csv, datetime
from collections import defaultdict, OrderedDict

R = "/home/z/my-project"

def run(*a):
    return subprocess.run(["git", "-C", R, *a], capture_output=True, text=True, check=True).stdout

def patch_id(c):
    p = subprocess.run(["git", "-C", R, "diff-tree", "-p", c], capture_output=True)
    if p.returncode != 0 or not p.stdout.strip(): return None
    q = subprocess.run(["git", "-C", R, "patch-id", "--stable"], input=p.stdout, capture_output=True)
    return q.stdout.decode("ascii", "replace").split()[0] if q.stdout.strip() else None

sets = json.load(open(f"{R}/scripts/m29cr1_sets.json"))
S, O = set(sets["S"]), set(sets["O"])
SHARED = set(sets["overlap"])
OLD_ONLY = O - S
SAN_ONLY = S - O

# published rows (258) — verified by m29cr1_verify_table.py
text = open(f"{R}/download/M29-COMMIT-RECONCILIATION-TABLE.md").read()
pub = {}
for line in text.splitlines():
    if not line.startswith("| "): continue
    cells = [c.strip() for c in line.split("|")]
    if len(cells) < 9: continue
    num, sha12, short = cells[1], cells[2], cells[3]
    if not re.fullmatch(r"\d+", num or ""): continue
    pub[short.strip("`")] = {"cat": cells[6], "ev": cells[7], "subj": cells[8] if len(cells) > 8 else ""}

# manifest migration_results → destination commit per group
man = json.load(open(f"{R}/worktrees/m28-slm/docs/M28-MIGRATION-MANIFEST.json"))
dest = {g: v["destination_commit"] for g, v in man["migration_results"]["groups"].items()}

# resolve shorts to fulls
full_by_short = {l[:8]: l for l in run("rev-list", "--all").splitlines()}
def info(c):
    rec = run("log", "-1", "--format=%H|%P|%ad|%s", "--date=short", c).rstrip("\n")
    h, p, d, s = rec.split("|", 3)
    return h, p.split(), d, s

# patch-ids
print("computing patch-ids…")
pid_all = {}
for c in sorted(S | O):
    pid_all[c] = patch_id(c)

# ---- classification ----
buckets = OrderedDict([(k, []) for k in [
    "SAN-PUBLISHED", "SHARED-ROOT", "SAN-UNPUBLISHED", "OLD-MIGRATED",
    "OLD-PATCH-EQUIVALENT", "OLD-PATCH-DUPLICATE", "OLD-REPRESENTED",
    "OLD-SUPERSEDED", "OLD-WIP-SNAPSHOT", "OLD-MERGE", "OLD-EXCLUDED",
    "OLD-PRESERVATION-AUTO"]])

def map_old_cat(short):
    cat = pub[short]["cat"]
    if cat.startswith("MIGRATED"): return "OLD-MIGRATED"
    if cat.startswith("PATCH-EQUIVALENT"): return "OLD-PATCH-EQUIVALENT"
    if cat.startswith("PATCH-DUPLICATE"): return "OLD-PATCH-DUPLICATE"
    if cat.startswith("CONTENT REPRESENTED") or cat.startswith("REPRESENTED"): return "OLD-REPRESENTED"
    if cat.startswith("SUPERSEDED"): return "OLD-SUPERSEDED"
    if cat.startswith("WIP SNAPSHOT"): return "OLD-WIP-SNAPSHOT"
    if cat.startswith("STRUCTURAL MERGE"): return "OLD-MERGE"
    if cat.startswith("EXCLUDED"): return "OLD-EXCLUDED"
    raise ValueError(f"unmapped published category: {cat}")

# old-side (from verified published rows)
unclassified = []
for c in OLD_ONLY:
    short = c[:8]
    if short in pub:
        buckets[map_old_cat(short)].append(c)
    else:
        buckets["OLD-PRESERVATION-AUTO"].append(c)
        unclassified.append(c)

# sanitized-only: published on remote vs local-only
cat1 = set(run("rev-list", "origin/fix/laxii-image-output-ux",
               "origin/feat/m26-2-media-capabilities").split())
for c in SAN_ONLY:
    buckets["SAN-PUBLISHED" if c in cat1 else "SAN-UNPUBLISHED"].append(c)
for c in SHARED:
    buckets["SHARED-ROOT"].append(c)

totals = {k: len(v) for k, v in buckets.items()}
grand = sum(totals.values())
print("bucket totals:", json.dumps(totals, indent=1))
print("GRAND TOTAL:", grand)
assert grand == 500, f"expected 500, got {grand}"

# ---- row builders ----
def clean(s, n=88):
    s = s.replace("|", "/").strip()
    return s[: n - 1] + "…" if len(s) > n else s

rows = []  # (n, bucket, full_sha, short, date, parents_short, pid12, equivalent, evidence, subject)
n = 0
for bucket in buckets:
    for c in sorted(buckets[bucket], key=lambda x: info(x)[2]):
        n += 1
        full, parents, date, subj = info(c)
        short = full[:8]
        pshort = " ".join(p[:8] for p in parents)
        pid = pid_all[c]
        pid12 = pid[:12] if pid else "—"
        ev = ""
        if bucket == "SAN-PUBLISHED":
            equivalent = "—"
            ev = "already on GitHub (PR flow, sanitized lineage)"
        elif bucket == "SHARED-ROOT":
            equivalent = "—"
            ev = "pre-split shared root: same object in both lineages (ancestors of fork cafdb68)"
        elif bucket == "SAN-UNPUBLISHED":
            equivalent = "—"
            ev = "local-only; published by plan Step 2 (new branch push)"
        elif bucket == "OLD-MIGRATED":
            grp = re.search(r"G(\d+)", pub[short]["cat"]).group(0)
            equivalent = dest.get(grp, "—")[:8]
            ev = f"manifest {grp} member; content transplanted to {dest.get(grp,'—')[:8]}"
        elif bucket == "OLD-PATCH-EQUIVALENT":
            m = re.search(r"sanitized ([0-9a-f]{8})", pub[short]["ev"])
            twin = m.group(1) if m else "—"
            equivalent = twin
            ev = f"patch-id {pid12}… ≡ sanitized {twin} (recomputed, verified)"
        elif bucket == "OLD-PATCH-DUPLICATE":
            equivalent = "b1a21c2"
            ev = "patch-id ≡ old-side b1a21c2 (G2 member); content migrated once via G2"
        elif bucket == "OLD-REPRESENTED":
            equivalent = "in-tree"
            ev = clean(pub[short]["ev"], 130) or "content verified in sanitized tree (sweep)"
        elif bucket == "OLD-SUPERSEDED":
            equivalent = "superseded"
            ev = clean(pub[short]["ev"], 130)
        elif bucket == "OLD-WIP-SNAPSHOT":
            equivalent = "—"
            ev = clean(pub[short]["ev"], 110) or "WIP auto-snapshot; superseded/quarantined, no transplant"
        elif bucket == "OLD-MERGE":
            equivalent = "via parents"
            ev = "merge object; content carried by its parents (never transplanted)"
        elif bucket == "OLD-EXCLUDED":
            ev = "manifest G8/G9/G10 — owner-decision gated (D2/D3); excluded from publication tree"
            equivalent = "none (gated)"
        else:  # OLD-PRESERVATION-AUTO
            equivalent = "—"
            ev = "post-report archive-line preservation snapshot by workspace auto-committer (2026-11-22)"
        rows.append((n, bucket, full, short, date, pshort, pid12, equivalent, ev, clean(subj)))

# ---- markdown ----
LN = [
    "# M29-CR.1 — Corrected Commit Reconciliation Table (500 rows)",
    "",
    "Audit snapshot: 2026-11-22 · universe = every commit reachable from any of the 40 refs (`git rev-list --all` = **500**).",
    "Replaces the 258-row M29-CR table, which covered the old-side set only. Classification evidence re-verified independently this audit:",
    "",
    "- 157/157 PATCH-EQUIVALENT twin claims recomputed with `git patch-id --stable` — 0 failures;",
    "- 258/258 published rows resolve to real objects inside the old-only set; exactly 1 old-only commit was missing (`d477902`, created after the published table was generated);",
    "- 225/225 G1–G7 manifest paths present in the integration tree; 89 G8/G9/G10 paths intentionally absent; 0 runtime/credential artifacts in the tree;",
    "- sanitized vs old lineages share exactly the 19-commit pre-split root below fork point `cafdb68` (merge-base of both lines); no old-side commit is an ancestor of the integration tip.",
    "",
    "Machine-readable companion with FULL SHAs, parent SHAs and full patch-ids: `M29CR1-COMMIT-RECONCILIATION-TABLE-500.csv`.",
    "",
    "| Disposition | Rows | Meaning |",
    "|---|---|---|",
]
meanings = {
    "SAN-PUBLISHED": ("208", "sanitized-only commit already published on GitHub (remote sanitized branches)"),
    "SHARED-ROOT": ("19", "pre-split root commit, byte-identical object in both lineages"),
    "SAN-UNPUBLISHED": ("14", "sanitized-only commit present locally only; delivered by publication Step 2"),
    "OLD-MIGRATED": ("24", "old-side manifest G1–G7 member; content transplanted to a destination commit"),
    "OLD-PATCH-EQUIVALENT": ("157", "old-side commit whose patch-id equals a sanitized commit (re-created, distinct SHA)"),
    "OLD-PATCH-DUPLICATE": ("1", "old-side commit patch-identical to ANOTHER old-side commit; migrated once"),
    "OLD-REPRESENTED": ("12", "content tree-verified present on sanitized line; flagged sensitive artifacts excluded"),
    "OLD-SUPERSEDED": ("1", "content deliberately superseded by sanitized-line design (enforced by contract test)"),
    "OLD-WIP-SNAPSHOT": ("46", "below-milestone/cron WIP auto-snapshot; quarantined or superseded, no transplant"),
    "OLD-MERGE": ("5", "merge commit; content carried entirely by its parents"),
    "OLD-EXCLUDED": ("12", "manifest G8/G9/G10 member — owner-decision gated (D2/D3), excluded from publication"),
    "OLD-PRESERVATION-AUTO": ("1", "post-report archive-line preservation snapshot (workspace auto-committer)"),
}
for k in buckets:
    c, m = meanings[k]
    assert c == str(totals[k]), f"{k}: header says {c}, actual {totals[k]}"
    LN.append(f"| {k} | {totals[k]} | {m} |")
LN += [f"| **TOTAL** | **{grand}** | **equals `git rev-list --all` = 500 — 0 unaccounted** |", ""]

n = 0
for bucket in buckets:
    LN.append(f"## {bucket} — {totals[bucket]} commit(s)")
    LN.append("")
    LN.append("| # | SHA | short | date | parents | patch-id | equivalent / migration | evidence | subject |")
    LN.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        if r[1] == bucket:
            num, _, full, short, date, pshort, pid12, equivalent, ev, subj = r
            LN.append(f"| {num} | `{full}` | `{short}` | {date} | `{pshort}` | `{pid12}` | {equivalent} | {ev} | {subj} |")
    LN.append("")

open(f"{R}/download/M29CR1-COMMIT-RECONCILIATION-TABLE-500.md", "w").write("\n".join(LN) + "\n")

# ---- CSV (full precision) ----
with open(f"{R}/download/M29CR1-COMMIT-RECONCILIATION-TABLE-500.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["n", "disposition", "sha_full", "sha_short", "date", "parents_full",
                "patch_id_full", "equivalent_or_migration", "evidence", "subject"])
    for num, bucket, full, short, date, pshort, pid12, equivalent, ev, subj in rows:
        fulls = run("log", "-1", "--format=%P", full).strip()
        w.writerow([num, bucket, full, short, date, fulls,
                    pid_all[full] or "", equivalent, ev.replace("|", "/"), subj])

print(f"markdown rows total: {len(rows)}")
print("written: download/M29CR1-COMMIT-RECONCILIATION-TABLE-500.md + .csv")
