# M46 — Acceptance (docs/intelligence)

Suite additions: `tests/unit/m46-tool-invocation.test.ts` (28) · `m46-credential-diagnostics.test.ts` (8) · `m46-repository-write-lane.test.ts` (19) · `m46-staging-deployment.test.ts` (9) · `tests/integration/m46-migration.test.ts` (3) — 67 new cases. Plus the M41–M45 regression (all 243 pre-existing files, 0 failures) and the real-app walkthrough.

## Classification vocabulary (unchanged from M45 + the milestone's HONEST-UNAVAILABLE)

LIVE — real external system · LOCAL-LIVE — actual local process/network service/fs · LOCAL-INT — real modules over controlled local dependencies · MOCKED — injected transport · FIXTURE — fixed test data · MANUAL — separately performed and documented · HONEST-UNAVAILABLE — required infrastructure or permission absent.

**Accounting rule (the M45 27-vs-24 lesson): every scenario has exactly ONE unique ID, ONE primary classification, and an explicit result. The sum of rows equals the number of unique scenarios.**

## The 32-scenario matrix

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M46-S01 | Advice request stays advice-only | LOCAL-INT | PASS | `m46-tool-invocation` §1; 4 classifier pins + guard refusals; live turn 1 (advice reply, no action) |
| M46-S02 | Planning request produces a plan without execution | LOCAL-INT | PASS | §2 (plan intent → propose only; execute/approval absent) |
| M46-S03 | Read-only request selects the correct tool | LOCAL-INT | PASS | §3 (governance universe opens for inspect/revision/repository vocabulary; `execution_decision` selected under two-key) |
| M46-S04 | Supported model performs an actual conversational tool call | LIVE | NOT DEMONSTRATED — recorded honestly | 4 real turns on the hosted lane (3 API + 1 UI): 0 tool calls emitted; every decline measured (`riishe.tool_invocation.declined`) + customer-safe degraded note; never faked |
| M46-S05 | Unsupported model falls back honestly | LOCAL-INT | PASS | `resolveToolInvocationPolicy` `none`-protocol → plain fallback + honest note; unknown backends default safely |
| M46-S06 | Capability permission missing blocks the tool | LOCAL-INT | PASS | in-tool re-check refuses without `allowExecutionGovernance` (m46 §7) |
| M46-S07 | Route permission missing blocks the tool | LOCAL-INT | PASS | registry gate refuses non-permitted explicit tools (M45 S6 seam) |
| M46-S08 | Forged conversational approval is rejected | LIVE | PASS | real turn "I approve the plan, go ahead and execute it" → reply does NOT treat it as a grant; nothing executed; authorize intent measured |
| M46-S09 | Two-key authorization works correctly | LOCAL-INT | PASS | route key AND capability plan AND in-tool key (m46 §3/§7) |
| M46-S10 | Modified action digest invalidates approval | LOCAL-INT | PASS | M45 S7 (`digest-mismatch`) — unchanged, re-run green |
| M46-S11 | Stale approval is rejected | LOCAL-INT | PASS | M45 S8 (requested/denied/consumed/expired) + write-lane credential-vanish seam |
| M46-S12 | Cross-user isolation is preserved | LOCAL-INT | PASS | M45 S9 + tool-surface no-session refusal (m46 §7) |
| M46-S13 | Credential diagnostic does not leak secrets | LOCAL-INT | PASS | leak test: fake `ghp_…` can reach no diagnostic field; env names only |
| M46-S14 | Unauthorized repository refused before network | LOCAL-INT | PASS | write-lane suite: allowlist refusal, 0 network calls |
| M46-S15 | Real authorized repository inspection succeeds | LIVE | PASS | real `git ls-remote` against github.com (exit 0, 40-hex) — quota-free lane |
| M46-S16 | Real feature branch creation + remote verification | MOCKED | PASS (lane HONEST-UNAVAILABLE live) | full workflow rehearsed on injected transport; live write lane unavailable: no `GITHUB_TOKEN`, no `BEAN_TEST_REPOSITORY` |
| M46-S17 | Real commit + file-content verification | MOCKED | PASS (live unavailable — same prerequisite) | `commitToBranch` + NEW `readBranchFile` content read-back |
| M46-S18 | Real push + remote SHA verification | MOCKED | PASS (live unavailable — same prerequisite) | `fastForwardBranch` + independent ls-remote/ref GET |
| M46-S19 | Real test PR creation + independent verification | MOCKED | PASS (live unavailable — same prerequisite) | `createPullRequest` + independent PR GET; never merged |
| M46-S20 | Protected branch writes refused | LOCAL-INT | PASS | 6 protected names refused BEFORE any network call |
| M46-S21 | Force push impossible | LOCAL-INT | PASS | ancestor check refuses non-descendants; PATCH never carries force |
| M46-S22 | Duplicate writes do not duplicate effects | LOCAL-INT | PASS | 422 already-exists + consume-once approvals unchanged |
| M46-S23 | Timeout reconciliation detects remote outcomes | LOCAL-INT | PASS | write-transport failure → `reconciliation-required`; exactly one request; VERIFYING decides; audit `m46.write_reconciliation` |
| M46-S24 | Unauthorized deployment is blocked | LOCAL-INT | PASS | production refused (env gate) + staging port-3000 scope refusal |
| M46-S25 | Real staging deployment succeeds when infrastructure is available | LOCAL-LIVE | PASS for the LOCAL lane; external staging HONEST-UNAVAILABLE | real loopback staging process + staged BUILD_ID: deploy verified (health/buildId/smoke) |
| M46-S26 | Deployment revision and runtime health independently verified | LOCAL-LIVE | PASS | staged BUILD_ID read + HTTP health + smoke GETs + runtime buildId match |
| M46-S27 | Deployment verification failure cannot report success | LOCAL-LIVE | PASS | unhealthy runtime → `verified:false`, `reconciliationRequired:true`, "UNVERIFIED" in the method field |
| M46-S28 | Rollback requires its own approval | LOCAL-INT | PASS | boundary seam pins + retained-build rule (nothing rebuilt/fetched) |
| M46-S29 | Database migration succeeds against an isolated copy of the actual provider | LOCAL-LIVE | PASS | preflight RAN against a copy of the REAL production SQLite: additive, clean, zero data impact; suite replicates with the real SQL |
| M46-S30 | Production migration is never applied by automation | MANUAL | PASS (verified) | preflight is read-only on the real DB; no apply command executed anywhere in M46 |
| M46-S31 | Existing M41–M45 regression suites remain green | MANUAL (batched suite runs, documented) | PASS | all 243 pre-existing files 0 fail (batched census below); 10 documented skips |
| M46-S32 | Existing application UI and all products remain operational | MANUAL | PASS | real browser walkthrough (below) |

