# P0 IMPLEMENTATION REPORT — RIISHE ALWAYS-RESPOND & CONVERSATIONAL RELIABILITY

**Branch:** `fix/riishe-always-respond` (linked worktree `riishe-reliability-wt`)
**Date:** 2026-11-28
**Mandate:** owner P0 product-reliability hotfix — "when a customer opens RIISHE, they experience a working AI assistant — not an infrastructure status page."

---

## 1. Verified baseline (Phase 0 / R0)

| Item | Verified value |
|---|---|
| `origin/main` at hotfix start | `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc` (owner merge of PR #42 = the M48 baseline doc; the ONLY content change since `82fd028`) |
| PR #41 (six M47 commits) | **OPEN, preserved untouched** — head `a1ce6fa` → base `82fd028`; not merged, not modified |
| Hotfix branch base | complete M47 tip `a1ce6fa` ⊕ ordinary merge of `origin/main` → **`683ffc4`** (zero conflicts; ancestry: `a1ce6fa`, `bafc9aa`, `4cc1e92` all verified ancestors) |
| Fresh TypeScript baseline (measured BEFORE any code change) | **234 errors** — exactly the M47-measured environment baseline |
| Test census at baseline | 244 files (239 unit + 5 integration) — matches the M47 record; the hotfix adds 3 files → 247 |
| Baseline document | `docs/RIISHE-RELIABILITY-BASELINE.md` (commit `457d9f0`) |

## 2. Implementation trail (every commit pushed + remote-SHA verified)

| SHA | Milestone | Content |
|---|---|---|
| `457d9f0` | R0 | baseline doc + verified remote state |
| `e73f49c` | R1 | status-strip relocation to admin diagnostics; customer-facing completion policy (`completion-policy.ts`); calculate-tool computation evidence; `search not warranted` no longer a degradation |
| `ec88c76` | R2 | early conversation-ID SSE data event; bounded dead-wire recovery schedule (`retry.ts` contract) |
| `aabefac` | R3 | consented browser-local fallback (`local-fallback.ts` + hook wiring); server failover contracts verified (provider-fallback suite) |
| `b63db73` | R4 | research-failure isolation (exploding retrieval degrades the turn honestly); stream-reliability review |
| *(this commit)* | R5 | acceptance suite + regression census + Preview evidence + docs |

Final tip after R5: see §6 for the exact published SHA.

## 3. What changed, in product terms

1. **The conversation view is clean.** The always-visible research-source strip ("GitHub: Login required · YouTube: Unavailable · …") is gone from RIISHE chat. The full inventory now lives in the restricted admin diagnostics (Admin → "Research source gateway status"; same authenticated endpoint, admin-role surface, no new customer dashboard). Per-answer Sources sections and material verification notes are untouched. CODE GIFTZ's own strip is untouched.
2. **Ordinary answers no longer wear false failure badges.** The customer-facing terminal stage is now decided by a dedicated completion policy that separates conversation delivery from evidence verification from operational execution. Internal Trust semantics are UNCHANGED (states + ledger mapping intact). Material qualifications remain: required-tool failure, warranted-but-unconfirmed verification, partial verification → honest "Completed with limitations". Real operational executions → "Completed". Approval-pending turns end on the in-flight stage, never a terminal badge for an unexecuted operation.
3. **A dropped connection no longer loses a finished answer.** The server sends the conversation ID as the FIRST SSE data event; the client's dead-wire recovery runs a bounded schedule (0s/8s/20s/40s), adopts the persisted answer in place (no duplicates), clears the stale error, and never replays a request (read-only reconciliation).
4. **A hosted outage can be bridged — only through authorized paths.** Server-side: the existing credential-gated provider chain (verified by its 14-case suite). Client-side: when the user ALREADY consented to on-device inference AND a supported model is already loaded, an eligible inference failure (no text streamed, no attachments, not user-aborted, not auth) is answered by the existing browser-local runtime with honest on-device disclosure. No silent downloads, no forced local mode, no fabricated capability, no second framework.
5. **Optional research can never take chat down.** `search not warranted` is recorded as policy (not degradation); an exploding research lane degrades the turn honestly (TOOL_UNAVAILABLE + honest note + answer still ships); quota-free `/api/health` behavior preserved (12-case suite).

## 4. Regression evidence (fresh, this environment, final tree)

| Check | Result |
|---|---|
| Full per-file hermetic census | **247 files → 3,355 pass / 0 fail / 10 skip** (M47 record 3,322/0/10 across 244 + the 33 new P0 cases = 3,355 — exact arithmetic match). One environmental failure during the run (`riishe-text-tokenizer` ENOENT: the pinned MiniLM vocab is a runtime asset absent from the fresh worktree) was resolved by restoring the EXACT pinned asset (SHA-256 `07eced37…` verified byte-identical) and re-verified 7/0 |
| TypeScript | **234 = 234** fresh baseline — zero new errors (one transient scope slip during R3 was caught by the delta check before commit) |
| ESLint | clean on every touched file |
| Production build | **exit 0** (`next build`; NOTE for operators: bun installs skip postinstall scripts by default — `prisma generate` must run before `next build`, otherwise page-data collection fails; this was diagnosed and documented, not worked around) |
| Security/secret posture | no credentials read, printed or logged anywhere in this work (the sandbox's own git credential was used only for branch push/PR creation, value never exposed); no new dependencies; the identity-hygiene suite (24/0) confirms no backend-identity strings in customer components |

## 5. Preview verification (real app, real browser, real inference)

**Setup:** production build of this exact tree (`next start`, port 3100), isolated DB copy (`p0-preview-test.db` — the existing `custom.db` untouched), `BEAN_TRUSTED_ORIGINS=http://localhost:3100` (the documented operator knob for a local origin), driven with a real Chromium session (agent-browser).

| Verification | Observed result |
|---|---|
| Account + session | real registration via the app's API (member role); real session cookie; authenticated dashboard |
| Desktop walkthrough (1440×900) | exact greeting; 7 real hosted-gateway turns streamed complete (golden ratio; Tamil solar-electricity paragraph; Hindi honey follow-up; count-to-8; 144÷12; mobile-check; strategy follow-up); "Regenerate / Copy / Background" affordances intact |
| Limitation badges | **0 occurrences** of "Completed with limitations" / "Tool unavailable" across every rendered thread |
| Status strip | **0 occurrences** of the source-status inventory (desktop AND mobile DOM) |
| Wire protocol (LIVE capture) | authenticated streamed request captured: `: connected` comment, then **FIRST data frame = `{"conversationId":"…"}` identity-only**, then stage/delta frames; `done.partial=false` |
| Completion policy (LIVE) | persisted metadata of live turns: `states=['UNVERIFIED']`, `taskStages=['verifying']` — **no terminal limitation stage recorded** for ordinary conversational turns (independent DB read via Prisma) |
| Disconnect recovery (LIVE) | browser navigated away mid-turn; the server completed and persisted; independent DB read: **exactly 1 user row + 1 assistant row**, complete answer, no duplicates |
| Pre-stream abort (LIVE) | request aborted before the stream: honest failure text rendered, question preserved for one-keystroke retry |
| Mobile walkthrough (390×844) | greeting rendered; real turn answered; composer visible/usable; **`scrollWidth <= clientWidth` — no horizontal overflow**; 0 badges; 0 strip |
| Browser health | console tail EMPTY; page errors EMPTY on every segment |

**Honest boundaries observed during Preview:**
- The sandbox kills background processes between tool invocations; the walkthrough ran as scripted segments (server + browser steps inside one invocation each). All observations are from the actual DOM, network traffic and database — not screenshots.
- The consented local-model fallback with a REAL loaded model could not be exercised here (headless environment, no WebGPU/dedicated GPU, no model installed) — classified `HONEST_UNAVAILABLE` (acceptance D34); its eligibility policy is fully pinned (11 cases) and the wiring reuses the existing on-device runtime.
- A mid-stream browser-driven abort (to observe the client's live adoption moment) is not driveable with the CLI's network primitives (abort fires at request start); the adoption path is pinned by the route-level harness (LOCAL-INT) and its live components (server persistence, honest UX) were verified separately.
- The live calculate-style turn was answered correctly by the model WITHOUT a tool call (this member account's route does not carry the code-execution permission key) — recorded honestly; the tool-output→evidence mapping is pinned by the orchestrator suite (LOCAL-INT).

## 6. Acceptance

`docs/intelligence/P0-ACCEPTANCE.md` — 54 unique scenarios, exactly one classification each: **LIVE 13 · LOCAL-INT 40 · HONEST_UNAVAILABLE 1** (13+40+1 = 54; corrected by the M48.1 re-evaluation of 2026-11-28 — the original text stated "LIVE 12 · LOCAL-INT 41" while its own enumeration listed 13 LIVE IDs; every row now carries exactly ONE primary classification, and historical M47 live evidence remains in the evidence column only). No mocked transport counted as live; no screenshot-based claims; every scenario carries ID, classification, execution result, evidence and the independent-verification flag.

## 7. Publication

| Field | Value |
|---|---|
| Branch | `fix/riishe-always-respond` |
| Final local SHA | recorded in the commit below (this file is part of it) |
| Final remote SHA | verified via `ls-remote` after push (log in the commit output) |
| Merge authority | **the owner's** — nothing was merged into main; PR #41 preserved; a main-targeted hotfix PR is deliberately NOT created while PR #41 is open (mandate: no misleading duplicate PRs). Once the owner merges PR #41, this branch merges cleanly (fast-forward-compatible; the six M47 commits exist exactly once in its history) |

## 8. Remaining limitations (honest)

> M48.1 correction (2026-11-28): limitations 1 and the §7 merge-authority note below describe the state at the time of writing and were accurate then; the publication state has since advanced — see §9 for the independently verified current record.

1. ~~**PR #41 still awaits owner merge.**~~ **RESOLVED:** the owner merged PR #41 (merge commit `683ffc4`), then PR #43 and PR #44 merged this branch itself — see §9.
2. **Second real provider credential is not configured in this sandbox** — the authorized secondary failover lane is verified by its hermetic suite; with a real credential it behaves identically (same code path, credential-gated).
3. **Local-model live leg** — see §5 boundaries; needs a capable owner browser with consent + the model installed.
4. **`prisma generate` before `next build`** — a fresh-install operator step (bun skips postinstall); documented here and in the failure analysis.
5. **Manual owner walkthrough** — the mandate's mobile click-through was executed here with a real browser and real assertions; an owner-side spot check on a physical device remains recommended (the app uses the same code path).

## 9. Publication reconciliation — independently verified current state (M48.1, 2026-11-28)

All facts below were re-measured this session via `git fetch --prune`, `git ls-remote` and authenticated GitHub API reads (historical references treated as claims, not facts):

| Fact | Verified value |
|---|---|
| PR #41 (M47 completion, 6 commits) | **MERGED** by the owner — merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`, head `a1ce6fabd247fcd154b12ee5e30e583235fc502b` |
| PR #42 (M48 baseline document) | **MERGED** — merge commit `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc`, head `4cc1e92acabb9c7265c1fdf7365170bf4e386d45` |
| PR #43 (P0 hotfix publication, R0–R4) | **MERGED** — merge commit `ae0d06c3154c7a1ebf90b0c84461ac97acf9e655`, head `457d9f0` |
| PR #44 (P0 reliability implementation, R5 = this report's tree) | **MERGED** — merge commit = current main `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5`, head `5bfb8965898a0eb62cf7dad712397f96a0afe597` |
| Current `origin/main` | `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5` (merge of PR #44; parents `ae0d06c` + `5bfb896`) |
| M47 final SHA ancestry | `a1ce6fa` verified ancestor of main (`git merge-base --is-ancestor`) |
| P0 final SHA ancestry | `5bfb896` verified ancestor of main (`git merge-base --is-ancestor`) |
| M48 implementation gate | **COMPLETE** — the owner merged the complete M47 delivery (PR #41) and the P0 implementation (PR #44); no M47/P0 delivery commits remain outside main |
| This hotfix branch | `fix/riishe-always-respond` tip `5bfb896` — merged via PR #44; the branch is retained as history, untouched |

The P0 delivery is fully in production `main`. No merge was performed by the assistant at any point; every merge above was the owner's own GitHub action.
