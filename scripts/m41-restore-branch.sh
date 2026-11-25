#!/bin/bash
# M41 full state restore: branch + stash overlay. Untracked files survive the
# environment's periodic HEAD resets; this re-lays the entire M41 working
# state from the stash, then verifies all seven mission modules exist.
set -e
cd /home/z/my-project
BRANCH=feat/m41-autonomous-multi-agent-intelligence
git fetch origin "$BRANCH" 2>/dev/null || true
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BRANCH" ]; then
  git checkout "$BRANCH" >/dev/null 2>&1 || {
    echo "CHECKOUT_CONFLICT" >&2
    exit 2
  }
fi
REMOTE_SHA=$(git rev-parse "origin/$BRANCH")
LOCAL_SHA=$(git rev-parse HEAD)
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ] && [ -z "$(git status --porcelain | grep -v '^??')" ]; then
  git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1 || git reset --hard "$REMOTE_SHA" >/dev/null
fi
git branch -f main origin/main 2>/dev/null || true
# Overlay the stashed M41 working tree (idempotent).
if [ -d .m41-stash ]; then
  cp .m41-stash/mission/*.ts src/lib/riishe/mission/
  cp .m41-stash/tests/riishe-mission-*.test.ts tests/unit/ 2>/dev/null || true
  [ -f .m41-stash/patched/products.ts ] && cp .m41-stash/patched/products.ts src/lib/registry/products.ts
  [ -f .m41-stash/patched/specialists.ts ] && cp .m41-stash/patched/specialists.ts src/lib/riishe/specialists.ts
  [ -f .m41-stash/patched/handlers.ts ] && cp .m41-stash/patched/handlers.ts src/lib/ai-engine/handlers.ts
  [ -f .m41-stash/patched/schema.prisma ] && cp .m41-stash/patched/schema.prisma prisma/schema.prisma
fi
MISSING=0
for f in types graph planner verifiers handoff store executor; do
  [ -f "src/lib/riishe/mission/$f.ts" ] || MISSING=1
done
[ "$MISSING" = "1" ] && { echo "MISSION_FILES_MISSING" >&2; exit 3; }
echo "restored: branch=$(git branch --show-current) head=$(git rev-parse --short HEAD) mission_files=7"
