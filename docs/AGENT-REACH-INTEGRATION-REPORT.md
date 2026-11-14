# Agent Reach Integration — Final Report (shared research gateway)

> Date: 2026-11-14 (UTC+8). Branch: `feat/agent-reach-integration` (fast-forward
> target: `main`). Baseline tree: `main` @ `6c280e4`.
> External projects: `Panniantong/Agent-Reach` v1.6.1 (MIT) and
> `h4ckf0r0day/obscura` v0.2.7 (Apache-2.0).
> Every claim below was executed on this tree unless explicitly marked
> otherwise; failures and limitations are stated, never glossed over.

## 1. Phase 0 architecture audit findings

Full audit: [`docs/AGENT-REACH-INTEGRATION-AUDIT.md`](./AGENT-REACH-INTEGRATION-AUDIT.md).
Headlines:

- The repo already shipped a mature research pipeline (`src/lib/research/` —
  gateway lane via the authorized z.ai gateway, key-free independent lane,
  deterministic freshness policy, bounded retries, freshness-aware cache) and a
  CODE GIFTZ docs lane (`src/lib/intel/techdocs.ts`). Evidence persists in
  `Message.metadata` / `CodeMessage.metaJson`; there are no dedicated evidence
  tables and none were added.
- **No** prior Agent Reach / Obscura code existed anywhere (repo-wide sweep:
  zero matches).
- One pre-existing SSRF gap found and CLOSED in this integration:
  `research/direct.ts directFetch` validated scheme only and followed redirects
  blindly; it now passes the shared URL-safety guard and follows redirects
  manually with per-hop revalidation.
- RIISHE's research decision is fully automatic per turn (deterministic
  freshness policy + add-only semantic router). The reach lane respects that
  decision — it runs inside the same retrieval stage, never per message.

## 2. Exact files changed and created

**Created (12):**

| File | Purpose |
| --- | --- |
| `src/lib/research/reach/types.ts` | Typed envelope, item, provenance, outcome contracts |
| `src/lib/research/reach/config.ts` | Env config + clamps + binary version probe |
| `src/lib/research/reach/allowlist.ts` | Fixed channel/action/param inventory; argv builder (fail-closed) |
| `src/lib/research/reach/url-safety.ts` | SSRF guard (literal IPv4/IPv6, DNS resolution, metadata hosts, manual redirect revalidation, `guardedFetch`) |
| `src/lib/research/reach/injection.ts` | Retrieved-content sanitizer + prompt-injection scanner |
| `src/lib/research/reach/adapter.ts` | Subprocess boundary: argv-array spawn, minimal child env, timeout/kill, stdout caps, zod envelope validation, error-code mapping, health probes (`version`, `doctor`), per-user rate limit, audit |
| `src/lib/research/reach/registry.ts` | Source capability registry with honest states |
| `src/lib/research/reach/gateway.ts` | Deterministic planner (≤3/turn), budgeted executor, normalizer, page-read fallback chain (reach → Obscura) |
| `src/lib/research/browser/obscura.ts` | Optional Obscura backend: `fetchRenderedPage/extractText/extractLinks/captureScreenshot/healthCheck/shutdown` |
| `src/lib/intel/techdocs-reach.ts` | CODE GIFTZ GitHub enrichment (`buildTechDocsWithReach`) |
| `src/app/api/research/status/route.ts` | Authenticated gateway status endpoint |
| `src/components/bean/research-status.tsx` | Honest availability strip for the two products |

Plus 8 test files (`tests/unit/reach-*.test.ts` — 78 tests) and
`docs/AGENT-REACH-INTEGRATION-AUDIT.md`.

**Modified (16):**

