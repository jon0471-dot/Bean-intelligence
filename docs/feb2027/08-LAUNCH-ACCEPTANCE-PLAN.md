# 08 — Launch Acceptance & Evaluation Plan

Targets from the brief §11 are **goals to demonstrate, not current results**.
Nothing below is claimed as achieved until measured with the stated
conditions. Every reported percentage must carry numerator, denominator, test
conditions and the failure list.

| Target | Evaluation set (to build) | Measurement rule | Current status |
|---|---|---|---|
| ≥90% completion on the real-world task evaluation set | scripted scenarios across research / documents / coding / memory / interrupted tasks (repeatable, versioned fixtures under `tests/` + scripts) | task = completed iff its Trust receipt ends `completed` or `completed_with_limitations` with the requested artifact produced; `completed_with_limitations` counts as completed only when the limitation list matches the scenario's allowed limits | **NOT YET MEASURED** |
| Zero false-success reports | audit pass over receipts: any task whose outcome claims exceed its verification summary | count of violations (must be 0); check runs over every evaluation run's receipts | **NOT YET MEASURED** (mechanism shipped: finalize requires verification summary; states mapping cannot upgrade) |
| Zero critical data-loss incidents | versioning + file-ops suites; crash/kill drills on queue workers | incident ledger count | none observed to date; formal drill pending |
| Zero critical permission bypasses | cross-user authorization matrix (404s), project-scope key tests, approval consume-once tests | count (must be 0) | tests green at foundation level (trust scoping/consume-once pinned) |
| ≥95% project-context retrieval | memory/retrieval eval set: save→forget→edit→retrieve flows with expected-recall annotations | retrieved-correct / expected, per scenario list | **NOT YET MEASURED** |
| ≥90% supported transient-failure recovery | kill workers mid-job; quota-storm replays; lease-expiry recoveries | recovered-without-duplicate-side-effects / injected failures, per supported task type only | **NOT YET MEASURED** (recovery claims stay scoped per 04 §5) |
| ≥99.5% core availability during beta | health-probe uptime record over the beta period (`/api/health` history) | successful probes / total probes, per 5-min window | beta not started |
| Zero unexplained model/provider fallbacks | audit `provider.fallback` records vs registry fallback lists | any fallback not matching an explicit registry fallback list = violation | mechanism live (routing.ts); formal audit pending |
| Zero unapproved consequential external actions | receipts audit: every executed consequential action must show a consumed, digest-bound approval (or the file-ops ledger equivalent) | count of violations (must be 0) | mechanism shipped (consume-once, digest-bound); audit pending |

## Scenario set to build (Phase 3–5)

1. **Research:** factual / multi-source / freshness-sensitive / should-decline questions; assert states + citations + receipt outcomes.
2. **Documents:** text/PDF/DOCX/XLSX ground-truth extraction; grounded-mode refusal cases; locator assertions once locators land.
3. **Coding:** change-plan → diff → sandbox verification → version snapshot; verify exact outcome reporting; rollback drill.
4. **Memory:** save/forget/list/edit/export/retrieval-explanation flows (edit/export land in Phase 2).
5. **Interruption & recovery:** cancel mid-turn (receipt → `cancelled`), worker kill (lease recovery), quota storms (bounded backoff, no retries of 429).

## Honesty rules for the final launch report

- Report counts, not bare percentages; include conditions and failures.
- Pre-existing failures and known flakes are listed by name (e.g. the
  `research-latency` freshness-cache timing flake observed once under full-suite
  load on 2026-11-20).
- Unavailable capabilities are listed as unavailable — with the reason class
  the product itself reports (`not-configured`, `blocked`, `NO_BACKEND`).
