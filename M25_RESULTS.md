# M25 RESULTS — Intel Lanes + Intelligent Multi-File Refactoring (Recovery, Audit & Completion)

Milestone: BEAN Intelligence — M25 · Branch work: `m25-intel-lanes` · Published on `main`
Published commit: `ea73545304212cae9b59eb3353955a6b0a519ec3` (fast-forward push, remote-verified — §10)

## 1. Initial repository state and SHA

| Item | Value |
|---|---|
| Published baseline at session start | `3f40e758e1e7ffd0a84cb7fd4881715f949dc293` (local HEAD == `origin/main`, verified via `git ls-remote` after fetch) |
| Client-compute milestone (M22, do-not-reopen) | `d99e423` + M22 commit `3f40e75` — untouched except where a concrete M25 dependency required it (none did; zero client-compute files changed) |
| Recovered WIP in the working tree | 10 modified tracked files + ~89 untracked paths, restored verbatim from `backup/m22-wip-auto-commit` (`e396e42`, 202 files swept) by the M22 session |
| Additional WIP backup discovered | `backup/m25-intel-wip-auto-commit` (`5098143`, 204 files / 39,552 insertions swept post-M22; parent `3f40e75`) — preserved, never pushed |
| Prior-session quarantine | `backup/quarantine-m26-wip/` — quota-hold / recovery-watch / workspace-core / infra-hardening tests + fixtures moved OUT of `tests/` by the previous (cut-off) session so `bun run test` measures exactly the committed scope; implementations are other streams' untracked WIP (`src/lib/upstream/quota.ts`, `src/lib/workspace/*`) |
| Prior-session in-flight work | files edited 02:03–02:52 (`retrieval.ts`, `search-chain.ts`, `llamacpp.ts`, `assisted.ts`, `code-refactor-security.test.ts`, live harness) — the session was cut off mid-fix, one step before re-running the live harness |

## 2. Recovered WIP inventory

Two coherent M25 streams were identified in the WIP, both derived from repository
evidence (no requirements invented):

**Intel lanes stream** (`docs/ai/LOCAL-MODEL-LANES.md`, measured 2026-11-08 evidence in
`scripts/model-lanes-out/`): local llama.cpp GGUF model lanes for RIISHE chat and CODE
GIFTZ coding as the automatic fallback when the shared gateway is rate-limited — plus
the gateway-free research layer (gateway→SearXNG search chain, world grounding engine,
multilingual language analysis, Indic recency/officeholder policy signals, untrusted-data
framing, Crawl4AI extraction adapter).

