#!/usr/bin/env bash
# M26.1.1 PHASE 5c — release gates on the rewritten tip (inside the clone).
set -uo pipefail

cd /home/z/my-project/recovery/bean-rewrite

echo "== 1. bun install =="
bun install 2>&1 | tail -3

echo "== 2. prisma client generate (build prerequisite) =="
bunx prisma generate 2>&1 | tail -2

echo "== 3. bun run test (full canonical suite) =="
bun run test 2>&1 | tail -6

echo "== 4. tsc --noEmit (scoped src/ + tests/) =="
bunx tsc --noEmit src tests 2>&1 | tail -6
echo "tsc exit code: $?"

echo "== 5. eslint src tests =="
bunx eslint src tests 2>&1 | tail -4
echo "eslint exit code: $?"

echo "== 6. bun run build (production build) =="
bun run build 2>&1 | tail -8
echo "build exit code: $?"

echo "PHASE 5c COMPLETE"
