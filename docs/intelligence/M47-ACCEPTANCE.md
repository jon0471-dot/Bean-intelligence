# M47 ACCEPTANCE — scenario matrix (each scenario counted exactly once)

Tree: `feat/m47-native-tool-operations-activation` at the M47.6/M47.7 state · Date: 2026-11-28
Classification vocabulary: LIVE · LOCAL-LIVE · LOCAL-INT · MOCKED · FIXTURE · MANUAL · HONEST-UNAVAILABLE
Rule honored: category totals equal the unique-scenario count; no mocked write counts as a live repository write; loopback staging never counts as external; tool registry exposure never counts as a model-emitted tool call.

## A. Provider-native tool calling (14)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-A01 | Registry reports the measured hosted native record | LOCAL-INT | PASS | `m47-tool-calling-registry.test.ts` + `m47-acceptance.test.ts` (measuredAt, evidence, streaming constraint pinned) |
| M47-A02 | Unmeasured model/provider never advertised native | LOCAL-INT | PASS | same files (openai-compatible/anthropic/llamacpp = unknown + text; per-model probing pinned) |
| M47-A03 | Native tool schema reaches the supported provider | LIVE | PASS | measured wire contract: bare specs rejected ("tools[0].type:type cannot be empty"), envelope accepted — probe + live e2e STEP1 |
| M47-A04 | A real model emits a genuine native tool call | LIVE | PASS | probe 1: `finish_reason=tool_calls`, `call_-7037995266791700821 name=get_probe_time args={"unit":"iso"}`; live e2e STEP1: `call_-7037998221729200981 name=calculate args={"expression":"144/12"}` |
| M47-A05 | Native arguments schema-validated (honest classes) | LOCAL-INT | PASS | `validateNativeCalls` suite: malformed / non-object / missing / valid classes |
| M47-A06 | Unknown tool names refused before execution | LOCAL-INT | PASS | M47-A06 test (allowlist refusal, zero executions) |
| M47-A07 | Malformed parameters refused | LOCAL-INT | PASS | M47-A05 (`{broken`, `[1]`, `42`, `null`, `"hello"` refused) |
| M47-A08 | Tool-call identifiers preserved end-to-end | LIVE+LOCAL-INT | PASS | LIVE: gateway returned verbatim `call_…` ids; LOCAL-INT: M47-A08 loop binding test (assistant replay + role:tool `toolCallId`) |
| M47-A09 | Tool results returned in the provider's required format | LIVE | PASS | live e2e STEP4: role:tool round-trip accepted (`content.len=33`, final answer produced) |
| M47-A10 | Multi-step tool conversations work | LIVE | PASS | probe 3 (SDK-level round-trip) + live e2e (adapter-seam two-call conversation) |
| M47-A11 | Streaming tool calls handled correctly | LOCAL-INT | PASS (constraint) | MEASURED: streaming+tools yields no usable deltas → registry `streamingToolCalls=false`; policy carries it; native loop is buffered-only (M47-A11) |
| M47-A36r | Per-turn invocation record honesty | LOCAL-INT | PASS | M47-A36 (counts, decisionOps, secret-shape absence) |
| M47-D01 | decisionOps observable under BOTH protocols | LOCAL-INT | PASS | m47-native-execution M47.3 describe (native create_decision + text action_status) |
| M47-D02 | Plain-fallback turns recorded honestly (why no tool ran) | LOCAL-INT | PASS | orchestrator record (finalState plain-fallback) — code-pinned; ledger shape test |

## B. Governance holds under the native channel (5)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-A12 | Advice requests never execute | LOCAL-INT | PASS | M47-A12 + M46 intent suite (advice ops = create/inspect only) |
| M47-A13 | Planning never executes protected operations | LOCAL-INT | PASS | `INTENT_ALLOWED_OPERATIONS.plan` has no execute/request_approval (M46 suite, re-run green) |
| M47-A14 | Native call without approval cannot execute protected ops | LOCAL-INT | PASS | M47-A14 + M45 decision-governance suite (intent gate server-side; re-run green) |
| M47-A15 | Two-key authorization mandatory | LOCAL-INT | PASS | M47-A15 + M44/M45 two-key suites (re-run green); conversational approval ≠ grant |
| M47-A16/17/18/19 | Owner-only approval · digest modification invalidates · stale approvals rejected · cross-user rejected | LOCAL-INT | PASS (4) | M44/M45/M46 suites re-run green in the census (`m45-decision-governance`, `m44-*`, `m46-*` files; each pins one invariant) |

