# M47 — REPOSITORY LIVE OPERATIONS

Status: **implementation complete, transport-tested; live write lane HONEST-UNAVAILABLE** (owner configuration pending).

## What exists (reused, not rebuilt)

M46's repository adapter (`src/lib/riishe/mission/repository-adapter.ts`) is the ONLY GitHub integration. M47 added no second one. Its verified surface:

- Read: `inspectRepository`, `listBranches`, `listCommits`, `readBranchFile` (content read-back), `compareRevisions`, `listPullRequests`, `getPullRequest`, `remoteDivergence`.
- Write: `createBranch` → `commitToBranch` → `fastForwardBranch` (ancestry-checked, `force:false` hardcoded, `forcePushSupported:false`) → `createPullRequest` / `updatePullRequest` — each returns verified evidence, and every write carries the M46 reconciliation rule: **a write with uncertain remote state is NEVER SUCCEEDED and NEVER blind-retried** (write-class transport loss → `reconciliation-required` → the runner maps it to VERIFYING/RECOVERY_REQUIRED; remote state is inspected before any retry).

## M47 evidence (this session)

- `scripts/m47-github-readiness.ts` (committed) ran the REAL seams:
  - `writeLaneAvailability()` → available=false, "No GitHub credential is configured (GITHUB_TOKEN absent) — real writes are unavailable and are never simulated."
  - `diagnoseGitHubCredential()` → state=not-configured (env NAME `GITHUB_TOKEN` consulted; value never read; live validation honestly skipped).
  - `integrationRepository()` → NOT-CONFIGURED — the owner production repository is never assumed disposable.
  - LIVE read lane: real `git ls-remote` against `jon0471-dot/Bean-intelligence` → remote HEAD `82fd02832f6f` (quota-free, no token consumed).
- M47-A28/A33 (acceptance suite) re-executed the write-uncertainty rule through a live transport-seam failure: connection lost mid-write → `reconciliation-required`/`failed`, never `executed`, never retried blind.
- M47-A27 re-pinned the force-push structural impossibility.
- The M46 19-case workflow rehearsal (inspect → isolated feature branch → clearly-named harmless artifact → content read-back → fast-forward → PR with independent verification, plus all 10 failure scenarios) re-ran green in the regression census.

## The required live workflow (when the owner configures the lane)

Exactly M46's 13-step acceptance workflow, restricted to the allowlisted `BEAN_TEST_REPOSITORY`: no writes to `main`, no merges, no force-push, no history rewrite, no automatic cleanup of the test branch/artifact/PR — cleanup is a separately approved action. Failure reconciliation (invalid/insufficient/expired credentials, rate limiting, network loss before/after write, verify-failure-after-write, duplicates, divergence, approval expiration, modified parameters) is already pinned by the transport-tested suite; unknown remote state lands in VERIFYING/RECOVERY_REQUIRED, never SUCCEEDED.

## Owner prerequisites

1. A least-privilege credential (fine-grained PAT or GitHub App installation token) with Contents/PR write scoped to ONE dedicated integration repository.
2. `BEAN_TEST_REPOSITORY=owner/disposable-integration-repo` — explicit; never defaulted; never the production repository.
3. Configuration happens in the deployment environment — never through chat, never committed.