| File | Change (all additive) |
| --- | --- |
| `src/lib/research/pipeline.ts` | Reach lane after the gateway volley (gated on `opts.userId`), `EvidenceSource.reach/readEngine`, `EvidencePack.reach`, page-read fallback chain, provenance stamping |
| `src/lib/research/direct.ts` | `directFetch` now passes the SSRF guard + manual redirect revalidation |
| `src/lib/riishe/states.ts` | `EvidenceSourceView.reach/readEngine`, `MessageMetadata.reach` |
| `src/lib/riishe/orchestrator.ts` | `OrchestrationInput.userId`, audit-source provenance passthrough, metadata mapping, `runResearch` userId forwarding |
| `src/lib/ai-engine/riishe-chat-handler.ts` | Background turn forwards `userId` |
| `src/app/api/riishe/chat/route.ts` | Both call paths pass `userId: user.id` |
| `src/lib/intel/techdocs-reach.ts` consumers: `src/app/api/code-giftz/chat/route.ts`, `src/lib/ai-engine/giftz-coding-handler.ts` | `buildTechDocsContext` → `buildTechDocsWithReach`; additive `research` artifact into turn input/persist/JSON response |
| `src/lib/giftz/turn.ts` | `research` in core input/result; `persistGiftzAssistantTurn` metaJson additive |
| `src/lib/giftz/chat-stream.ts` | `GiftzTurnResult.research`; SSE `done` frame additive field |
| `src/app/api/code-giftz/chat/[id]/route.ts` | `metaJson.research` passthrough to history |
| `src/components/bean/riishe/use-riishe-chat.ts` | `SourceView.reach/readEngine`, `MsgMeta.reach` |
| `src/components/bean/riishe/riishe-messages.tsx` | Channel chips, browser-rendered note, "Retrieval limitations" section |
| `src/components/bean/riishe.tsx`, `src/components/bean/code-giftz.tsx` | Research status strip mounts; giftz "Technical references" section |
| `.env.example` | Research gateway variable NAMES |
| `docs/api/API.md`, `docs/security/SECURITY.md`, `docs/architecture/ARCHITECTURE.md`, `docs/HANDOFF.md` | Documented |

**Database changes: NONE.** No schema change, no migration, no `db push`.
Research artifacts ride the existing JSON columns; ownership + account
deletion inherit existing behavior. No backup/migration evidence is therefore
required — and none is claimed.

## 3. Agent Reach version and installation method

- Version audited: **v1.6.1** (commit `c70ae6d`, GitHub release 2026-11-01,
  `agent-reach.zip` + wheel + sdist).
- Documented install (operator, on the host): `uv tool install
  https://github.com/Panniantong/Agent-Reach/releases/latest/download/agent-reach.zip`
  then `agent-reach setup`. Runtime requirements: Python ≥3.10; default
  channels need no browser; optional login channels install Node/OpenCLI +
  a dedicated headless browser.
- **Executed verification in the integration sandbox [verified]:** installed
  from the pinned v1.6.1 source via `uv tool install`; `agent-reach version`
  → `{"ok":true,"result":{"version":"1.6.1","install_method":"uv"}}`;
  `agent-reach doctor` → honest per-channel statuses; LIVE retrievals
  succeeded: `github search "yt-dlp"` (2 real items, backend `github-api`
  after the `gh` miss, 510 ms), `web search` (real Exa results),
  `web read https://nodejs.org/en/about` (real page text).
- BEAN integrates via the **CLI JSON envelope** (`{schema_version, ok, items[],
  error{code,message,hint}}`) with the allowlisted argv interface; the BEAN
  binary path is `BEAN_RESEARCH_AGENT_REACH_BIN` (default `agent-reach` on PATH).

## 4. Supported and unavailable source channels

Registry states are MEASURED (binary probe + `agent-reach doctor` + config) —
never assumed from source presence. `GET /api/research/status` exposes them.

