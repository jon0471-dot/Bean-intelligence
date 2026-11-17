#!/usr/bin/env bash
# M26.1.1 PHASE 5b — content-level scans in the rewritten clone using the
# committed M26.1 tooling (refs adapted: origin/main -> main, origin/feat/* -> local).
set -euo pipefail

WORK=/home/z/my-project
CLONE=$WORK/recovery/bean-rewrite
SDIR="$CLONE/m2611-scans"

mkdir -p "$SDIR"
for f in secret-scan.ts db-census.ts; do
  sed -e "s|'origin/main'|'main'|g" -e "s|'origin/feat/laxii-jazmii-restoration'|'feat/laxii-jazmii-restoration'|g" \
      "$WORK/scripts/m261/$f" > "$SDIR/$f"
done
echo "scan scripts adapted into clone (untracked, disposable)"

cd "$CLONE"
echo "== A. secret-scan on the rewritten clone (tracked tree + untracked + full history of both rewritten refs) =="
bun run "$SDIR/secret-scan.ts" 2>&1 | tail -40

echo ""
echo "== B. direct SQLite census on the rewritten clone (expect distinct DB blobs: 0) =="
bun run "$SDIR/db-census.ts" 2>&1 | tail -12

rm -f /tmp/m261-census.db /tmp/m261-db-census.json
echo "PHASE 5b COMPLETE"
