#!/usr/bin/env bash
# M26.1.1 PHASE 4 — git-filter-repo rewrite of the disposable clone ONLY.
# Removes the verified 42-path list (40 explicit paths + 2 snapshot paths)
# from BOTH authorized branches. The original working repository is untouched.
set -euo pipefail

CLONE=/home/z/my-project/recovery/bean-rewrite
MAPDIR="$CLONE/.git/filter-repo"

cd "$CLONE"

echo "== 0. pre-rewrite ref state =="
git for-each-ref --format='%(refname) %(objectname)'
echo "commit count main: $(git rev-list --count main)"
echo "commit count feat: $(git rev-list --count feat/laxii-jazmii-restoration)"

echo "== 1. filter-repo: invert-paths over the verified list (OWNER_ACTIONS §7.2, verbatim) =="
git filter-repo --invert-paths --force \
  --path scripts/citations-cookies.txt \
  --path scripts/e2e-30q-out/cookies.txt \
  --path scripts/e2e-cit-cookies.txt \
  --path scripts/e2e-clean-cookies.txt \
  --path scripts/e2e-cookies.txt \
  --path scripts/e2e-evalfix-out/cookies.txt \
  --path scripts/e2e-gangzii-cookies.txt \
  --path scripts/e2e-out/cookies.txt \
  --path scripts/e2e-out/fresh-chat-cookies.txt \
  --path scripts/e2e-quality-cookies.txt \
  --path scripts/e2e-riishe-upgrade-cookies.txt \
  --path scripts/e2e-verify-out/cookies.txt \
  --path scripts/e2e-verify-out/cookies2.txt \
  --path scripts/final-rq-cookies.txt \
  --path scripts/final-rq-cookies2.txt \
  --path scripts/flagship-cookies.txt \
  --path scripts/giftz-chat-cookies.txt \
  --path scripts/gingee-cookies.txt \
  --path scripts/golive-out/jazmii-verify-cookies.txt \
  --path scripts/golive-out/jazmii-verify-cookies2.txt \
  --path scripts/incident-cookies.txt \
  --path scripts/perf-cookies-baseline.txt \
  --path scripts/perf-cookies-post.txt \
  --path scripts/phase5-ui-out/cookies.txt \
  --path scripts/retrieval-cookies.txt \
  --path scripts/rework-cookies.txt \
  --path scripts/rework-cookies2.txt \
  --path scripts/rq-fix-cookies.txt \
  --path scripts/sanity-cookies.txt \
  --path scripts/stream-fix-cookies.txt \
  --path scripts/e2e-out/c2.txt \
  --path scripts/e2e-out/cg-ck.txt \
  --path scripts/e2e-out/cg-ck2.txt \
  --path scripts/e2e-out/pipeline-ck.txt \
  --path scripts/e2e-out/pipeline-ck2.txt \
  --path scripts/e2e-out/uc1.txt \
  --path scripts/e2e-out/uc2.txt \
  --path scripts/e2e-verify-out/login.json \
  --path scripts/e2e-30q-out/login.json \
  --path scripts/e2e-evalfix-out/login.json \
  --path-glob 'scripts/e2e-verify-out/verify.db' \
  --path-glob 'scripts/giftz-verify-out/verify.db'

echo "== 2. post-rewrite ref state =="
git for-each-ref --format='%(refname) %(objectname)'
echo "commit count main: $(git rev-list --count main)"
echo "commit count feat: $(git rev-list --count feat/laxii-jazmii-restoration)"
echo "--- ancestry check ---"
git merge-base --is-ancestor feat/laxii-jazmii-restoration main && echo "feat still ancestor of main: yes" || echo "ANCESTRY CHANGED (unexpected)"

echo "== 3. commit-map / ref-map captured =="
ls -la .git/filter-repo/ | awk '{print $NF}' | tail -n +2
echo "--- ref-map ---"
cat "$MAPDIR/ref-map" 2>/dev/null || echo "(no ref-map)"
echo "--- commit-map: anchor SHAs old -> new ---"
for a in 6a84481c6ebc893ccb97e97ac5a353937194eac3 3f40e75 ea73545 b0b03da 8cb93a9 76e63af 601c90d 6e4255c a01486289149e0347b41d111c376b8a2b078ad80; do
  line=$(grep "^$a" "$MAPDIR/commit-map" 2>/dev/null || echo "$a PRUNED-OR-ABSENT")
  echo "$line"
done
echo "--- pruned (empty) commit count ---"
grep -c ' ' "$MAPDIR/commit-map" || true
NEW=$(awk '{print $2}' "$MAPDIR/commit-map" | grep -v '^$' | sort -u | wc -l)
OLD=$(awk '{print $1}' "$MAPDIR/commit-map" | grep -v '^$' | sort -u | wc -l)
echo "commit-map rows: old=$OLD new=$NEW (delta = pruned-empty commits: $((OLD - NEW)))"

echo "== 4. first-pass reachability check (fast reject) =="
echo "--- sensitive-path objects reachable from rewritten refs (expect none) ---"
git rev-list --objects --all | grep -E '(cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt)' || echo "NONE — clean"

echo "== 5. old objects really gone from the clone? =="
for old in a01486289149e0347b41d111c376b8a2b078ad80 6a84481c6ebc893ccb97e97ac5a353937194eac3 76e63af; do
  if git cat-file -e "$old" 2>/dev/null; then echo "old object STILL PRESENT in clone: $old"; else echo "old object absent from clone: $old (rewritten)"; fi
done

echo "== 6. rewritten tip trees vs pre-rewrite tip trees (expect ONLY the 42-path removals) =="
echo "--- main tip: sensitive paths remaining (expect none) ---"
git ls-tree -r --name-only main | grep -E '(cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt)' || echo "NONE — main tip tree clean"
echo "--- feat tip: sensitive paths remaining (expect none) ---"
git ls-tree -r --name-only feat/laxii-jazmii-restoration | grep -E '(cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt)' || echo "NONE — feat tip tree clean"

echo "== 7. milestone commit messages preserved (spot check) =="
git log --oneline main | grep -E "chore\(m26\.1\)|docs\(m26\)|feat\(m25\)|docs\(m25\)|feat\(bean\): restore LAXII" | head -8

echo "PHASE 4 COMPLETE"
