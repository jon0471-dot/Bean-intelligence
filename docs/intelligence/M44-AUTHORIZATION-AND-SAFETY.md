# M44 — Authorization Model, Security Boundaries & Operator Procedures

> Companion to `docs/intelligence/M44-DECISION-EXECUTION-ARCHITECTURE.md`.
> Recorded 2026-11-27, branch `feat/m44-autonomous-decision-execution`.

## 1. The authorization model

### 1.1 Risk classes and what they require

| Risk class | Approval requirement | Examples (real paths) |
|---|---|---|
| `read-only` | none | file-read, research-fetch |
| `reversible` | self (granted scope possession) | file-write, code-build, media-produce, repo-commit |
| `irreversible` | human | repo-push, deployment-release |
| `external-communication` | human | external-communicate |
| `financial` | human | (recognized; no real path today) |
| `sensitive-data` | human | (recognized; no real path today) |

The requirement is DERIVED from the risk class by fixed routing and can never
be lowered by a caller. Callers may only TIGHTEN the decision boundary
(`normalizeBoundary` clamps `maxRiskClass` down and `minReversibility` up;
`minConfidence` floors at 0.5).

### 1.2 Approval binding (one digest discipline)

An approval request canonicalizes EVERYTHING that defines the action — type,
title, description, parameters, scope, risk class, reversibility, idempotency
key, plan version and plan digest — into one JSON payload hashed with the
Trust Engine's canonical sha-256 (`actionDigestFor`). Consequences:

- **Modified approval** → the payload digest no longer matches →
  `digest-mismatch`, gate blocked.
- **Re-planned action** → the payload embeds the old plan digest →
  `plan-stale` (checked first for the precise diagnosis).
- **Wrong action** → the payload names a different `actionId` →
  `wrong-action`.
- **Re-use / expiry** → the Trust Engine consumes approvals on use
  (`consumeTaskApproval`) and expires them on TTL → `not-granted`.

The consume happens SERVER-SIDE immediately before the action, by the
runtime — never by client discipline.

### 1.3 Who may approve

Only an `owner-user` decision unlocks a human-class action. A
`delegated-agent` or `system` approver is refused (`non-owner-decision`), and
the executor identity approving its own action is refused
(`self-approval-by-executor`). An AI-generated plan is NEVER user
authorization.

### 1.4 Delegation cannot escalate

`checkDelegation` requires a delegated identity's scopes to be a strict
SUBSET of its grantor's scopes; an unknown grantor makes every scope
unverified; self-delegation is refused outright. Escalation is checked BEFORE
any other gate logic — an escalated identity gets nothing.

### 1.5 Immediate cancellation

A cancellation flag voids every gate state at the next check — an approval
already granted does not survive it. The runner also honors the flag between
actions; already-finished actions keep their recorded results.

## 2. Security boundaries

1. **Least privilege**: every non-read-only action consumes a named scope;
   the runner blocks on missing scopes before any side effect.
2. **Server-side enforcement**: the gate and the approval consume live in
   server-only modules; no client surface can mark an action approved.
3. **No policy self-modification**: the action vocabulary has no type that
   touches permissions or safety policy, and `assertNoPolicySelfModification`
   additionally refuses `allow*=true`, role-escalation, guard-disabling and
   policy-file shapes hiding inside contract parameters — checked BEFORE the
   gate, so even a compromised planner cannot smuggle them through.
4. **No duplicate side effects**: idempotency keys are mandatory for every
   side-effectful action; the retry planner consults the observed run count
   and refuses retries that could exceed the allowance.
5. **No privilege escalation through delegated agents**: §1.4.
6. **The knowledge boundary**: unverified execution observations become
   `unverified-research-note` rows only (the M43 guard refuses trusted
   classes for them; M44 shapes them correctly before asking). Only
   independently confirmed postconditions earn a verified class.
7. **No provider-name exposure**: customer-facing surfaces never show
   internal provider or backend implementation details (UI unchanged —
   recorded walk `validation/m44-ui/`).
8. **No consequential execution without authorization**: no payments,
   publication, account changes or destructive operations have real paths
   here; where the vocabulary classifies them, the gate holds them for
   human approval and the runner refuses honestly rather than simulate.

## 3. Operator procedures

### 3.1 Reviewing and deciding approvals

1. Approval requests surface through the EXISTING Trust approval flow
   (bounded summary + exact action JSON + digest), bound to the mission's
   trust task.
2. Decide grant/deny through the existing trust approval route. A grant is
   consumed on use; there is no standing permission.
3. If the plan changed since the request, the approval is stale by
   construction (`plan-stale`) — request a new approval for the new digest.

### 3.2 Cancelling work

- Missions: use the existing `cancel_mission` tool / owner route; the flag
  propagates and every M44 gate state voids.
- Standalone action plans: set `cancelRequested` on the run input; the runner
  stops before the next action and reports `cancelled` with zero new side
  effects.

### 3.3 Interpreting outcomes

- `SUCCEEDED` — the postconditions were confirmed by the named independent
  method (recorded on the record).
- `FAILED` — execution failed OR verification failed; the record says which
  and carries the bounded honest reason.
- `RECOVERY_REQUIRED` — verification was inconclusive (e.g. an observation
  slice was missing). Re-observe and re-verify; do not force success.
- `BLOCKED` — gate refusal; the reason names the missing scope, the stale
  approval, or the policy guard hit.
- `HONEST-UNAVAILABLE` (runner summaries) — the action class has no real
  execution path in BEAN today. It is never simulated. Use the real paths
  (workspace files, research lanes, mission-delegated specialist jobs).

### 3.4 Recovery decisions

Recovery escalates to a human whenever the failed action is irreversible, no
compensating action exists, the checkpoint is invalid, attempts are exhausted
on transient failures, or authorization is missing. Compensations are `auto`
only where a real undo path exists (workspace version history, revert
commits, asset removal within the creation scope).

### 3.5 Auditing

Every mission task transition writes an M44 measurement row to the Trust
ledger (`m44:<stamp> | kind→actionType | phase | verdict | risk | key`);
standalone runs return full execution records and emit `m44.action_executed`
audit events. Ledger rows are append-only; terminal records refuse rewrites.

## 4. Known limitations (honest)

- Repository pushes, deployments and external communications are classified
  and gated but have NO real execution path in BEAN today; the runner refuses
  them honestly even with a granted approval.
- The decision engine is wired into the mission/action-plan layers, not yet
  exposed as a per-turn chat tool (that would need new permission-key wiring
  in the orchestrator's two-key pattern).
- Standalone `code-build`/`media-produce` actions refuse outside the durable
  mission job engine; delegate them as mission tasks.
- The action runner executes plans synchronously in dependency order;
  long-running plans should stay small or ride the mission engine.
