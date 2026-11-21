# BEAN Intelligence — February 2027 Launch Documentation

Owner-approved product strategy and implementation record for the
**February 2027 public launch** (planning date 2026-11-20). The source of
authority is the owner's master brief; these documents turn it into a
measured baseline, an implementation plan and verifiable progress records.

**Signature advantage: Trust.** **Infrastructure budget: ₹0/month.**
**Target: public launch, February 2027.**

| # | Document | Purpose |
|---|---|---|
| 01 | [Product strategy](01-PRODUCT-STRATEGY.md) | Mission, boundaries, priorities, launch scope |
| 02 | [Baseline & feature inventory](02-BASELINE-INVENTORY.md) | Phase 0: measured repository + release state, capability inventory, gaps |
| 03 | [Phase implementation plan](03-PHASE-PLAN.md) | Phase 0–5 sequence with entry/exit criteria and current status |
| 04 | [Trust Engine specification](04-TRUST-ENGINE-SPEC.md) | The Trust Engine: lifecycle, receipts, evidence, approvals, checkpoints |
| 05 | [Agent capability matrix](05-AGENT-CAPABILITY-MATRIX.md) | Research / Document Intelligence / CODE GIFTZ agents vs. what exists |
| 06 | [Model & runtime matrix](06-MODEL-RUNTIME-MATRIX.md) | Zero-budget model transparency surface and its gaps |
| 07 | [Security & privacy release checklist](07-SECURITY-RELEASE-CHECKLIST.md) | Publication gate, credentials, release-blocking items |
| 08 | [Launch acceptance plan](08-LAUNCH-ACCEPTANCE-PLAN.md) | Acceptance targets, evaluation sets, honest measurement rules |
| 09 | [Deployment & rollback runbook](09-DEPLOYMENT-RUNBOOK.md) | Reproducible deployment incl. Trust Engine tables |
| 10 | [Completion report](10-COMPLETION-REPORT.md) | Exact evidence: implemented / verified / unverified / blockers |

## Standing release constraint (read first)

The repository carries a **historical security incident** (session-token and
database snapshot material in published Git history). The owner-controlled
recovery, credential and history-rewrite gates remain **unresolved** until
verified complete, and the **publication freeze remains in effect**: no push,
no merge, no history rewrite, no force-push, no deletion or overwrite of
recovery bundles. Implementation work proceeds as safe, isolated,
locally-committed changes only. See [07-SECURITY-RELEASE-CHECKLIST.md](07-SECURITY-RELEASE-CHECKLIST.md).

## Owner's final principle

**BEAN must never pretend.** It must not pretend to have evidence, pretend to
have completed an action, pretend a model is available, pretend a task
recovered, or pretend the product is secure. Trust is the product. Every
document in this set is written under that rule: statuses are measured, gaps
are named, and nothing is claimed complete on the basis of types, stubs,
mocks or successful compilation alone.
