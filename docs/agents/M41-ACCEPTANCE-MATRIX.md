# M41 — Acceptance Matrix

> Source of truth: `scripts/m41-acceptance/out/mission-evidence-m41.json` (live run, dev server + real DB + real specialists, this window) and the 97-test mission suites (`bun test tests/unit/riishe-mission-*`). Three-way classification as in M40: **PASS** = verified execution/contract · **HONEST** = truthful unavailability/evidence-class · **FAIL** = failure requiring repair.

## 1. The 20 evaluation categories

| # | Category | Class | State | Evidence |
|---|---|---|---|---|
| 1 | Correct task decomposition | kernel | PASS | planner decomposes all four canonical shapes with complete contracts (`1-decomposition`) |
| 2 | Specialist selection | kernel | PASS | fixed kind→agent routing over the real specialists (`2-selection`) |
| 3 | Dependency ordering | kernel + live | PASS kernel / FAIL live* | topological order pinned (`3-ordering`); the live observation row (`3-ordering-live`) follows the document task's final state and shows the audit-blocked failure ordering honestly |
| 4 | Parallel task execution | live | PASS | media mission: independent lanes observed (`parallelSeen`, `imageDoneBeforeVideoDone`) (`4-parallel`) |
| 5 | Cross-agent artifact handoff | live | FAIL* | research pack verified into the document contract; document lane audit-blocked this window (`5-handoff`) |
| 6 | Real output validation | live | PASS | every done task carries a deterministic verifier verdict (`6-validation`) |
| 7 | Contradiction / unmet-contract detection | kernel | PASS | verifiers never upgrade: unmet contract = needs_correction, missing evidence = failed (`7-quality-gate`) |
| 8 | Failed-agent recovery | unit + live | PASS (semantics) | bounded correction rounds + terminal permanent failures pinned by tests; live correction round observed on the website mission before its truncation |
| 9 | Partial-success handling | live | PASS | outcome matches task reality (`completed` / `completed_partial` / `failed` decisions all correct) (`9-partial-success`) |
| 10 | Duplicate-task prevention | live | PASS | identical ACTIVE mission → 409 (`10-duplication`) |
| 11 | Cancellation propagation | live | PASS | owner cancel → runner stops, specialist job signalled, dependents cancelled, honest settlement (`11-cancellation`) |
| 12 | Durable resume | unit | HONEST | crash-safe resume pinned by the executor suite (verified tasks never re-executed); live restart drill = owner operations (`12-resume`) |
| 13 | Cross-user isolation | live | PASS | foreign GET/cancel → 404 (`13-isolation`) |
| 14 | Approval enforcement | kernel | PASS | structural vocabulary safety (no destructive/external scope exists) + two-key delegation gates (`14-approvals`) |
| 15 | Resource and concurrency limits | kernel | PASS | timeouts/attempts/corrections/parallel lanes clamped (`15-limits`) |
| 16 | Website-building workflow | live | FAIL* | provider truncation mid-build → honest failure recorded (`16-website`, reclassified honest-unavailable) |
| 17 | Media-production workflow | live | PASS | completed_partial with a REAL verified hosted video + honest side-task failures (`17-media`) |
| 18 | Research + grounded-document workflow | live | PARTIAL | retrieval lane PASS (6 real sources), atlas PASS (4 references), document lane FAIL* (hosted audit) (`18-research-doc`) |
| 19 | Real CODE GIFTZ project execution | live | PARTIAL | real coding jobs produced real files (4-file website build observed; document drafts produced report.md) — audit gate + truncation blocked full verification this window (`19-giftz-execution`) |
| 20 | Final deliverable integrity | live | FAIL | 1/2 settled missions carry a verified gate at ledger end (`20-integrity`): the media mission's aggregate gate was SKIPPED by an upstream side failure (its formal outcome `completed_partial` stands on the VERIFIED video deliverable with the unfinished side tasks named in the summary), and the research-doc `completed` row predates the verifier honesty fix — its stored verdict still carries the contradictory reason the fix eliminated. Ledger rows are immutable; the post-fix machinery settles such shapes honestly (pinned by tests) |

\* The document/website FAIL rows share ONE root cause: the hosted self-verifier audits the coding turn's file-fenced reply strictly and rejected the document/build drafts this window (plus one provider truncation). The mission machinery behaved honestly end-to-end — no false completions; the failure is recorded as requiring repair on the VERIFIER-FOCUS side (a mission-aware audit focus for file-fenced deliverables), not on the mission machinery.

## 2. Suites (measured)

| Suite | Result |
|---|---|
| `bun test tests/unit/riishe-mission-core|planner|verifiers|executor|safety|chat.test.ts` | 97 pass / 0 fail |
| Full repository suite at M41.5 | 2902+ pass / 0 fail (per-milestone runs) |
| Live acceptance | 13 PASS / 4 honest-unavailable / 4 FAIL → `mission-evidence-m41.json` |

## 3. What this matrix does NOT claim

- No claim that the document/website workflows are reliably complete end-to-end until the verifier-focus follow-up lands — the current window's evidence says otherwise, and that is what this page records.
- No claim of universal model availability; provider state is window-bound and classified honestly per run.
- No claim of a live server-restart resume drill (owner-operations exercise; the machinery itself is unit-pinned).

## 4. M41.7 post-fix reconciliation (2026-11-26)

The three file-fenced verification FAIL rows (18-research-doc / 3-ordering-live / 5-handoff) were ONE root cause observed three ways — the wrapper-auditing hosted verifier blocking the document task of the single research→document mission. The fourth FAIL (20-integrity) was the AGGREGATE count across delivered missions (downstream bookkeeping of that same root cause + the legacy pre-honesty-fix ledger row named in §2), not an independent verification failure.

M41.7 repaired the root cause in the existing architecture. Post-fix evidence (`mission-evidence-m41.json`, original preserved as `mission-evidence-m41-PREFIX.json`): **20 PASS / 4 honest-unavailable / 0 FAIL over 24 rows**:

- 18-research-doc / 3-ordering-live / 5-handoff → **PASS**: the mission completed end-to-end with every task verified (document audited from its persisted content; mission `cmwx15uuq…`).
- 20-integrity → **PASS**: ledger-measured 2/2 delivered missions carry verified gates (research-document + website-build `cmwx2hc1p…`).
- 16-website / 19-giftz-execution: the window rows remain honest-unavailable (provider output-limit truncation, 3 of 4 attempts — environmental, verbatim); the workflow's completion is separately evidenced by measured-PASS rows (mission `cmwx2hc1p…` completed, build verified from the persisted 11-file project).
- New 21-verify-contract: 13 contract cases exactly as classified.

The section-3 "does NOT claim" list's first bullet is superseded by this addendum: the document and website workflows now have live completed-and-verified missions; the honest-unavailable rows name the remaining environmental variance (provider truncation windows) exactly as recorded. Full reconciliation: `docs/agents/M41.7-ACCEPTANCE-RESULTS.md`.
