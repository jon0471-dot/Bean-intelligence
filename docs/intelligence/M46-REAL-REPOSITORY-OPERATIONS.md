# M46 — Real Repository Operations (docs/intelligence)

Milestone: M46.3 (Phase 4) · commit `e60cda3`

## Write-lane readiness (the honest state)

```
writeLaneAvailability():
  available: false
  reason: "No GitHub credential is configured (GITHUB_TOKEN absent) — real writes
           are unavailable and are never simulated."
```

**Status: HONEST-UNAVAILABLE.** The lane is implementation-complete and fully tested; activation requires the owner configuration described in `M46-GITHUB-CREDENTIALS-AND-ACCESS.md`. No real write acceptance was performed — the owner's production repository was never touched by any acceptance test.

## The dedicated integration repository

`BEAN_TEST_REPOSITORY` selects the target through EXPLICIT configuration. Nothing creates, publishes or defaults it. When unset (or malformed), write acceptance targets nothing: the default allowlist points at the owner production repository, and write acceptance against a production repository is refused without separate explicit authorization.

## The required workflow, implemented and rehearsed

`tests/unit/m46-repository-write-lane.test.ts` executes the exact Phase-4 sequence through the injected transport (MOCKED) — ready to run LIVE the moment a real integration repository + credential exist:

1. Inspect repository identity (`inspectRepository`) ✔
2. Inspect default branch and protection (policy layer refuses protected names BEFORE any network call) ✔
3. Read current remote revision (`remoteDivergence` / `git ls-remote`) ✔
4. Create an isolated feature branch (`createBranch` — 40-hex source SHA required, 422 duplicates refused) ✔
5. Write a harmless, clearly named integration-test artifact (`m46-integration-test.md`) ✔
6. Commit the approved change (`commitToBranch`) ✔
7. Push using normal fast-forward semantics (`fastForwardBranch` — the ancestor check runs first; force pushes are structurally impossible) ✔
8.–9. Independently fetch the remote ref and verify the commit (a different call class than the write; `git ls-remote` when available — the LIVE test in this suite really ran `git ls-remote` against github.com, quota-free) ✔
10. Read the committed artifact and verify its contents (**NEW** `readBranchFile` — base64-decoded read-back, path traversal refused pre-network) ✔
11. Create a pull request only within the configured test repository (`createPullRequest`) ✔
12. Independently read and verify PR identity/source/target/open state ✔
13. Record all evidence and audit events ✔

Never merged, never cleaned: PR merge, branch deletion and artifact removal are separately approved operations and are not implemented as automatic steps.

## Failure scenarios (each pinned as honest behavior)

| Scenario | Behavior |
| --- | --- |
| Invalid credentials (401) | `failed` with the HTTP status; never executed |
| Insufficient permissions (403 non-rate-limit) | `failed` honestly |
| API rate limits | `honest-unavailable` (not a repository failure) |
| Network timeout after a write | **`reconciliation-required`** — the remote state is UNKNOWN; exactly ONE request is sent (never blind-retried); the M44/M46 runner routes it through VERIFYING and the postcondition machinery reads methods INDEPENDENT of the write; only a CONFIRMED observation can become SUCCEEDED, unresolved becomes RECOVERY_REQUIRED (audit event `m46.write_reconciliation`) |
| Successful write + failed verification | `executed` with `verified:false` — UNVERIFIED, never success |
| Remote revision changed mid-operation | fast-forward refused (non-descendant); force impossible |
| Duplicate execution | 422 refused; consume-once approval layer unchanged |
| Stale approval | refused at the Trust approval layer (M45 S7/S8 unchanged) + honest unavailability when the credential seam vanished mid-flight |
| Protected branch target | refused BEFORE any network call (main/master/develop/release-/hotfix-/production/prod) |
| Unauthorized repository | refused BEFORE any network call (allowlist + integration-repo check) |

## Live read lane (LIVE — real external system)

The suite's LIVE probe ran a real `git ls-remote https://github.com/jon0471-dot/Bean-intelligence.git refs/heads/main` (exit 0, 40-hex SHA) — the quota-free verification lane, used throughout Phase 0 as well.