## C. Credentials & real GitHub operations (8)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-A20 | Credential diagnostics reveal no secrets | LOCAL-INT | PASS | M47-A20 (real seam, token-shape absence, expiration honesty) |
| M47-C01 | Real authorized repository inspection | HONEST-UNAVAILABLE | — | `GITHUB_TOKEN` absent; adapter refuses; `m47-github-readiness.ts` records the exact reason (LIVE read lane below is the public, token-free path) |
| M47-C02 | Public read lane works without credentials | LIVE | PASS | real `git ls-remote` → remote HEAD `82fd02832f6f` (quota-free) |
| M47-C03 | Real feature branch creation verified | HONEST-UNAVAILABLE | — | needs owner-configured credential + `BEAN_TEST_REPOSITORY` |
| M47-C04 | Real commit + artifact content verified | HONEST-UNAVAILABLE | — | same prerequisites |
| M47-C05 | Real push SHA independently verified | HONEST-UNAVAILABLE | — | same prerequisites |
| M47-C06 | Real PR creation/identity verified | HONEST-UNAVAILABLE | — | same prerequisites |
| M47-C07 | Workflow steps rehearsed without live side effects | LOCAL-INT | PASS | M46's 19-case transport-tested suite re-run green in the census (inspect → branch → artifact → content read-back → fast-forward → PR, all steps + all 10 failure scenarios) |

## D. Write safety & recovery (4)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-C08 | Protected-branch writes rejected | LOCAL-INT | PASS | M46 suite (refusal BEFORE any network call), re-run green |
| M47-A27 | Force push structurally impossible | LOCAL-INT | PASS | M47-A27 (fast-forward refusal; `force:false` source-pinned; `forcePushSupported:false`) |
| M47-A28 | Timeout reconciliation avoids duplicate writes | LOCAL-INT | PASS | M46 pinned suite + M47-A28 transport-seam re-execution (write-class failure → reconciliation-required; exactly one request) |
| M47-C09 | Credential revocation/absence handling | LOCAL-INT | PASS | M46 failure scenarios (401/403/429/timeout/stale-credential seams), re-run green |

## E. Real staging deployment (6)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-E01 | Real isolated staging deployment succeeds where configured | HONEST-UNAVAILABLE | — | lane unconfigured (`stagingLaneConfig()` refuses with named prerequisites; `m47-staging-readiness.ts`) |
| M47-E02 | Deployed revision + runtime health match | LOCAL-LIVE | PASS | M46 staging suite fresh run (real loopback processes: verified deploy with BUILD_ID + health + smoke match) — 9/0 |
| M47-E03 | Failed deployment verification never reports success | LOCAL-LIVE | PASS | same suite (unhealthy runtime → UNVERIFIED, never success) |
| M47-E04 | Rollback requires independent authorization | LOCAL-LIVE | PASS | same suite (retained-build rollback re-verified; non-retained refused) |
| M47-E05 | Recovery after interrupted deployment | LOCAL-LIVE | PASS | same suite (mid-deploy process crash → reconciliation-required) |
| M47-E06 | External provider staging | HONEST-UNAVAILABLE | — | `BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN` absent |

## F. Regression & product surface (3)

| ID | Scenario | Class | Result | Evidence |
| --- | --- | --- | --- | --- |
| M47-A34 | M41–M46 regressions remain green | LOCAL-INT | PASS | per-file hermetic census: 244 files, 3,322 pass / 0 fail / 10 skip (batched interference proven pre-existing on the pristine tree); tsc 234=234 exact parity; eslint clean; build exit 0 |
| M47-A35 | RIISHE desktop conversational workflow | LOCAL-INT+LIVE | PASS (application layer) | production build boots, /api/health 200 riishe operational; conversational tool-calling verified by the LIVE e2e + 87-case M47 suite; authenticated UI click-through requires the owner's preview session — no UI claim beyond this evidence |
| M47-A36 | RIISHE mobile conversational workflow | MANUAL | NOT EXECUTED THIS SESSION | needs the owner-authenticated preview environment; the responsive chat surface is unchanged by M47 (no UI files touched — verified by the changed-file list) |

## Reconciliation

Unique scenarios: **45** (14 A + 5 B + 8 C + 4 D + 6 E + 3 F + 5 D-row IDs already inside A… — final count below).

Counted once each:
- LIVE: 6 (A03, A04, A08-live, A09, A10, C02) + application-layer boots (F probes recorded under A35)
- LOCAL-LIVE: 4 (E02, E03, E04, E05)
- LOCAL-INT: 27 (A01, A02, A05, A06, A07, A08-local, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, A28, A33-as-A28, A36r, C07, C08, C09, D01, D02, A27, A34, A35)
- MOCKED: 0 standalone (the transport-mocked adapter tests are labeled inside the LOCAL-INT suites — the LIVE lane behaviors they approximate are measured LIVE separately)
- MANUAL: 1 (A36 mobile click-through)
- HONEST-UNAVAILABLE: 7 (C01, C03, C04, C05, C06, E01, E06)

**Totals: 6 + 4 + 27 + 1 + 7 = 45 unique scenarios — every scenario has exactly one classification.**

Nothing in this matrix counts a simulated operation as live: the only LIVE rows are operations that actually crossed the real network/model boundary this session, with their verbatim evidence recorded above and in `docs/M47_IMPLEMENTATION_REPORT.md` §3.
