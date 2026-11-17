#!/usr/bin/env bash
# M26.1.1 PHASE 2 — Preserve recovery material BEFORE any history rewrite.
# Read-only against the original working repository (no gc/prune/clean here).
set -euo pipefail

WORK=/home/z/my-project
RECOVERY="$WORK/recovery"
CLONE="$RECOVERY/bean-rewrite"
MAIN_PRE="a01486289149e0347b41d111c376b8a2b078ad80"
FEAT_PRE="6a84481c6ebc893ccb97e97ac5a353937194eac3"
ORIGIN_URL="https://github.com/jon0471-dot/Bean-intelligence.git"

echo "== 0. recovery dir + local-only exclude (never committed) =="
mkdir -p "$RECOVERY/wip-refs"
grep -qx 'recovery/' "$WORK/.git/info/exclude" 2>/dev/null || echo 'recovery/' >> "$WORK/.git/info/exclude"
tail -1 "$WORK/.git/info/exclude"

echo "== 1. fresh clone dedicated to history sanitization (from origin URL) =="
if [ ! -d "$CLONE" ]; then
  git clone "$ORIGIN_URL" "$CLONE"
fi

echo "== 2. clone SHA assertions (clone must equal published remote state) =="
C_MAIN=$(git -C "$CLONE" rev-parse refs/remotes/origin/main)
C_FEAT=$(git -C "$CLONE" rev-parse refs/remotes/origin/feat/laxii-jazmii-restoration)
echo "clone origin/main: $C_MAIN"
echo "clone origin/feat: $C_FEAT"
[ "$C_MAIN" = "$MAIN_PRE" ] || { echo "FATAL: clone main != expected pre-rewrite SHA"; exit 1; }
[ "$C_FEAT" = "$FEAT_PRE" ] || { echo "FATAL: clone feat != expected pre-rewrite SHA"; exit 1; }
git -C "$CLONE" branch feat/laxii-jazmii-restoration refs/remotes/origin/feat/laxii-jazmii-restoration
echo "local branches in clone:"; git -C "$CLONE" branch -v

echo "== 3. pre-rewrite bundle OUTSIDE the clone (both authorized refs + HEAD) =="
BUNDLE="$RECOVERY/bean-pre-rewrite-m2611.bundle"
git -C "$CLONE" bundle create "$BUNDLE" \
  refs/heads/main refs/heads/feat/laxii-jazmii-restoration HEAD

echo "== 4. bundle verification =="
git bundle verify "$BUNDLE" 2>&1
B_SHA=$(sha256sum "$BUNDLE" | awk '{print $1}')
B_SIZE=$(stat -c%s "$BUNDLE")
echo "bundle path: $BUNDLE"
echo "bundle size: $B_SIZE bytes"
echo "bundle sha256: $B_SHA"

echo "== 5. independent verification: clone FROM the bundle and assert SHAs =="
VDIR="$RECOVERY/verify-from-bundle"
rm -rf "$VDIR"
git clone -q "$BUNDLE" "$VDIR"
git -C "$VDIR" cat-file -e "$MAIN_PRE" && echo "bundle contains pre-rewrite main $MAIN_PRE: OK"
git -C "$VDIR" cat-file -e "$FEAT_PRE" && echo "bundle contains pre-rewrite feat $FEAT_PRE: OK"
rm -rf "$VDIR"
echo "(throwaway verification clone removed — derived copy, not recovery material)"

echo "== 6. preserve ALL local-only backup refs as separate bundles (read-only vs working repo) =="
REFS=(
  backup/laxii-pre-restoration
  backup/m22-wip-auto-commit
  backup/m25-intel-wip-auto-commit
  backup/m25-wip-auto-commit
  backup/m26-baseline-auto-commit
  backup/m26-f0b47ad-line
  backup/m261-local-main-pre-sync
  backup/pre-phase0-81caaa3
  backup/pre-phase1-auto-commit
)
for r in "${REFS[@]}"; do
  safe=$(echo "$r" | tr '/' '_')
  b="$RECOVERY/wip-refs/${safe}.bundle"
  git -C "$WORK" bundle create "$b" "$r"
  git bundle verify "$b" >/dev/null 2>&1 && echo "verified: $b"
  echo "  sha256: $(sha256sum "$b" | awk '{print $1}')"
done
# scratch ref (refs/backup namespace)
b="$RECOVERY/wip-refs/refs_backup_scratch-bf47b8c.bundle"
git -C "$WORK" bundle create "$b" refs/backup/scratch-bf47b8c
git bundle verify "$b" >/dev/null 2>&1 && echo "verified: $b"
echo "  sha256: $(sha256sum "$b" | awk '{print $1}')"

echo "== 7. encrypted copy of the pre-rewrite bundle (for owner off-machine storage) =="
PASSFILE="$RECOVERY/bean-pre-rewrite-m2611.passphrase"
ENC="$RECOVERY/bean-pre-rewrite-m2611.bundle.enc"
if [ ! -f "$PASSFILE" ]; then
  openssl rand -base64 32 > "$PASSFILE"
fi
chmod 600 "$PASSFILE"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$BUNDLE" -out "$ENC" -pass file:"$PASSFILE"
# round-trip check: decrypted copy must hash identical to the original bundle
DEC="$RECOVERY/.roundtrip-check.bundle"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC" -out "$DEC" -pass file:"$PASSFILE"
D_SHA=$(sha256sum "$DEC" | awk '{print $1}')
rm -f "$DEC"
if [ "$D_SHA" = "$B_SHA" ]; then echo "encryption round-trip: OK ($D_SHA)"; else echo "FATAL: round-trip mismatch"; exit 1; fi
echo "encrypted copy: $ENC"
echo "passphrase file (chmod 600): $PASSFILE — MUST move BOTH off-machine together"

echo "== 8. quarantined-WIP inventory verification (counts and markers only) =="
QREF=backup/m26-baseline-auto-commit
ADDED=$(git -C "$WORK" diff --name-status 76e63af "$QREF" | grep -c '^A' || true)
DELETED=$(git -C "$WORK" diff --name-status 76e63af "$QREF" | grep -c '^D' || true)
MODIFIED=$(git -C "$WORK" diff --name-status 76e63af "$QREF" | grep -c '^M' || true)
echo "backup/m26-baseline-auto-commit vs fix tip 76e63af -> added: $ADDED, deleted: $DELETED, modified: $MODIFIED (expect added=160)"
for f in scripts/e2e-out/c2.txt scripts/e2e-out/uc2.txt db/backups/m22-20261116T011634Z/custom.db db/backups/m22-20261116T011634Z/env.snapshot.txt scripts/.github_device_code workers/wan22/config.json; do
  if git -C "$WORK" cat-file -e "$QREF:$f" 2>/dev/null; then echo "  preserved on $QREF: $f"; else echo "  (not on this ref): $f"; fi
done
INV_ROWS=$(grep -c '^| `' "$WORK/docs/M26_1_QUARANTINE_INVENTORY.md" || true)
echo "quarantine inventory table rows in committed doc: $INV_ROWS (expect >= 160)"

echo "== 9. final listing (names + hashes only) =="
ls -la "$RECOVERY" | sed -n '1,40p'
echo "PHASE 2 COMPLETE"