**Refactoring stream** (`docs/M25-REFACTORING-AUDIT.md`, the repo's own "M25"): project
graph + static symbol index, refactoring-intent detection, `RefactorPlan` + hash-bound
atomic executor riding the existing `CodeFileOperation` ledger, provider-assisted
drafting with server-side validation, confirmation route + chat/UI card.

WIP state on arrival: implementation substantially complete (deterministic acceptance
31/31 green after the prior session's re-run; unit tests green), with two measured live
failures open (s4-service-layer, s6-consolidate) and the intel lane manager documented
but NOT implemented (see §3). Stale/conflicting WIP: two resurrected files that commit
`80e7a67` had deliberately DELETED (`src/components/bean/giftz-frontend-panel.tsx`,
`src/app/api/code-giftz/frontend/catalog/route.ts`) — byte-identical to their
pre-deletion versions and referenced only by the source-contract tests
(`tests/unit/giftz-ui-restriction.test.ts`) that correctly failed while they sat in the
tree. Quarantined verbatim to `backup/quarantine-m25-stale-frontend/` with a provenance
README (nothing imports them; recoverable from git history at `80e7a67~1`).

Explicitly NOT recovered into the release (other streams, preserved untracked + on
`backup/m25-intel-wip-auto-commit` for their own milestones): quota/recovery/workspace
(M26-quarantined tests + implementations), postgres staging tooling (`scripts/staging-*`,
`db-migrate-pg.ts`), loadtest, jazmii-repair scripts, go-live/recovery evidence docs,
`workers/wan22/` (hardware-gated JAZMII self-hosted video preflight), `scripts/.github_device_code`
(sensitive — never committed), and all other operational artifacts.

## 3. M25 architecture and requirements audit

**Intel lanes — what the feature is and what was actually wired (verified by reading
the code and every ref):**

- Adapter `src/lib/providers/llamacpp.ts` (committed substrate): OpenAI-compatible
  client for a `llama-server`, own breaker class `chat-llamacpp` (a wedged local server
  never poisons the hosted gateway's breaker state), honest dormancy (two gates:
  `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` SSRF opt-in + base URL), loopback/private-range
  enforcement, REAL health probe (tiny completion, never assumed), no Ollama (policy).
- Routing/registry/fallback (committed substrate, reused — no duplicate infrastructure
  introduced): registered in `src/lib/router/router.ts`; fallback chains
  `['bean-llm-openai-compatible', 'bean-chat-local-llamacpp']` on both the RIISHE chat
  and CODE GIFTZ code backends (each candidate attempted at most once per request;
  `retries: { maxAttempts: 1 }` — a 429 never causes duplicate submissions); registry
  descriptor `free-local`; credential mapping in `providers/credentials.ts`.
- Lane configuration layer (recovered WIP): `resolveLaneConfigs()` / `LaneConfig` /
  `chatBodyExtrasFor()` (Qwen3 thinking disabled) / `LLAMACPP_LOCAL_TIMEOUT_FLOOR_MS`
  (measured 180 s floor: cold 2.5k-token prompt processing exceeds the inherited hosted
  90 s budget on 2 cores).
- **Gap found by this audit**: `docs/ai/LOCAL-MODEL-LANES.md` documents a lane manager —
  `ensureLaneServer()` adopt-or-spawn, RAM-gated via `detectHardware()`, bounded to 3
  spawns/hour/lane, 20 s start deadline — but `git log -S ensureLaneServer --all` proves
  the code NEVER existed in any commit or backup: the doc described behavior whose
  implementing code was lost to a working-tree reset before any auto-commit swept it.
  The mirror implementation in `searxng.ts` ("lane management mirrors the llama.cpp
  lanes") confirms the intended contract. Likewise the doc's hardware-probe fix
  ("gpu.ts now uses /proc/meminfo MemAvailable — os.freemem() reports MemFree ≈ 201 MB
  vs 2.1 GB actually available and wrongly refused every spawn") was absent
  (`gpu.ts` still used `os.freemem()`). Both are the verified outstanding intel-lanes
  requirements — completed in §5.

**Refactoring stream — architecture (recovered WIP, verified against the audit doc's
anti-duplication commitments):** no second storage layer (the refactor ledger rides the
existing `CodeFileOperation` rows, `kind: 'refactor'`), no second patch engine (content
writes go through the existing `applyFiles` path; specifier math reused from the
deterministic move-module engine), no new queue/worker (assisted drafting happens inside
the existing turn machinery), no separate dashboard (the refactoring card renders inside
the existing chat flow), approval always required (plan stored `awaiting_confirmation`,
execution only through the confirmation endpoint bound to the plan hash, content-level
staleness hashes).

**Security/permissions/failure handling (verified, unchanged):** owner-scoped routes
(`requireUser` + project ownership checks), audit records (`code-giftz.chat_refactor`,
`code-giftz.refactor_execute`), usage metering, rate limits and queues untouched,
provider credentials never exposed (adapter reads env names only; breaker-state honest),
the executor re-validates content hashes inside the transaction window, replay-safe,
failed ops snapshot nothing. The drafting contract treats retrieved/project content as
data (prompt-injection resistance pinned by structural tests).

## 4. TypeScript errors discovered and resolved

All errors were enumerated with `tsc --noEmit` (160 at session start; 0 in `src/` +
`tests/` because the prior session had already fixed the WIP library errors before the
cut-off). Every remaining error was classified by provenance:

| Error | Root cause | Resolution |
|---|---|---|
| `scripts/m25/acceptance.ts(34,13)` TS2540 `Cannot assign to 'NODE_ENV' because it is a read-only property` | Dead code with a stale comment: the script tried to silence DB query logging via `NODE_ENV`, but `src/lib/db.ts` logs queries unconditionally (`log: ['query']`) and the script creates its own `PrismaClient` — the assignment never achieved anything | Removed the dead mutation + corrected comment; behavior byte-identical |
| `scripts/intel/live-acceptance.ts(391,5)` TS2322 `Type '{} \| null' is not assignable to type 'Record<string, unknown> \| null'` | `unknown ?? null` collapses the non-null arm to `{}` — `JSON.parse(...) as Record<string, unknown>.grounding ?? null` cannot satisfy the return type | Typed the parse target honestly: `as { grounding?: Record<string, unknown> \| null }` |

Attribution discipline (per the work order): the remaining 158→159 error lines are
UNRELATED to M25 — they sit in committed `scripts/`/`validation/` debt (fulltest,
riishe-stream probes, world-eval, etc.) and in other streams' untracked WIP
(`staging-pg*`, `db-migrate-pg.ts`, `loadtest/`, `jazmii-stuck-job-verify.ts`,
`backup/quarantine-m26-wip/*`). None were touched; none attributed to M25.
No `any`, no suppression directives, no tsconfig weakening — final count 159, zero in
`src/` + `tests/`.

## 5. Files changed and implementation details

**Intel lanes (the outstanding core):**

- `src/lib/providers/llamacpp.ts` — `ensureLaneServer()` implemented exactly per the
  documented contract: pure `planLaneStart()` decision (adopt an answering server →
  skip non-loopback lanes — operator-managed remote inference is never spawned → refuse
  at 3 spawns/hour/lane → refuse missing GGUF weights with the measured path → refuse
  RAM below the lane's `minFreeRamMb` with the measured MemAvailable → spawn), detached
  `llama-server` spawn as measured (`MALLOC_ARENA_MAX=2`, `-ctk/-ctv q8_0`, `-b/-ub 256`,
  ctx from lane config, `--threads = os.cpus().length`, 20 s start deadline with 500 ms
  polling, `bin`/`logDir` operator overrides, per-lane state on `globalThis`), wired
  into `execute()` per request kind — chat rides the riishe lane, `codeTask` rides the
  code lane when `BEAN_LLAMACPP_CODE_BASE_URL` is configured and the chat lane otherwise
  (backward compatible with single-URL deployments). A refused/failed start NEVER blocks
  the request — the real connection failure surfaces through the honest failure path and
  the router's fallback chain moves on. `health()` stays passive (probes never spawn).
- `src/lib/ai-engine/gpu.ts` — exported `memAvailableMbFromMeminfo()` (tested pure
  parser) and `detectHardware()` now reports **MemAvailable** (procfs on Linux,
  `os.freemem()` fallback) — the measured probe fix.
- `src/lib/intel/search-chain.ts` / `retrieval.ts` (recovered WIP + prior-session
  hardenings kept): gateway→SearXNG chain with honest `via` attribution and
  authoritative-empty propagation; evidence facade with per-mode budgets.
- `src/lib/intel/providers/searxng.ts` / `extract.ts`, `src/lib/intel/world/*` (4
  modules), `src/lib/intel/untrusted.ts`, `src/lib/intel/language.ts` (+238 additive
  facade over the unchanged tracked `detectLanguage` contract; Korean served),
  `src/lib/research/policy.ts` (Indic officeholder/recency signals — ASCII-`\b`-safe
  bare substrings, mirroring the existing CJK entries).
- `src/lib/riishe/sse-client.ts`, `src/lib/giftz/chat-stream.ts`, chat routes,
  `src/components/bean/code-giftz.tsx`, `src/lib/code/versioning.ts` (`VersionKind
  'refactor'`) — additive refactoring turn/payload plumbing.

**Refactoring — measured live-failure fixes (s4-service-layer, s6-consolidate):**

- `src/lib/code/refactoring/assisted.ts` — drafting prompt REORDERED (instruction +
  contract FIRST, scope context LAST under an explicit character budget): the adapter
  slices each message to `maxPromptChars` (12,000 for the code backend) and the tail-held
  contract was being silently truncated away on wide scopes (the measured s6 mechanism);
  `correctiveDraftCharBudget()` bounds the corrective pass's previous-draft slice;
  **deterministic importer completion**: for VERIFIED importers of a removed export that
  the draft did not touch, the plan appends the mechanical import rewrite itself —
  `rePointBindings()` (exact-statement surgery: named / type-only / default / export-from
  / mixed splits) with specifier math REUSED from the deterministic move-module engine
  (`specifierForTarget`, now exported) — disclosed in plan notes, never silent; the
  relocation gate's heuristic made precise (`stillBindsNames()`: a mixed importer keeping
  OTHER bindings on the old module is legitimate — the old "any mention of the old
  specifier" test falsely rejected correctly-split importers).
- `src/lib/code/refactoring/chat-flow.ts` — drafting scope widened from the bare roots
  to the SAME dependency cone the validator enforces (roots + up/down cone; a
  relocation's required edits live in the UP-cone importers, which the model was never
  shown); corrective pass uses the budgeted slice.

New files: `src/lib/code/refactoring/{graph,plan,execute,detect,validate,assisted,chat-flow}.ts`,
`src/app/api/code-giftz/projects/[id]/refactor/route.ts`, `src/lib/intel/{retrieval,search-chain,untrusted}.ts`,
`src/lib/intel/world/*`, `src/lib/intel/providers/*`. Modified tracked files: the 10
recovered ones + `gpu.ts` (this session). Docs: `docs/M25-REFACTORING-AUDIT.md`,
`docs/ai/LOCAL-MODEL-LANES.md`. Evidence: `scripts/m25-out/acceptance.json`,
`validation/m25/{harness,reports,evidence}`, `scripts/intel/out/`,
`scripts/model-lanes-out/`. Harnesses: `scripts/m25/acceptance.ts`,
`scripts/model-lanes-acceptance.ts`, `scripts/intel/live-acceptance.ts`,
`validation/m25/harness/{lib,live-refactoring}.ts`. Total: 91 files,
+12,619/−27 in the published commit.

## 6. Tests added and executed

- Recovered M25 test files (all executing in the documented suite): `tests/unit/llamacpp-lanes.test.ts`
  (extended this session: lane endpoint routing incl. backward compatibility, malformed-URL
  fallback, dormancy, and the full `planLaneStart` decision matrix — adopt/skip/rate/
  weights/RAM/per-lane RAM), `tests/intel/language.test.ts`, `tests/intel/world.test.ts`,
  `tests/unit/code-refactor-{detect,graph,plan,execute,security}.test.ts`.
- New this session: `tests/unit/gpu-meminfo.test.ts` (MemAvailable parse contract incl.
  the measured 2 GB-vs-1 GB trap, absent-field and garbage-input fallbacks);
  `tests/unit/code-refactor-assisted-helpers.test.ts` (rePointBindings surgery incl.
  mixed splits and byte-identical no-ops; correctiveDraftCharBudget; buildScopeContext
  whole-file omission); security-test refinements pinning the refined relocation contract
  (deterministic completion disclosed in notes, unknown-target rejection, mixed-importer
  split, and the unchanged rejection when no created module declares the moved symbol).
- Honest-scope statement: the lane manager's spawn path cannot be exercised against real
  llama-server weights in this recycled sandbox (`/home/z/bean-models/` absent) — the
  decision logic is unit-pinned and the refusal path was verified LIVE (weights absent →
  honest measured refusal, request proceeds). The adopt path is exercised by the 60 s
  cached probe logic and pinned by the decision tests; a live adopt/spawn run requires an
  operator host with weights (documented enablement path).

## 7. Full test-suite results

| Gate | Result |
|---|---|
| `bun run test` (= `bun test --isolate tests/`, the documented command) | **2122 pass / 0 fail / 151 files / 39,376 expects — twice, reproducible** (baseline 1971/141 + legitimate M25 additions; one mid-session red of 2 tests was the stale-resurrection conflict, resolved by quarantine — never skipped/weakened/deleted) |
| `tsc --noEmit` | 0 errors in `src/` + `tests/`; 159 pre-existing lines confined to `scripts/`/`validation/`/`backup/` (other streams, unchanged) |
| `eslint src tests` | clean (49 pre-existing errors live in committed m21/m24 kit fixtures + 1 committed script — not M25) |
| `bun run build` | PASS (`✓ Compiled successfully`, standalone `server.js` verified; dev server stopped for the build window per the documented 3.9 GB host constraint, restarted after, health 200) |
| Live refactoring harness (`validation/m25/harness/live-refactoring.ts`) | **72/72 checks across 13 steps** (deterministic rename/move, provider-assisted service-layer + extract + consolidate — the two previously failing steps now pass, rollback, M23 regression, export + secret-scan + independent build, real-Chromium desktop+mobile, IDOR/replay/staleness, cost discipline; 3 bounded provider drafting calls) |
| Deterministic acceptance (`scripts/m25/acceptance.ts`, isolated verify.db) | 31/31 steps |
| Intel live acceptance phase 1 (real network) | 9/9 language REAL_PASS (the stale mixed-Tamil expectation corrected to the unit-pinned contract); real gateway chain searches en/ta/zh; real GIFTZ docs retrieval; untrusted framing correct; SearXNG/Crawl4AI lanes honestly UNAVAILABLE on this host with measured reasons |

## 8. Security and product regression results

- **Secret scans**: the repo's S5 scanner on the push delta + staged set (zero blocking
  hits), plus direct pattern scans over all 91 staged files — the only match is the
  validation harness's throwaway local test password, identical to the committed M24
  harness precedent (valid only against the local dev server for disposable accounts).
  No private keys, no tokens, no `scripts/.github_device_code`, no session material, no
  `verify.db` committed. `docs/ai/LOCAL-MODEL-LANES.md` documents env NAMES only.
- **Security surfaces unchanged/verified**: SSRF loopback/private enforcement extended
  to the code lane URL; spawning is loopback-only; health probes never spawn; the lane
  manager never blocks requests; refactor execution still owner-checked, audit-recorded,
  plan-hash-bound, content-staleness-validated inside the transaction window, replay-safe;
  IDOR/replay/staleness/cancel re-verified LIVE by harness step s11.
- **Product regression protection (all green in the 2122-test suite + live harness)**:
  BEAN Intelligence API gateway (gateway/chat/completions/keys/usage suites), CODE GIFTZ
  (full chat/file-ops/versioning/export/frontend-intel suites + the M23 regression step
  live), RIISHE (chat, research pipeline, sse-client additive-only), LAXII (image suites
  + grounding), JAZMII (video suites + grounding), BEAN FX (no code touched — absent by
  the Phase-0 audit, preserved), Client Compute Engine (86-test suite green; zero
  client-compute files changed), auth/API keys/rate limits/queues/existing data (shared
  limiter, breaker, queue suites green; live SQLite db untouched by gates).
- **No unrelated product changed** to simplify M25: the only files outside the two M25
  streams are `gpu.ts` (the documented probe fix consumed by the lane manager) — nothing
  else.

## 9. Remaining limitations and known risks

1. **Live lane adopt/spawn with real weights is NOT_TESTED here** (weights/binary absent
   from the recycled sandbox; the doc's operational runbook covers operator hosts). The
   decision logic is unit-pinned; the refusal path is live-verified. Enablement: operator
   host + weights → pre-warm or let the lane manager spawn → `scripts/model-lanes-acceptance.ts`.
2. **SearXNG / Crawl4AI lanes honestly unavailable on this host** (no source checkout /
   Python module). The chain degrades to gateway-first with measured reasons recorded —
   by design, never faked.
3. **Known model-capacity limit (documented, unchanged)**: the local 1.7B chat lane's
   multi-turn recall degrades under the full product prompt (measured 2026-11-08; honest
   quality metrics in the lanes evidence). Mitigation options unchanged (larger model /
   condensed local-mode prompt — product decision).
4. **Pre-existing debt left alone deliberately**: 159 `tsc` lines and 49 `eslint` errors
   confined to `scripts/`/`validation/` fixtures and other streams' untracked WIP; bare
   `bun test` (non-isolated) remains order-dependent (M22's documented finding — hygiene
   milestone recommended, out of M25 scope).
5. **Other-stream WIP remains uncommitted** by design (quota/recovery/workspace, postgres
   staging tooling, loadtest, jazmii-repair, `workers/wan22/`), preserved verbatim on
   `backup/m25-intel-wip-auto-commit` (`5098143`) and in the working tree; the M26
   quarantine tests move back with their streams when those milestones complete.
6. **Provider-assisted drafting quality**: bounded to 1 draft + 1 corrective pass per
   turn; deterministic completion now covers verified importer omissions, but a provider
   that fails twice still fails honestly (no silent retry storms). Cost per assisted
   refactor: ≤2 drafting calls, deterministic kinds 0 — re-verified live (72/72 incl. cost
   discipline step).

## 10. Commit and remote SHA verification

| Item | Value |
|---|---|
| Dedicated branch | `m25-intel-lanes` (created at `3f40e75`, used to stage the reviewed set; aligned to the published commit after the release) |
| Published commit | `ea73545304212cae9b59eb3353955a6b0a519ec3` — ONE reviewed commit staging exactly the 91-file M25 set (+12,619/−27) |
| Push method | fetch before push → FF pre-check (`git merge-base --is-ancestor origin/main HEAD` = ancestor) → **fast-forward push only** (`3f40e75..ea73545 main -> main`) — no force push, no destructive operations anywhere in the session |
| Remote verification | `git ls-remote origin refs/heads/main` == `ea73545304212cae9b59eb3353955a6b0a519ec3` == local HEAD, immediately post-push |
| Working-tree state after release | clean of tracked modifications; 65 untracked paths remain = other-stream WIP preserved untouched (never staged, never deleted) |
