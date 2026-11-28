# M47 BASELINE — Native Tool Calling & Live Operations Activation

Milestone: M47.0 (baseline reconciliation and infrastructure readiness)
Date: 2026-11-28 (Asia/Calcutta)
Working branch: `feat/m47-native-tool-operations-activation`
Method: every fact below was re-measured in this session against the live remote, the actual source tree and this runtime environment. Historical M46 records are carried forward only where re-verified.

---

## 1. Verified repository state

| Item | Value | How verified |
| --- | --- | --- |
| `origin/main` | `0e3dcbf95a817fa050f3f8c1c503cd979c62da7d` | `git fetch origin --prune`; `git rev-parse origin/main` |
| M46 final SHA | `c881430e65052fc7d4c75d20ac264551eb441f49` | `git merge-base --is-ancestor` → YES (ancestor of origin/main) |
| M46 PR | #39 | `git ls-remote origin refs/pull/39/head` → `c881430…` (head = M46 final SHA) |
| M46 merge commit | `0e3dcbf` = origin/main HEAD | `git log origin/main -1` → "Merge pull request #39 from …/feat/m46-production-readiness-live-operations" |
| M47 branch before this work | absent on remote | `git ls-remote origin "refs/heads/feat/m47*"` → empty (matches preparation notes) |
| M47 branch now | created from `origin/main` at `0e3dcbf` | linked worktree `m47-wt` |
| Local stale main | `01f39d7` (1 ahead / 94 behind origin/main) | untouched; the watchdog owns the primary worktree |

Sandbox notes: the sandbox was recycled; the previous session's dev server (`next-server` + postcss worker) was found holding ~1.4 GB and was terminated before type-checking (it served the stale tree, not this branch). The zcode-driver watchdog (`/app/zcode-driver/main.mjs`) is ACTIVE, so all M47 work happens in the linked worktree `/home/z/my-project/m47-wt` (never in the primary checkout). A stale `.m33-cg` worktree registration was pruned (`git worktree prune`).

`node_modules` in `m47-wt` is a symlink to the primary checkout's installed tree; `package.json` and `bun.lock` were verified byte-identical between the two trees before linking.

## 2. M46 carry-forward findings — re-verified in source

| M46 documented finding | Re-verified | Evidence (source of truth) |
| --- | --- | --- |
| All chat lanes ran the RIISHE text tool protocol; no native function calling | TRUE at M46 tip; now SUPERSEDED by new measured evidence (§4) | `src/lib/riishe/tool-invocation.ts` (`ToolProtocolKind = 'text' \| 'none'`; the `'native'` verb is explicitly documented as absent); `src/lib/riishe/toolloop.ts` (`TOOL_CALL:` line protocol) |
| M46 invocation experiment: 4 hosted-lane turns, 0 model tool calls; advice-first behavior measured honestly | carried forward as history; the per-turn decline ledger exists | `tool-invocation.ts` ledger + `orchestrator.ts` wiring (`riishe.tool_invocation.declined`) |
| GitHub write adapter requires `GITHUB_TOKEN` + `BEAN_TEST_REPOSITORY` | TRUE (names + semantics in source) | `src/lib/riishe/mission/repository-adapter.ts` lines 70–82 (`BEAN_TEST_REPOSITORY` explicit config only, production repo never assumed disposable), line 193 (`GITHUB_TOKEN`) |
| Neither GitHub prerequisite configured in M46 environment | STILL TRUE in this environment | runtime env check (§3): both UNSET |
| Local staging lane config: `BEAN_STAGING_ROOT`, `BEAN_STAGING_BASE_URL`, `BEAN_STAGING_DEPLOY_TOKEN`; external: `BEAN_DEPLOY_PROVIDER`, `BEAN_DEPLOY_TOKEN` | TRUE (names verified) | `src/lib/riishe/mission/deployment-adapter.ts` lines 93, 191–192, 216, 256–258 (`stagingLaneConfig()` refuses honestly until configured) |
| External staging provider unavailable | STILL TRUE | runtime env check (§3): both UNSET |
| Additive SQLite migration prepared; production apply is owner-operated | present in tree | `prisma/migrations/20261128_m46_execution_decision_additive/migration.sql`; `scripts/m46-migration-preflight.py` |
| M46 reported 229 pre-existing repo-wide TypeScript errors, delta 0 | fresh measurement differs — see §5 (environment delta, resolved honestly) | full `tsc --noEmit` at the pristine M46 merge tree |

## 3. This runtime's credential/configuration availability (names only — values never read or printed)

