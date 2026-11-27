# M44 — Decision & Verified-Execution Architecture

> Mission M44: Autonomous Decision Intelligence & Verified Execution.
> Recorded 2026-11-27 on branch `feat/m44-autonomous-decision-execution`.
> Companion docs: `docs/M44-IMPLEMENTATION-REPORT.md`,
> `docs/intelligence/M44-AUTHORIZATION-AND-SAFETY.md`,
> `docs/M44-BASELINE-REPORT.md`.

## 1. The one-sentence design

BEAN can now (a) decide between real alternatives using only the evidence it
actually holds, (b) wrap every concrete action in a typed, digest-bound,
approval-aware contract, (c) execute only through its existing real paths,
and (d) never call an action successful until an independent method has
confirmed its actual postconditions.

The load-bearing rule: **a decision is not a successful outcome; an action is
not complete until its result has been verified.** The execution state machine
makes dishonest success structurally impossible — `EXECUTING → SUCCEEDED` is
not a legal transition anywhere in the codebase.

## 2. Module map (all under `src/lib/riishe/mission/`)

| Module | Phase | Role | Purity |
|---|---|---|---|
| `decision.ts` | 1 | evidence classification → alternative comparison → honest outcome (`decided` / `insufficient-evidence` / `escalated`) | pure |
| `action-contract.ts` | 2 | typed action contracts, plan digests, capability checks, M41 bridge | pure |
| `authorization.ts` | 3 | the gate: least privilege, approval binding, delegation guard | pure |
| `action-lifecycle.ts` | 4 | the 12-state machine + the mandated execution record | pure |
| `outcome-verification.ts` | 5 | postcondition evaluators over independent observations | pure |
| `observations.ts` | 5/7 | adapters building observation sets from independent re-reads | adapter |
| `recovery.ts` | 6 | failure classification, safe retry, compensation, lessons | pure |
| `action-runner.ts` | 7 | the ONE shared runtime: gate → approve → execute → verify | server |
| `mission-bridge.ts` | 7 | every mission task stamped + verdicted into the Trust ledger | server |
| `evidence-summary.ts` (M43) | 1 input | the honest evidence summaries decisions consume | pure |

No second mission engine, no duplicate orchestration, no new research gateway,
no duplicate vector store — every module extends the M41/M42/M43 surfaces.

## 3. The decision engine

**Inputs.** An objective, constraints, desired outcome, 1–6 real alternatives,
and the M43 evidence summary (`buildResearchEvidenceSummary`) computed purely
over what was actually retrieved.

**Evidence classification.** The M43 claim ladder maps deterministically:
`verified`/`strongly-supported` → verified facts; `partially-supported` →
assumptions (usable with a stated caveat); `contradicted`/`outdated` →
stated uncertainties; everything else → named missing information. A
contradicted claim never silently resolves — the disagreement text rides
through to the outcome statement.

**Comparison.** Deterministic bounded scoring: benefit − 0.5·cost − 0.6·risk
− reversibility penalty (reversible 0 / compensable 0.3 / irreversible 0.8)
+ capped evidence-basis bonus. An irreversible path must be strictly better
to displace a reversible one; every term is printable in the rationale.

**Confidence.** Computed only from the classification (base 0.4, +0.1 per
verified fact capped at 4, +0.04 per assumption capped at 3, −0.08 per
information gap capped at 4, −0.2 if a contradiction stands, −0.1 expired /
−0.05 unknown freshness). The trail prints every term.

**The honesty ladder (`decide()`).**
1. Zero verified/partial support or ≥3 gaps → `insufficient-evidence` — the
   gaps are named, never guessed.
2. Every alternative beyond the authorization boundary (risk class or
   reversibility — callers can only TIGHTEN `normalizeBoundary`) or with
   unmet prerequisites → `escalated`, no matter how confident.
3. Confidence below the boundary → `escalated` with the exact numbers.
4. Otherwise the best-scoring selectable alternative wins, with the full
   rationale trail (objective → constraints → evidence → comparison →
   selection → stated-uncertainty).

## 4. Action contracts

`buildActionContract()` is the only constructor. It derives risk class,
reversibility and the approval requirement from the FIXED type routing
(a caller can neither widen the risk class nor lower the approval
requirement): `read-only → none`, `reversible → self`, everything
consequential (`irreversible`, `external-communication`, `financial`,
`-sensitive-data`) → `human`.

Every contract carries: typed preconditions and postconditions (12
deterministic descriptor kinds, bounded params), an idempotency key
(required for every side-effectful action — duplicate side effects are
detectable by construction), a bounded retry policy (`maxAttempts ≤ 3`,
`retryOnlyTransient` is a hard `true`), bounded timeouts, a cancellation
support flag, checkpoint hooks, and the plan version.

`buildActionPlan()` computes the canonical Trust-Engine digest over the plan
content; `planVersion` is DERIVED from that digest, so an approval is bound
to the exact plan. `planChanged()` kills stale approvals.

