# M46 — Operational Recovery (docs/intelligence)

Milestone: M46.5 (Phases 6–7 reliability) · commit `e6bdd48`

M46's reliability rule: **a timeout after a remote write must not automatically trigger another write; a deployment that timed out may already have succeeded remotely — inspect actual state before retrying.** The rule is implemented on the EXISTING M44/M45 infrastructure (no new framework).

## The reconciliation path (new, M46.3)

- `repository-adapter.ts`: write-class (non-GET) transport failures return the new outcome **`reconciliation-required`** — the request may have landed before the connection died. Read failures stay plain `failed` (reads retry safely).
- Every write operation (`createBranch`, `commitToBranch`, `fastForwardBranch`, `createPullRequest`) flows the outcome verbatim; a pinned test proves exactly ONE request is sent (never blind-retried).
- `action-runner.ts` routes reconciliation-required through **VERIFYING**: the postcondition machinery (methods independent of the write) decides — CONFIRMED is the only path to SUCCEEDED; unresolved becomes **RECOVERY_REQUIRED** (never SUCCEEDED, never silently failed). Audit event `m46.write_reconciliation`.

## Deployment recovery (new, M46.4)

- `executeApprovedStagingDeploy`: verification incomplete → UNVERIFIED + `reconciliationRequired`; process manager dying mid-deploy → reconciliation-required (the actual staging state is inspected before any verdict).
- `rollbackStagingToBuild`: separately authorized; retained-build targets only; verified the same independent way; never an automatic retry.

## Pre-existing recovery infrastructure (extended, not replaced)

| Mechanism | Where | M46 status |
| --- | --- | --- |
| Idempotency keys (digest-bound, per action contract) | M44 `action-contract.ts` | unchanged; scope-expansion fix strengthens it |
| Consume-once approvals + turn ledger | M44 Trust Engine + M45 `conversation-binding.ts` | unchanged |
| Checkpoint / resume | M44 Trust `checkpoints/resume` | unchanged |
| Cancellation | M44 lifecycle `CANCELLED` edges | unchanged |
| Stream guards (idle/total/heartbeat, labeled errors) | `stream-config.ts` | unchanged |
| Retry policies per backend descriptor (truthful: 1 attempt for chat) | `registry/backends.ts` | unchanged |
| Rate-limit handling + circuit/reachability patterns | `adapters/gateway-reachability.ts`, hosted adapters | unchanged |
| Honest unavailability as a typed outcome | M45 adapters | extended with `reconciliation-required` |

## Knowledge-guard preservation (M43)

Unverified operations can never become trusted memories: the M43 provenance/evidence guard and the M44 verification requirement stand; the reconciliation outcome carries UNVERIFIED evidence notes so a timed-out write cannot be remembered as a success.

## Audit retention

Audit events (`m44.action_executed`, `m45.repo_*`, `m46.*`) persist through the existing metering ledger; the credential diagnostic records outcomes only; no audit trail was truncated or rewritten in M46.

## Credential rotation safety

Rotation = owner replaces `GITHUB_TOKEN` in the deployment environment. The diagnostic re-reads env per run, so the next diagnostic validates the new token; a revoked-but-rotated token surfaces as `auth-invalid` (401) with no cached state. No secret ever enters logs or model context during rotation.