| Variable | State | Consequence for M47 |
| --- | --- | --- |
| `DATABASE_URL` | SET (SQLite `file:`) | app database present; migration work stays additive + owner-operated |
| `GITHUB_TOKEN` | UNSET | live GitHub write lane = HONEST-UNAVAILABLE |
| `BEAN_TEST_REPOSITORY` | UNSET | live GitHub write lane = HONEST-UNAVAILABLE (adapter refuses without a dedicated integration repository) |
| `BEAN_REPO_ALLOWLIST` | UNSET | adapter public-read fallback applies per its own rules |
| `BEAN_STAGING_ROOT` / `BEAN_STAGING_BASE_URL` / `BEAN_STAGING_DEPLOY_TOKEN` | UNSET (all three) | local staging lane refuses honestly until configured |
| `BEAN_DEPLOY_PROVIDER` / `BEAN_DEPLOY_TOKEN` | UNSET | external staging = HONEST-UNAVAILABLE |
| `BEAN_PROVIDER_OPENAI_API_KEY` | UNSET | `bean-llm-openai-compatible` dormant |
| `BEAN_PROVIDER_ANTHROPIC_API_KEY` | UNSET | `bean-llm-anthropic` dormant |
| `BEAN_LLAMACPP_BASE_URL` (+ `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS`) | UNSET | `bean-chat-local-llamacpp` dormant |
| `BEAN_PRODUCTION_DEPLOY_ENABLED` | UNSET | production deployment gate closed (correct default) |

**Exactly one chat lane is enabled in this runtime: `bean-llm-hosted-primary` (the authorized hosted gateway via z-ai-web-dev-sdk).** Everything that follows about live tool-calling therefore concerns that lane; the other three lanes stay honestly dormant until an operator configures them.

## 4. NEW MEASURED EVIDENCE — native tool calling on the hosted lane (M47's decisive baseline fact)

M46 recorded "all three chat lanes are text-protocol; none exposes native function calling". That statement was TRUE of M46's knowledge (no native path was implemented and no live probe had been run), but M47 Phase 1 requires inspecting actual contracts and MEASURING actual responses. Probe script: `scripts/m47-native-tool-probe.ts` (committed with this baseline). Run: 2026-11-28, four real hosted-gateway calls.

| Probe | Request | Measured result |
| --- | --- | --- |
| 1 — non-streaming + `tools` + `tool_choice:'auto'` | trivial read-only probe tool `get_probe_time` | **ACCEPTED; genuine native tool call emitted.** `finish_reason=tool_calls`; message = `{content, role, tool_calls}`; `tool_calls[0] = {function:{arguments:"{\"unit\":\"iso\"}", name:"get_probe_time"}, id:"call_-7037995266791700821", index:0, type:"function"}`. Arguments were schema-shaped (the enum value was supplied), identifiers are OpenAI-style `call_…` strings. Top-level response keys include `usage` (real token reporting available). |
| 2 — control (no `tools` param) | same prompt | normal completion (`finish=stop`); the model did NOT spontaneously emit `TOOL_CALL:` text-protocol syntax. Confirms the M46 observation was a protocol-availability gap, not model refusal. |
| 3 — tool-result round-trip | feed `{role:'tool', tool_call_id, content}` back with the assistant's `tool_calls` turn | **ACCEPTED** (`finish=stop`): the model consumed the tool result and produced the final answer; no spurious follow-up calls. Multi-turn native tool conversations WORK on this lane. |
| 4 — streaming + `tools` | same request with `stream:true` | **NOT USABLE**: the stream completed with zero observable deltas (no text deltas, no tool-call deltas, no finish reason). Streaming tool-calls must be treated as UNSUPPORTED on this lane; native tool turns must run buffered/non-streaming (which the existing tool loop already does — M46 confirmed tool passes are buffered). |

**Capability conclusion (measured, not assumed):** the hosted lane supports provider-native tool calling in NON-STREAMING requests, including multi-turn result round-trips and preserved tool-call identifiers; streaming native tool calls do not work and must not be attempted. This makes M47's core goal — a supported model genuinely emitting a native tool call through RIISHE — achievable on the real configured lane.

## 5. TypeScript baseline (fresh, this environment)

Full `npx tsc --noEmit -p tsconfig.json` at the pristine M46 merge tree (`0e3dcbf`), before any M47 change:

- **234 errors total** — scripts/ 153, validation/ 17, src/ 30, tests/ 34 (census retained in-session for per-milestone delta runs).
- M46 recorded **229** "pre-existing repo-wide errors" on its environment. The +5 delta is an ENVIRONMENT difference (this recycled sandbox + the symlinked node_modules tree), measured before any M47 change exists. M47's regression rule is therefore: **zero NEW errors measured as a delta against this fresh 234-error baseline on THIS environment** (same command, same tree state), not against the historical 229. This is stated explicitly so no milestone report ever compares counts taken on different environments.