| Source | BEAN state model | Notes |
| --- | --- | --- |
| github | allowlisted; `available` when doctor reports ready | search/read (repos, README, issues/PRs + comments) |
| web | allowlisted; `available` when ready | search (Exa) / read (Jina→Exa) |
| youtube | allowlisted | search/read/subtitle; transcribe requires a Groq/OpenAI key (upstream config, optional) |
| bilibili | allowlisted; `requires_configuration` when `bili-cli` missing (measured doctor output) | search/read/hot/subtitle (subtitle needs owner login upstream) |
| reddit | allowlisted; **`requires_login`** until the owner logs in on the host | search/read/subreddit |
| v2ex | allowlisted | hot/node/read/user |
| twitter, linkedin, xiaohongshu, xueqiu, facebook, instagram, xiaoyuzhou, boss | **`disabled`** (BEAN allowlist policy) — honestly reported, never available | upstream exists; BEAN does not expose them in this integration |
| Obscura (browser rendering) | `available`/`unavailable` from its own probe | optional; text/links/HTML/screenshots |

## 5. RIISHE integration details

- Inside the existing retrieval stage, when (and only when) the caller
  supplied the authenticated user id: a deterministic planner maps the message
  to ≤3 allowlisted invocations (GitHub exact reads from repo/issue links;
  one web search on question-like messages; platform searches only when the
  platform is referenced). Execution is budgeted (default 12 s lane budget),
  per-user rate-limited (30/min), audited, and failure-isolated.
- Reach evidence merges into the SAME ranking as gateway results; surviving
  sources carry `reach` provenance; page reads gain the addendum fallback
  chain (gateway reader → Agent Reach web read → Obscura ONLY when the page
  is a JavaScript shell → direct fetch, which also gained the SSRF guard).
- Preserved verbatim: conversation ownership, history, the SSE contract
  (`delta/reset/stage/research/tool/done` frames unchanged — the metadata
  carried in `done.meta` gained additive fields), model routing/fallbacks,
  verification and the deterministic injection guard. Research artifacts
  persist additively in `Message.metadata` (`sources[].reach`, `readEngine`,
  `reach` lane provenance).
- The reach lane never runs on turns where the freshness policy + semantic
  router decided no search.

## 6. CODE GIFTZ integration details

- `buildTechDocsWithReach(message, userId)` wraps the existing bounded
  tech-docs lane: GitHub references in the request add up to two allowlisted
  GitHub invocations (exact repo/issue/PR read, or a bounded discovery
  search), merged into the SAME untrusted reference block with per-host
  provenance. The base lane's contract (`TechDocsContext | null`, honest
  degrade) is unchanged; failures degrade into `research.degraded`.
- The research artifact persists additively (`CodeMessage.metaJson.research`),
  rides the SSE `done` frame and the JSON response, and the history endpoint
  passes it through.
- Preserved verbatim: task modes (`generate/explain/review/plan`),
  `MODE_PROMPTS`, file contracts, `diff` output, the SSE stream lifecycle,
  and the sandbox. Retrieved repositories/issues are UNTRUSTED reference
  data: **no** execution, **no** package installation, **no** change to the
  `approval: z.literal(true)` sandbox gate, and research grants no additional
  filesystem/shell/Git permissions (the reach adapter spawns only the
  allowlisted retrieval CLI with a minimal environment).

## 7. Security controls implemented (tested)

1. Auth: `/api/research/status` behind `requireUser()`; research runs inside
   the products' existing authenticated flows.
2. Ownership: artifacts live on the products' own messages (owner-scoped);
   the status endpoint exposes no per-user data.
3. Source-level enablement: allowlist + `BEAN_RESEARCH_REACH_DISABLED`
   + `BEAN_RESEARCH_REACH_DISABLED_CHANNELS`; states surface per source.
4. SSRF: literal IPv4/IPv6 private/loopback/link-local/CGNAT blocking,
   metadata hostnames, userinfo, DNS-resolution check (DNS-rebinding safe),
   per-hop redirect revalidation — applied to reach targets, page reads and
   the direct lane. *(tested: `reach-url-safety.test.ts`)*
5. Prompt injection: control-char stripping + neutering of `TOOL_CALL:`,
   path-tagged fences, `<system>` markers + honest flags; all evidence stays
   framed as untrusted data. *(tested: `reach-injection.test.ts`)*
6. Bounds: per-call timeout with SIGKILL (pipe holders destroyed — wrapped
   grandchildren cannot stall close), stdout caps, item/text caps, ≤3
   invocations/turn, 12 s lane budget, process-wide concurrency (2),
   per-user rate limit (30/min). *(tested: adapter + gateway suites)*
