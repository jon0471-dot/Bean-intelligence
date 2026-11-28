# M47 IMPLEMENTATION REPORT — Native Tool Calling & Live Operations Activation

Milestone set: M47.0 → M47.7 · Date: 2026-11-28 (Asia/Calcutta) · Branch: `feat/m47-native-tool-operations-activation`

## 1. Verified starting state

- Baseline `origin/main`: `0e3dcbf95a817fa050f3f8c1c503cd979c62da7d` (PR #39 merge; head verified via `git ls-remote refs/pull/39/head` = `c881430` = M46 final SHA; ancestry check passed). Full detail: `docs/M47_BASELINE.md`.
- Mid-session the OWNER merged PR #40 (the M47 branch at tip `a57de84`, covering M47.0–M47.2) into main themselves: `origin/main` is now `82fd028` = "Merge pull request #40". BEAN performed no merge. The working branch continued independently (`95620d9` → `9b35963` → …) as a normal fast-forward continuation; no rebase, no force-push.

## 2. Commit trail (local = remote-verified after every push)

| SHA | Milestone | Content |
| --- | --- | --- |
| `8b5e486` | M47.0 | baseline reconciliation + infrastructure readiness + the 4-probe live capability measurement (`scripts/m47-native-tool-probe.ts`) |
| `cf1fa7b` | M47.1 | provider-native tool-calling capability registry (five evidence states, registry-authoritative runtime selection, admin diagnostics) |
| `a57de84` | M47.2 | native tool-call execution protocol (adapter seam, hosted + openai-compatible adapters, protocol-aware tool loop, orchestrator wiring) |
| `95620d9` | M47.2 fix | 6 test-only type errors fixed; tsc record corrected honestly (240 → 234, exact location parity) |
| `9b35963` | M47.3 | per-turn invocation records (identities + counts + decisionOps, honest plain-fallback records) |
| `dc02839` | M47.4 | GitHub credential activation readiness evidence + owner-merge observation recorded |
| `7b91cc6` | M47.5 | staging readiness evidence + refreshed LOCAL-LIVE staging proof |
| `abb103d` | M47.6 | uniquely-identified 13-scenario acceptance suite |
| (this commit) | M47.7 | documentation set, final regression census, build + preview probes |

Every push was verified with `git ls-remote origin refs/heads/feat/m47-native-tool-operations-activation` returning the exact local HEAD.

## 3. The decisive M47 evidence — native tool calling is REAL and measured

1. **Probe (M47.0)**, 4 real hosted-gateway calls: genuine native `tool_calls` emitted (`finish_reason=tool_calls`, OpenAI-style `call_…` ids preserved verbatim, schema-shaped arguments); `role:'tool'` result round-trip accepted; control turn shows no spontaneous text-protocol emit; **streaming with tools produces no usable deltas** (hard constraint: native tool turns are buffered-only).
2. **Wire contract discovered live (M47.2)**: bare `{name,description,parameters}` tool entries are rejected (`tools[0].type:type cannot be empty`) → `nativeToolsToWire()` produces the measured `{type:'function',function:{…}}` envelope (test-pinned).
3. **LIVE end-to-end (M47.2)**, `scripts/m47-live-native-e2e.ts` through the REAL adapter seam + REAL governed registry: model emitted `call_-7037998221729200981 name=calculate args={"expression":"144/12"}` → governed validation accepted → real execution `144/12 = 12` → role:tool round-trip → final answer "144 divided by 12 equals **12**." PASS.

## 4. Changed files (M47 delta vs `0e3dcbf`, docs included)

- `src/lib/riishe/tool-invocation.ts` — capability registry (states, descriptors, policy, diagnostics, M47.3 record fields)
- `src/lib/adapters/types.ts` — NativeToolSpec / NativeToolCall / nativeToolCallToWire / nativeToolsToWire; ChatTurn role 'tool' + nativeToolCalls + toolCallId; ChatRequest.nativeTools; ChatResult.nativeToolCalls
- `src/lib/adapters/hosted-llm.ts` — native tools passthrough + tool_calls parsing + native message shapes (measured envelope)
- `src/lib/providers/openai-compatible.ts` — same passthrough/parsing (dormant until configured AND measured)
- `src/lib/providers/anthropic.ts` — defensive conversion of misrouted native turns (no crash, honest label)
- `src/lib/riishe/toolloop.ts` — protocol-aware loop: native validation classes, governed execution of every accepted call, role:tool results, decisionOps/nativeCallsEmitted observability, loud failure on native-without-solver
- `src/lib/riishe/orchestrator.ts` — loopProtocol resolution, buffered-only native solve passes, NATIVE prompt protocol, full per-turn records + plain-fallback records
- `src/lib/riishe/prompts.ts` — NATIVE_TOOL_PROTOCOL (wire syntax honest to the protocol; every honesty rule unchanged)
- `src/lib/riishe/tools/{types,registry}.ts` — optional inputSchema + nativeToolSpecs builder
- `src/lib/ai-gateway/gateway.ts` — toolCalling projection in the admin models overview
- Tests: `tests/unit/m47-tool-calling-registry.test.ts` (15), `tests/unit/m47-native-execution.test.ts` (22), `tests/unit/m47-acceptance.test.ts` (13) + updated M46 suite
- Scripts: `m47-native-tool-probe.ts`, `m47-live-native-e2e.ts`, `m47-github-readiness.ts`, `m47-staging-readiness.ts`, regression runners
- Docs: `docs/M47_BASELINE.md` (+ addendum), this report, and the `docs/intelligence/M47-*.md` set

## 5. Security results

- The native channel changes NOTHING about authorization: registry allowlist → validate() → permission keys → capability-plan → route permission → M44 Trust Engine → digest-bound owner approval all remain server-side and run identically under both protocols (pinned: M47-A12/A14/A15, plus the full M44/M45/M46 governance suites re-run green).
- A native tool call is untrusted input: pre-execution refusal classes (tool-not-enabled / malformed-arguments / missing-call-identity) are enforced in `validateNativeCalls` with every refused id still answered (M47-A06, M47-A05).
- Credentials: zero tokens read, printed or committed; `GITHUB_TOKEN`/`BEAN_TEST_REPOSITORY`/staging/provider env names checked for PRESENCE only; diagnostics leak-proofness pinned (M47-A20); the one `ghp_`-shaped string in the tree is M46's intentional fake in the credential-leak test.
- Secret scan of the branch delta: clean.

## 6. Regression results (exact numbers)

- **TypeScript**: fresh baseline at the pristine M46 tree = 234 errors (scripts 153 / validation 17 / src 30 / tests 34; census retained in-session). M47 final = **234 / 234 with exact per-file:line parity** — zero new errors. (The M46-recorded 229 differed by +5 on environment; documented in the baseline. One commit message briefly claimed delta 0 before measuring — corrected in `95620d9` with the actual numbers.)
- **Test suite (per-file hermetic strategy)**: **244 test files** (`tests/unit` 239 + `tests/integration` 5) executed individually — **3,322 pass / 0 fail / 10 skip**. Batched multi-file runs reproduce a KNOWN pre-existing interference (mock.module leakage across files in one process: 159 failures in my 30-file chunks, byte-identical 223/41 on the pristine merge tree for the same chunk — proven pre-existing, not an M47 regression; the per-file strategy is the hermetic evidence).
- **Environmental**: the gitignored pinned MiniLM vocab was absent after the worktree setup; reinstalled via the manifest-pinned installer, SHA-256 `07eced375cec144d…` verified exact (the M46-documented pin), tokenizer suite then 7/0.
- **ESLint**: clean on every touched file (all 20+ files linted across milestones).
- **Production build**: exit 0 with a REAL node_modules install (Turbopack rejects a symlinked node_modules — documented environment note); standalone server copied + native libs staged.

## 7. Preview probes (this session, production server from the M47 tree)

- Standalone server boot on :3000: success; `/api/health` → HTTP 200 `{"ok":true,…,"products":{"riishe":{"status":"operational"},…}}`.
- `/api/v1/models` without credentials → correctly `UNAUTHENTICATED` (the auth gate holds; the toolCalling diagnostics projection is therefore not anonymously readable).
- Scope honesty: an authenticated desktop/mobile UI walkthrough (click-through + screenshots) requires the owner's login session in the preview environment; what THIS session proved at the application layer is the production boot, health, auth gates, and — at module level, through the committed suites and the live gateway e2e — the conversational tool-calling behavior itself. No UI claim beyond that evidence is made.

## 8. Live vs local vs mocked breakdown (headline)

- **LIVE** (real network/model operations, this session): 4 gateway probes, adapter-seam live e2e (emit → governed validation → real execution → verified round-trip), real `git ls-remote` read lane, real credential/staging diagnostic seams, production build + boot + health probes.
- **LOCAL-LIVE** (real local processes/fs): the M46 staging suite re-run fresh (real loopback staging processes, verified deploy/unhealthy/crash/rollback paths) — 9/0.
- **LOCAL-INT / MOCKED**: the 50 new M47 test cases (registry, loop, acceptance) with the transport-mocked adapter tests labeled MOCKED.
- **HONEST-UNAVAILABLE**: live GitHub write lane (`GITHUB_TOKEN` + `BEAN_TEST_REPOSITORY` absent — adapter refuses, readiness script records the exact missing prerequisites); configured staging lane (`BEAN_STAGING_ROOT`/`BEAN_STAGING_BASE_URL`/`BEAN_STAGING_DEPLOY_TOKEN` absent — lane refuses with named prerequisites); external staging (`BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN` absent). Full matrix: `docs/intelligence/M47-ACCEPTANCE.md`.

## 9. Owner configuration requirements (unchanged names, restated)

1. Live GitHub writes: least-privilege `GITHUB_TOKEN` + a dedicated disposable `BEAN_TEST_REPOSITORY` (never the production repo; never configured through chat).
2. Local staging: `BEAN_STAGING_ROOT` + `BEAN_STAGING_BASE_URL` (explicit port ≠ 3000) + `BEAN_STAGING_DEPLOY_TOKEN`.
3. External staging (optional): `BEAN_DEPLOY_PROVIDER` + `BEAN_DEPLOY_TOKEN`.
4. Other model lanes (optional): `BEAN_PROVIDER_OPENAI_API_KEY` / `BEAN_PROVIDER_ANTHROPIC_API_KEY` / `BEAN_LLAMACPP_BASE_URL` + `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` — each stays `unknown` until configured AND measured; native capability is never advertised from an unmeasured state.

## 10. Outstanding limitations

1. Streaming native tool calls are unsupported on the hosted lane (measured) — the architecture keeps tool turns buffered; a provider-side change would require re-probing (`scripts/m47-native-tool-probe.ts`) and a registry update.
2. `multiCallPerResponse` remains honestly unmeasured on the hosted lane (handled safely — the loop executes any bounded number of calls).
3. The openai-compatible/anthropic/llamacpp lanes carry dormant native wire support; they stay text-protocol at runtime until configured and measured.
4. Batched multi-file test runs interference (mock.module leakage) is a known bun test property of this repo; per-file runs are the hermetic strategy.
5. Production migration of `ExecutionDecision` remains an owner-operated apply (M46's additive path, unchanged).