The two largest clusters (`scripts/fulltest/*`, `validation/m40-rtx/*`) are pre-existing non-app trees; the largest in-app cluster is `src/lib/riishe/mission/store.ts` (14 errors, introduced pre-M46).

## 6. Test suite baseline

- 243 `*.test.ts` files (`tests/unit` + `tests/integration`) — matches M46's recorded census of 243 files.
- Known environmental constraints carried forward from M46: full-parallel isolated runs crash the 4 GB sandbox on ONNX-bearing files (reproduced independent of code changes) → batched runs remain the documented strategy; the M45 acceptance ordering leak (suppressed by `--isolate`) remains documented as pre-existing.
- Full-suite regression runs happen at each M47 milestone's verification step; the exact executed-file count is reported per milestone.

## 7. Infrastructure readiness summary (M47 lanes)

| M47 capability | State on this baseline | Missing prerequisites |
| --- | --- | --- |
| Provider-native tool calling (hosted lane) | READY — measured working (non-streaming) + measured streaming limitation | none |
| Provider-native tool calling (openai-compatible lane) | HONEST-UNAVAILABLE (`unknown` capability) | operator credential `BEAN_PROVIDER_OPENAI_API_KEY` (+ optional base URL / model) |
| Provider-native tool calling (anthropic lane) | HONEST-UNAVAILABLE (`unknown` capability) | operator credential `BEAN_PROVIDER_ANTHROPIC_API_KEY` |
| Provider-native tool calling (llamacpp lane) | HONEST-UNAVAILABLE (`unknown` capability) | `BEAN_LLAMACPP_BASE_URL` + `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` + a running llama-server |
| Real GitHub write workflow | HONEST-UNAVAILABLE (implementation complete from M46, tested via controlled transport) | least-privilege `GITHUB_TOKEN` + dedicated `BEAN_TEST_REPOSITORY`; never requested or invented through chat |
| Real local staging deployment | HONEST-UNAVAILABLE (lane implemented from M46; refuses honestly until configured) | `BEAN_STAGING_ROOT` + `BEAN_STAGING_BASE_URL` (explicit port ≠ 3000) + `BEAN_STAGING_DEPLOY_TOKEN` |
| External staging provider | HONEST-UNAVAILABLE | `BEAN_DEPLOY_PROVIDER` + `BEAN_DEPLOY_TOKEN` |
| Production deployment | disabled by design (`BEAN_PRODUCTION_DEPLOY_ENABLED` unset) | intentionally not a target for M47 |

## 8. Unresolved blockers / owner-operated requirements (unchanged from M46, restated)

1. Live GitHub writes need an owner-configured least-privilege credential and a dedicated, disposable integration repository (`BEAN_TEST_REPOSITORY`). Credentials are never requested through chat and never invented.
2. Real staging deployments need the staging lane environment configured (local) or a genuine external provider (external). The two are never conflated.
3. Production migration of `ExecutionDecision` remains an owner-operated apply (additive path reviewed and rehearsed in M46).
4. Streaming native tool calls are unsupported on the hosted lane (measured §4); the architecture must keep tool turns buffered.
5. Dependency audit tooling remains unavailable in-sandbox; zero dependency changes is the standing policy.

## 9. M47 phase → milestone mapping (delivery plan)

| Milestone | Scope |
| --- | --- |
| M47.0 (this commit) | baseline reconciliation + infrastructure readiness + the live capability probe |
| M47.1 | provider-native tool-calling capability registry (`native` / `text-protocol` / `unsupported` / `unknown` / `temporarily-unavailable`), per-model honesty, diagnostics |
| M47.2 | native provider tool-call adapters + execution protocol inside the existing gateway/tool loop (no second executor) |
| M47.3 | reliable RIISHE conversational invocation + per-turn invocation records (the M47 Phase 3 field set) |
| M47.4 | secure GitHub credential activation + real write workflow (HONEST-UNAVAILABLE until owner configures) |
| M47.5 | real staging deployment activation + independent verification (local lane first; external stays honest-unavailable) |
| M47.6 | complete conversational-to-execution acceptance suite + recovery validation |
| M47.7 | regression, Preview walkthrough, documentation set, final publication report |

Standing rules restated: work only on `feat/m47-native-tool-operations-activation`; no merge into main without separate owner authorization; every milestone ends IMPLEMENTED + TESTED + COMMITTED + PUSHED + REMOTE-SHA-VERIFIED; never force-push; never simulate a live capability or describe an unavailable integration as operational.