The contract vocabulary DESCRIBES all risk classes because the gate must
recognize and hold consequential actions — but real execution paths exist
only for what BEAN can actually do. `contractForTaskSpec()` wraps existing
M41 mission task specs with postconditions derived from the task's own
verification criteria (one honesty standard).

## 5. Execution lifecycle

```
PLANNED → AWAITING_APPROVAL → APPROVED → EXECUTING → VERIFYING → SUCCEEDED
   │             │                          │
   ▼             ▼                          ▼
BLOCKED       REJECTED,                  FAILED, CANCELLED
   │          CANCELLED                     │
   ▼                                        ▼
RECOVERY_REQUIRED ◄────────────  PARTIALLY_SUCCEEDED
```

- `EXECUTING → SUCCEEDED` is illegal; a success-shaped tool response only
  reaches `VERIFYING`.
- The verdict edge is single: `verificationOutcomePatch(verdict, method)` —
  confirmed → `SUCCEEDED`, failed → `FAILED`, inconclusive →
  `RECOVERY_REQUIRED`.
- The `ActionExecutionRecord` carries everything the brief mandates:
  requested action, authorized scope, input parameters, execution identity,
  start/completion timestamps, result + evidence references, verification
  method, verdict, final status, attempts — all bounded.
- `isHonestSuccessPath()` audits whole transition histories; the acceptance
  suite exercises it against the illegal shortcut.

## 6. Independent verification

The evaluators (`verifyPostconditions`) receive an `ObservationSet` gathered
by a method INDEPENDENT of the execution path: a fresh store re-read (never
the write's own return value), a git re-query, an artifact inspection, an
HTTP re-fetch, provenance re-derivation from the evidence records themselves,
or an idempotency-ledger read. The executor's claim is not an input anywhere.

Honesty rules: every declared postcondition must evaluate; a missing
observation slice is `INCONCLUSIVE` — never silently true; all-pass →
`confirmed`, any fail → `failed`, any inconclusive (no fail) →
`inconclusive`. Undeclared contracts get honest fallbacks per action type —
nothing auto-confirms.

## 7. Recovery and learning

`classifyFailure` routes authorization → verification → transient →
permanent (deterministic pattern tables). `planRetry` retries ONLY transient
failures inside the bounded budget, consulting the idempotency ledger (a
retry that could duplicate a side effect is refused), never blind-retries
authorization or verification failures, and cancellation voids everything.
`compensatingActionFor` maps action types to `auto` / `approval-gated` /
`none` compensations (publication cannot be unsent — that recovery belongs
to the owner). `needsHumanEscalation` escalates ambiguous or irreversible
recoveries while preserving partial successes.

Lessons pass through the M43 knowledge guard: an execution observation is
trusted ONLY when the postconditions were independently confirmed; everything
else is shaped as an `unverified-research-note` that can never back trusted
knowledge. Agents cannot modify their own safety policies — the action
vocabulary has no such type AND `assertNoPolicySelfModification` refuses
grant/policy shapes hiding in parameters.

## 8. Audit and provenance

- Standalone action plans: full `ActionExecutionRecord`s returned to the
  caller, plus `m44.action_executed` audit events (actor, action id,
  planVersion, verdict, risk class) through the existing metering sink.
- Missions: the bridge writes one Trust-ledger measurement row per task
  transition — `m44:<stamp> | kind→actionType | phase | verdict | risk |
  key | note` — through the REAL `addTrustEvidence` validation. The bridge
  never gates, never reroutes, never throws: the M41 flow is untouched.

## 9. Product integration

All five products converge on the ONE mission executor, so the bridge is the
integration surface: CODE GIFTZ (`code-build`/`document-draft`), LAXII
(`image-asset`), JAZMII (`video-asset`), GANGZII (`audio-asset`), the
knowledge/research lanes (`research`/`knowledge`) and the quality verifier
(`verify-deliverable`) all carry the same contract vocabulary and the same
verdict notes. Standalone verified actions (workspace file ops + the guarded
research lane) run through `runActionPlan`, used by the acceptance suite and
available to any server-side caller. Internal provider names and backend
implementation details are never exposed to customer-facing surfaces — the
UI is unchanged (recorded walk: `validation/m44-ui/`).

## 10. What M44 deliberately does NOT do

- No autonomous push/merge, deployment, publication or external
  communication: the classes are recognized and held for approval, but BEAN
  has no real execution path for them today, and the runner says so honestly
  instead of simulating.
- No chat-surface decision tool: the decision engine serves the mission and
  action-plan layers; exposing it as a per-turn chat tool would require new
  permission-key wiring and is left as future work (recorded, not hidden).
- No weakening of M41/M42/M43: the mission verifier, research budgets,
  evidence ladder and knowledge guard are consumed, never bypassed.
