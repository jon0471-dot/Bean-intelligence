#!/usr/bin/env bash
# M35 PR creation + merge + remote verification.
# Token is read from the git credential store into memory ONLY — never
# printed, never written to disk.
set -euo pipefail
cd /home/z/my-project

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -z "$TOKEN" ]; then echo "ERROR: no token from credential store" >&2; exit 1; fi

API=https://api.github.com/repos/jon0471-dot/Bean-intelligence

echo "=== 1. create PR (head=fix/shared-job-concurrency-slot-leak base=main) ==="
PR_JSON=$(curl -s -X POST "$API/pulls" \
  -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"title":"M35 — shared job concurrency diagnostic: streamed RIISHE turns leaked in-flight slots (root-cause fix + regression tests)","head":"fix/shared-job-concurrency-slot-leak","base":"main","body":"Root-caused the reported CONCURRENCY_LIMIT lockout (\"You already have the maximum number of concurrent jobs for this product.\"). The M26 G-4 SSE ownership handoff poisoned the shared release-once flag, so every streamed (?stream=1) RIISHE turn leaked one in-flight slot against bean-llm-hosted-primary (per-user cap 2) — the second streamed turn locked the account out until restart. Fix: dedicated sseHandoff flag; slotReleased is set exclusively by releaseOnce(). No limits, isolation, fairness, timeouts, receipts, APIs, UI or schema touched. 8 new regression tests (RED pre-fix 3/5 → GREEN 8/8); full suite 2555 pass / 0 fail on the current main tree; live verification: 6 sequential streamed turns all 200 (pre-fix turn 3 guaranteed 429), 4 concurrent turns → exactly 2×200 + 2×429 (cap still enforced), post-burst turn 200. Full detail: docs/M35-CONCURRENCY-DIAGNOSTIC-REPORT.md."}')
PR_NUM=$(printf '%s' "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('number') or '')
import sys" 2>/dev/null || true)
if [ -z "$PR_NUM" ]; then
  echo "PR create response (may already exist):" >&2
  printf '%s' "$PR_JSON" | head -c 400 >&2
  # try to find an existing open PR for this head
  PR_NUM=$(curl -s "$API/pulls?head=jon0471-dot:fix/shared-job-concurrency-slot-leak&state=open" \
    -H "Authorization: token $TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')")
fi
echo "PR number: $PR_NUM"
if [ -z "$PR_NUM" ]; then echo "ERROR: no PR number" >&2; exit 1; fi

echo "=== 2. merge PR (normal merge commit, no history rewrite) ==="
MERGE_JSON=$(curl -s -X PUT "$API/pulls/$PR_NUM/merge" \
  -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"merge_method":"merge"}')
printf '%s' "$MERGE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print('merged:', d.get('merged'), '| sha:', d.get('sha'), '| message:', d.get('message'))"

echo "=== 3. verify remote main ==="
sleep 3
git fetch origin main 2>&1 | tail -1
REMOTE_MAIN=$(git ls-remote origin refs/heads/main | cut -f1)
echo "remote main SHA: $REMOTE_MAIN"
git cat-file -e "$REMOTE_MAIN" 2>/dev/null && echo "commit reachable locally: yes"
MERGED=$(git merge-base --is-ancestor df000036abec94a7f00e8faa21a186e60debe54f "$REMOTE_MAIN" && echo yes || echo no)
echo "our commit $df000036abec94a7f00e8faa21a186e60debe54f is ancestor of remote main: $MERGED"
