# QUALITY — Output Verification

**Status: implemented as BEAN's verification substrate. IMPORTANT honesty note: QUALITY is NOT a standalone chat worker — it runs as deterministic verification inside RIISHE turns and as the mission quality gate.**

## 1. Purpose and responsibilities

QUALITY is the specialist name for BEAN's deterministic output verification:
arithmetic re-evaluation, citation auditing, injection-guard verification,
self-check parsing, mission deliverable verification and completion-policy
state assignment. Its job is to make every shipped answer's honesty
machine-checked, not model-claimed.

## 2. Actual architecture

- **Turn verification** — inside `orchestrateTurn` (`src/lib/riishe/
  orchestrator.ts`): `verifyComputations` + `parseSelfCheck`
  (`src/lib/verify/exprcheck.ts`), `auditCitations` + fabrication stripping
  (`src/lib/verify/citations.ts`), the deterministic injection guard
  (`src/lib/verify/injection.ts`). Results land in `metadata.verification`
  and drive the assigned response states (`statesFrom` — TOOL_UNAVAILABLE /
  UNVERIFIED / verified states from REAL execution).
- **Completion policy** — `src/lib/riishe/completion-policy.ts`: terminal
  task stages derived from actual execution facts (never model-authored).
- **Mission verification** — `src/lib/riishe/mission/verifiers.ts` +
  `verify-context.ts`: deterministic criteria per task kind (artifacts
  exist, sources count, file changes, audio validation, document sections),
  `needs_correction` cycles within bounded budgets.
- **M43+ claim/verification layer** — `src/lib/verification/pipeline.ts` for
  structured verifier issues; `EvidenceKnowledge` outcomes for
  knowledge-grade claims.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Arithmetic/self-check | `src/lib/verify/exprcheck.ts` |
| Citations | `src/lib/verify/citations.ts`, `src/lib/riishe/citation-view.ts` |
| Injection guard | `src/lib/verify/injection.ts` |
| Completion policy | `src/lib/riishe/completion-policy.ts` |
| Mission verifiers | `src/lib/riishe/mission/{verifiers,verify-context}.ts` |
| Verification pipeline | `src/lib/verification/pipeline.ts` |

## 4. Model and provider integration

None — QUALITY is deliberately deterministic. It never calls a model; it
re-derives facts from real payloads (computed expressions, cited URLs,
persisted artifacts).

## 5. Input/output contracts

Verification outputs: `VerificationCheckView[]` (check label, status
passed/failed, detail with claimed→actual), assigned response states, and
mission `TaskVerificationOutcome` ({status, reasons[], artifacts[]}).

## 6. Tools and permissions

No tools of its own. In missions, the `verify-deliverable` kind is routed to
the `quality` agent with the `mission-inspect` read-only scope — it can
inspect only artifacts the mission itself produced.

## 7. Data and memory handling

Verification evidence persists in message metadata, mission task rows
(`verificationResultJson`) and Trust evidence records; nothing is inferred
about users.

## 8. Execution workflow

answer/artifact produced → deterministic re-checks (math, citations,
injection, artifact existence, source counts) → failure → bounded
correction cycle (missions) or honest degradation (turns: UNVERIFIED /
limited states, verification rewrite via `reset` frames).

## 9. Existing tests and verification

`tests/unit/riishe-mission-verifiers.test.ts`, `riishe-mission-verify-context
.test.ts`, `injection-guard.test.ts`, `p0-completion-policy.test.ts`,
`claim-verification`/`claim-repair`/`clean-citations`/`citation-cleanup`
suites, `riishe-wrapped-classification.test.ts`.

## 10. Failure handling and fallback behavior

When verification cannot confirm a claim, the answer ships UNVERIFIED with
the honest note — never silently dropped, never fabricated as verified.
Mission tasks failing verification re-enter bounded correction; exhausted
budgets end the task honestly.

## 11. Current implemented capabilities

Arithmetic re-evaluation with claimed-vs-actual diffing; citation universe
auditing with fabricated-URL stripping; prompt-injection detection + refusal
enforcement; mission deliverable verification per kind; completion-policy
terminal states; verification rewrites streamed via the reset protocol.

## 12. Partial capabilities and known limitations

QUALITY has no conversational surface of its own — the AUTOBOTS `review`
capability is conversational analysis, explicitly NOT a QUALITY execution
path; factuality beyond arithmetic/citations (deep factual auditing) relies
on the research pipeline's claim verification, which is source-based rather
than omniscient.

## 13. Planned capabilities (NOT implemented)

 richer semantic fact-checking, user-visible verification reports as a
product surface — roadmap only.