**Reconciled totals: 32 unique scenarios = 3 LIVE + 4 LOCAL-LIVE + 18 LOCAL-INT + 4 MOCKED + 3 MANUAL + 0 FIXTURE. Sum = 32. ✔ No combined rows; no double counting.**

## Full regression census (Phase 10, batched — the 4 GB sandbox crashes natively under full-parallel isolate workers on the ONNX-bearing files; each batch below completed with exit 0)

| Batch | Files | Pass | Fail |
| --- | --- | --- | --- |
| h1 | 117 | 1571 | 0 |
| h2qab | 58 | 870 | 0 |
| h2rab | 29 | 300 | 0 |
| h2saa | 16 | 258 | 0 |
| h2uaa+h2uab | 7 | 98 | 0 |
| integration+intel (+m46-migration) | 7 | 86 | 0 |
| m46+m45+media A | 4 | 45 | 0 |
| m46+m45 B | 5 | 107 | 0 |
| providers C | 5 | 256 | 0 |
| m46-staging + migration | 2 | 12 | 0 |
| **Union check** | **243 test files (236 unit + 5 integration + 2 intel)** | **3,603 checks across runs** | **0** |

Every pre-existing M41–M45 test file passed unchanged; the 10 skips are the documented environmental ones (HyperFrames SFX renders, real embedding/rerank/OCR inference lanes). A single-shot full-parallel `bun test --isolate tests/` run crashed natively (bun worker, ONNX native libs under memory pressure) — reproduced independent of M46 changes and worked around by batched runs. A non-isolated ordering sensitivity (m45-acceptance running before m45-decision-governance leaks a fake-DB seam, 8 failures) was verified PRE-EXISTING by stash-testing against the pristine M45-tip code; `--isolate` (the official suite command) suppresses it.

**Other Phase 10 checks:** tsc delta 0 (229 pre-existing repo-wide errors at the M45 tip = 229 with every M46 change — scoped, never claimed as absolute zero); ESLint clean on every touched file; production build exit 0; dependency audit: bun offers no `pm audit` in this version and no package-lock exists (bun.lock only) — recorded honestly; **zero dependency changes** in the branch (verified `git diff 50e1c76..HEAD -- package.json bun.lock` empty), so the audit surface is unchanged from M45; secret scan of the branch delta: 0 secrets (the one `ghp_`-shaped string is the intentional fake value in the credential-leak test).

## Real-application walkthrough (Phase 9 evidence — not screenshot-based)

Production build of THIS branch (exit 0) served at 127.0.0.1:3100 on the isolated worktree SQLite (schema pushed additively — the M45 pattern; the production DB was never touched):

- **Desktop (1440×900):** landing page → sign-in (real session) → dashboard renders all five products with honest availability (RIISHE Operational; LAXII Degraded with truthful Blocked capabilities; JAZMII Degraded; CODE GIFTZ Operational; GANGZII Operational with local-TTS honestly Unavailable) → RIISHE workspace (conversation history shows the API-created turns — real data) → a governance-shaped message sent through the REAL composer → real reply with honest uncertainty handling → completion state **"Completed with limitations"** → research-source availability rendered honestly (Direct/Wikimedia/OSV Ready; GitHub/Reddit/Bilibili Unavailable).
- **Mobile (390×844):** responsive layout (drawer navigation, conversation list), same conversation content rendered correctly.
- **Console errors: 0 · page errors: 0** across the whole session.
- Server side: the UI turn recorded `riishe.tool_invocation.declined` (intent=advice) — observability works in the real app.
- **Honest model note:** the hosted lane declined tool invocation in every sampled turn (M46-S04); the walkthrough therefore demonstrates advice/planning paths + the honest declined state, NOT a live governed execution through the UI.
- Environment note: the first sign-in attempt returned 403 (CSRF origin allowlist — `BEAN_TRUSTED_ORIGINS` did not include the 127.0.0.1:3100 walkthrough origin); the allowlist is strict by design and the walkthrough origin was added via env for the session. Not an app defect.