7. Honest failure classification: `not-configured`, `needs-setup`,
   `needs-login`, `timeout`, `rate-limited`, `platform-blocked`, `not-found`,
   `bad-input`, `busy`, `upstream`, `cancelled` — no stack traces, no binary
   paths, no argv in client-facing messages. *(tested)*
8. Secrets: child env is PATH/HOME/locale (+NODE_ENV) only — tested that a
   child cannot see `DATABASE_URL`; no credentials, cookies or session
   tokens are ever passed; upstream keys (`github-token`, `groq-key`) remain
   operator-configured inside Agent Reach's own store.
9. Rate limiting + audit: `research.reach` / `research.browser` audit rows;
   per-user sliding window. *(tested)*
10. Retention/deletion: no new persistence surface (additive JSON fields on
    existing owner-scoped rows).
11. Browser isolation (Obscura): server-side CLI only; no CDP endpoint is
    created by BEAN; `--allow-private-network`/`--stealth` never passed; no
    cookie persistence; screenshots in always-cleaned temp dirs with PNG
    magic-byte validation. *(tested)*

## 8. Test baseline vs final results

| Check | Baseline (`6c280e4`) | Final (integration tree) |
| --- | --- | --- |
| `bun test --isolate tests/` | **1579 pass / 0 fail** (110 files) | **1657 pass / 0 fail** (119 files; +78 new, 0 regressions) |
| `tsc --noEmit` | 0 errors in src/tests; 135 pre-existing in `scripts/` | **identical** (0 in src/tests; same 135 in scripts/) |
| `eslint .` | 0 errors / 2 pre-existing warnings (vendored giftz-kit) | **identical** |

New test files: `reach-allowlist`, `reach-url-safety`, `reach-injection`,
`reach-adapter` (real fake binary: spawn/timeout/cancel/overflow/secrets/
rate-limit), `reach-registry`, `reach-gateway`, `reach-pipeline`,
`reach-obscura`, `reach-giftz`. Existing regression coverage for RIISHE SSE,
GIFTZ sandbox approval, provider routing and rate-limit headers ran green in
the full suite.

## 9. Known limitations and outstanding risks

- **Agent Reach must be installed by the operator** on the BEAN host; when
  absent, every source reports `unavailable` and products continue on the
  existing pipeline (verified degradation path in tests).
- **Login-gated channels** (reddit today; bilibili subtitles) require an
  owner-performed interactive login on the host — by design BEAN never
  touches browser sessions. Until then they report `requires_login`.
- **Exa/Jina free endpoints** (Agent Reach web channel) are third-party
  services with their own rate limits; failures degrade honestly per channel.
- **Obscura Windows**: v0.2.6/v0.2.7 ship Linux/macOS only; the most recent
  release with official Windows x86-64 zips is **v0.2.5**. Operators on
  Windows should pin v0.2.5 or use the distroless container. Verified in this
  sandbox: the v0.2.7 Linux x86-64 build (version/text/markdown/links/
  screenshot + built-in SSRF block of `169.254.169.254`).
- **Not verified in this sandbox**: Agent Reach's login-gated channels (need
  real accounts), YouTube transcription (needs a Groq/OpenAI key), Obscura
  `serve`/CDP mode (not used by BEAN), and Windows binaries.
- The optional `captureScreenshot` operation is implemented and tested
  against the CLI contract but not yet wired to any UI surface.
- Pre-existing repo limitations unaffected by this work: `scripts/` tsc
  baseline (135), no Prisma migrations dir (`db push` workflow), vendored
  giftz-kit lint warnings.

## 10. Commit and remote verification

- Committed on `feat/agent-reach-integration` after: full diff review,
  secret/runtime-artifact scan of staged files, full suite + tsc + lint +
  production build. See the delivery message for the exact SHA and remote
  verification result (push follows the repo's documented sync policy;
  fast-forward only, never force-push).
