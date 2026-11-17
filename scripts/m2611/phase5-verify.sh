#!/usr/bin/env bash
# M26.1.1 PHASE 5a — structural verification of the rewritten clone.
set -euo pipefail

WORK=/home/z/my-project
CLONE=$WORK/recovery/bean-rewrite
MAIN_NEW=$(git -C "$CLONE" rev-parse main)
FEAT_NEW=$(git -C "$CLONE" rev-parse feat/laxii-jazmii-restoration)
MAIN_OLD=a01486289149e0347b41d111c376b8a2b078ad80
FEAT_OLD=6a84481c6ebc893ccb97e97ac5a353937194eac3

echo "rewritten tips: main=$MAIN_NEW feat=$FEAT_NEW"

echo "== 1. sensitive-path census across ALL rewritten refs (expect 0) =="
N=$(git -C "$CLONE" rev-list --objects main feat/laxii-jazmii-restoration | awk 'NF>1{print substr($0, length($1)+2)}' | sort -u | grep -cE '(cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|cg-ck2|pipeline-ck|pipeline-ck2|uc1|uc2)\.txt)' || true)
echo "sensitive paths reachable from rewritten refs: $N (expect 0)"

echo "== 2. the 8 published DB blob SHAs absent from the clone object store =="
for b in bc1aafa17481c1b61914ffb5d4b9cc977c1c173d e0814f6b3fbf121cf9f4d9058128a67699b32b76 8fa3cf94a13bbd7518f31f3ca3e9b80fafbcbde6 a9a211ccf573f590a26ef8733821658419a25808 3229edc84e2059424d5af1db92a51c8509b11d25 e870f7d852e21f5c114cef80875bfd63585c93d5 fc74c1994082f73c1fdb8e656e2b2c1f2573f9e6 5530bf3a8f42914773590a850820096e7a175bce; do
  if git -C "$CLONE" cat-file -e "$b" 2>/dev/null; then echo "  STILL PRESENT: $b"; else echo "  absent: $b"; fi
done

echo "== 3. quarantined-WIP objects absent from the clone =="
for o in f0b47ad 477a160; do
  if git -C "$CLONE" cat-file -e "$o" 2>/dev/null; then echo "  STILL PRESENT: $o"; else echo "  absent: $o"; fi
done
N2=$(git -C "$CLONE" rev-list --objects main feat/laxii-jazmii-restoration | awk 'NF>1{print substr($0, length($1)+2)}' | sort -u | grep -cE '^(workers/wan22/|db/backups/)' || true)
echo "WIP-only paths (workers/wan22, db/backups) in rewritten history: $N2 (expect 0)"
if git -C "$CLONE" rev-list --objects main feat/laxii-jazmii-restoration | awk 'NF>1{print substr($0, length($1)+2)}' | sort -u | grep -q '^scripts/.github_device_code$'; then echo "  device code path PRESENT (unexpected)"; else echo "  device code path absent: OK"; fi

echo "== 4. tip-tree comparison old vs new (expect ONLY sensitive-path removals) =="
git -C "$WORK" ls-tree -r --name-only "$MAIN_OLD" | sort > /tmp/tree-old-main.txt
git -C "$CLONE" ls-tree -r --name-only main | sort > /tmp/tree-new-main.txt
echo "--- [main] removed going old->new (expect exactly the 3 login.json) ---"
comm -23 /tmp/tree-old-main.txt /tmp/tree-new-main.txt
echo "--- [main] added going old->new (expect none) ---"
comm -13 /tmp/tree-old-main.txt /tmp/tree-new-main.txt || true
git -C "$WORK" ls-tree -r --name-only "$FEAT_OLD" | sort > /tmp/tree-old-feat.txt
git -C "$CLONE" ls-tree -r --name-only feat/laxii-jazmii-restoration | sort > /tmp/tree-new-feat.txt
echo "--- [feat] removed count: $(comm -23 /tmp/tree-old-feat.txt /tmp/tree-new-feat.txt | wc -l) ---"
comm -23 /tmp/tree-old-feat.txt /tmp/tree-new-feat.txt
echo "--- [feat] added going old->new (expect none) ---"
comm -13 /tmp/tree-old-feat.txt /tmp/tree-new-feat.txt || true
echo "--- [main] tracked-file counts: old=$(wc -l < /tmp/tree-old-main.txt) new=$(wc -l < /tmp/tree-new-main.txt) ---"

echo "== 5. milestone anchors present in rewritten history (messages preserved) =="
git -C "$CLONE" log --oneline main | grep -cE "M22|M23|M24|M25|M26" || true
for pat in "docs(m26.1): owner-action checklist" "fix(m26.1): remove 7 residual session-token files" "docs(m26): results report" "docs(m25): results report" "feat(m25): intel lanes"; do
  if git -C "$CLONE" log --format='%s' main | grep -qF "$pat"; then echo "  preserved: $pat"; else echo "  MISSING: $pat"; fi
done

echo "== 6. clone is clean of old refs (remote removed by filter-repo) =="
git -C "$CLONE" remote -v || true
git -C "$CLONE" for-each-ref --format='%(refname)'

echo "== 7. working repository untouched (no backup refs harmed, HEAD unchanged) =="
echo "working HEAD: $(git -C "$WORK" rev-parse HEAD) (expect $MAIN_OLD)"
git -C "$WORK" for-each-ref --format='%(refname)' | grep -c '^refs/heads/backup/' | xargs echo "backup refs in working repo:"
echo "PHASE 5a COMPLETE"
