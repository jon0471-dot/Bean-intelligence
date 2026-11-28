#!/usr/bin/env bash
# M50.3 PR creation (head=feat/m50-3-ai-studio-persistence-apis base=main). NOT merged.
# Token read from the git credential store into memory ONLY — never printed.
set -euo pipefail
cd /home/z/my-project/m50-3-ai-studio-persistence-wt
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -z "$TOKEN" ]; then echo "ERROR: no token from credential store" >&2; exit 1; fi
API=https://api.github.com/repos/jon0471-dot/Bean-intelligence
cat > /tmp/m503-pr-body.md << 'BODYEOF'
## M50.3 — BEAN AI STUDIO: Workflow Persistence, Version Control & Owner-Scoped APIs

**Baseline (freshly verified):** `main` = `979704a` (the owner's PR #50 merge of M50.2; M50.2 implementation commit `644be6d` + merge confirmed ancestors before any edit). **This PR is NOT merged — the owner retains all merge authority.**

### M50.2 corrective fixes (additive, mandatory first)

1. **Diagnostics survive successful compilation** — `CompiledWorkflowPlan` now carries bounded deterministic `diagnostics` (warnings + info from validation); pinned with graphs that ACTUALLY USE a `not-configured` / `unavailable` / `degraded` / `rate-limited` / `blocked` surface. Warnings never become errors.
2. **`blocked` availability state** — the measured state from BEAN's real capability-health vocabulary (`src/lib/registry/status.ts`) joined `StudioAvailabilityState` as a customer-safe non-blocking WARNING. All 121 M50.2 cases re-run green; schema v1, ports, task mappings, QUALITY gate, M41 contracts, determinism unchanged.

### Delivered (NO canvas UI, NO workflow execution — nothing that creates missions/jobs/Trust tasks)

- **Additive Prisma models** (`WorkflowDefinition` / `WorkflowVersion` / `WorkflowRun`) + one CREATE-only migration (`20261128_m50_3_ai_studio_workflows_additive`) verified byte-identical to Prisma's schema-derived SQL; applied to an isolated M49.2-shaped replica (all pre-existing rows preserved) and a fresh DB (FK orphans refused, uniqueness fired, account cascade verified). Production DB never touched. `WorkflowRun` has ZERO rows (M50.5 creates them).
- **Owner-scoped workflow service** (`src/lib/ai-studio/workflow-service.ts`): create + draft v1, bounded rename/describe/archive/restore, guarded delete (409 + archiving offer once run history exists), duplicate graph-without-history, monotonic versions (max+1 in-transaction, `(definitionId, version)` UNIQUE race backstop → 409), one-draft policy, draft-only edits with byte-level published/superseded immutability, validation-gated publish with ATOMIC supersede.
- **12 contracted API routes + the conventions-required single-version GET** under `/api/ai-studio/workflows/**`; honest 401/404 (no existence leak)/409/413/422/429 mapping preserved (incl. truthful Retry-After).
- **Strictly read-only validate/preview**: parse/validate/compile the SAVED graph through the M50.2 pure core; zero-write pinned by before/after row censuses over workflow rows + AgentMission + AgentMissionTask + GenerationJob + TrustTask; the browser can NEVER submit a trusted availability claim (pinned).
- **Quota 50/owner** (provisional, owner-confirmable; archived counted; `QUOTA_EXCEEDED` 429). **Retention deliberately NOT implemented** — no 90-day TTL, no cleanup jobs; pending owner confirmation.
- **Server-side availability mapping** (`availability.ts`) from the REAL health payload shape (`blocked` preserved; absence stays silence; no new probe system, no env reads).

### Verification

78 new hermetic tests (corrective 15 / service 29 / routes 22 / availability 7 / real-SQL migration 5). Full per-file memory-safe census: 265 files, **3,674 pass / 1 fail / 10 skip** — the single failure (`riishe-text-tokenizer`, missing downloaded model artifact in this environment) reproduced identically against pristine `979704a` in a second worktree (pre-existing environmental; zero delta). M41 + M49 regression batches green. TypeScript clean, ESLint clean, production build exit 0 with all eight route files compiled.

### Documentation

`docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md` §15 addendum (corrective record, deletion-policy resolution of §8.1/§7.14, quota/retention status, verification record), `docs/ai/systems/AI-STUDIO.md`, `AI_GUIDE.md`, `docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md`, `docs/HANDOFF.md` §0.f (M50.4 prerequisites + M50.5 dependencies), `worklog.md`.

### Explicit no-UI / no-execution confirmation

`createMissionFromPlan` is never called; no GenerationJob, TrustTask, AgentMission or WorkflowRun row is created anywhere in M50.3; no canvas UI, no navigation changes, no `'workflow'` MISSION_TYPES extension, no new queue/worker, no provider integrations, no automatic data deletion. M50.4 (canvas UI) and M50.5 (governed execution) require separate owner approval.

**Remote SHA verification:** push verified via independent `git ls-remote` — branch SHA `1b50fab` matches the local commit exactly; `main` untouched at `979704a`.
BODYEOF
python3 - << 'PYEOF' > /tmp/m503-pr-body.json
import json
body = open('/tmp/m503-pr-body.md').read()
print(json.dumps({
  "title": "M50.3 — BEAN AI STUDIO: workflow persistence, version control & owner-scoped APIs (+ M50.2 corrective fixes)",
  "head": "feat/m50-3-ai-studio-persistence-apis",
  "base": "main",
  "body": body,
}))
PYEOF
RESP=$(curl -s -X POST "$API/pulls" -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" --data-binary @/tmp/m503-pr-body.json)
printf '%s' "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'number' in d:
    print('PR_CREATED', d['number'], d['html_url'], 'state=', d['state'], 'head_sha=', d['head']['sha'], 'base=', d['base']['ref'])
else:
    print('RESPONSE_NO_PR', json.dumps(d)[:400])
"
rm -f /tmp/m503-pr-body.md /tmp/m503-pr-body.json