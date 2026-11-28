# RIISHE RELIABILITY BASELINE — P0 ALWAYS-RESPOND HOTFIX

**Milestone:** P0 — RIISHE Always-Respond & Conversational Reliability Hotfix
**Working branch:** `fix/riishe-always-respond` (linked worktree `riishe-reliability-wt`)
**Written:** 2026-11-28
**Scope:** owner-mandated product reliability repair — ordinary chat must behave like a working AI assistant, not an infrastructure status page.

---

## 1. Verified remote state at hotfix start (fresh fetch, independently confirmed)

All SHAs verified this session via `git fetch --all --prune`, `git ls-remote`, and authenticated GitHub API reads. Historical references from the mandate were re-measured, not assumed.

| Ref | Verified SHA | State |
|---|---|---|
| `origin/main` | `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc` | advanced from `82fd028` since the M48 session |
| `refs/heads/feat/m47-native-tool-operations-activation` | `a1ce6fabd247fcd154b12ee5e30e583235fc502b` | unchanged — complete M47 tip |
| `refs/heads/feat/m48-live-operations-activation` | `4cc1e92acabb9c7265c1fdf7365170bf4e386d45` | unchanged — M48 baseline doc branch |
| `refs/heads/fix/riishe-always-respond` | *(absent before this session)* | created by this hotfix |
| **PR #41** | head `a1ce6fa` (feat/m47-…) → base `82fd028` (main) | **OPEN, NOT MERGED** — the six outstanding M47 commits; preserved exactly as-is; no force-push, no rebase, no head-branch modification |
| **PR #42** | head `4cc1e92` (feat/m48-live-operations-activation) → base `82fd028` | **MERGED BY THE OWNER** — this is what advanced main to `bafc9aa` |

### Main commit after `82fd028` (inspected per Phase 0 item 5)

- `4cc1e92` — `docs(m48.0): M47 publication reconciliation + M48 baseline` (author record: sandbox session; 1 file: `docs/M48_BASELINE.md`, +173 lines).
- `bafc9aa` — `Merge pull request #42 from jon0471-dot/feat/m48-live-operations-activation` (author `jon0471-dot`, owner merge).
- Net content change on main since `82fd028`: **only `docs/M48_BASELINE.md` added.** No source, test, or configuration changes.

### Publication-state consequences for this hotfix

- PR #41 is still open → **the six M47 commits (`95620d9`…`a1ce6fa`) are NOT yet in main.** The hotfix therefore cannot branch from main without losing complete M47 ancestry.
- The M48 implementation gate (owner merge of complete M47) remains pending; **M48 capability work is not resumed here.** This P0 hotfix is product-repair work, explicitly authorized by the owner to proceed while PR #41 awaits review.

---

## 2. Hotfix branch construction (verified ancestry)

| Step | Result |
|---|---|
| Branch point | `fix/riishe-always-respond` created from the **complete M47 feature branch tip `a1ce6fa`** (per mandate: "Create … from the verified complete M47 feature branch") |
| Main integration | ordinary `git merge origin/main` (no strategy overrides, no force) → merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`; the merge brought in exactly one file (`docs/M48_BASELINE.md`) with zero conflicts |
| Ancestry proofs | `git merge-base --is-ancestor`: `a1ce6fa` ∈ HEAD ✅ · `bafc9aa` ∈ HEAD ✅ · `4cc1e92` ∈ HEAD ✅ |
| Topology note | merge-base(`a1ce6fa`, `bafc9aa`) = `a57de848`; the hotfix carries the six M47 commits **plus** main's M48 doc — when the owner merges PR #41 and later this hotfix, history stays fast-forward-compatible and non-duplicative (patch-ids of the six M47 commits exist exactly once in this branch's history) |
| Prohibitions honored | no reset, no delete, no rebase, no rewrite of any existing branch; PR #41 head untouched; `docs/M48_BASELINE.md` content preserved byte-identical from main |

---

## 3. Worktrees and environment (watchdog-aware)

| Worktree | HEAD | Branch | Role |
|---|---|---|---|
| `/home/z/my-project` | watchdog-managed | `main` (local, with sandbox auto-commits — local-only divergence, remote unaffected) | watchdog-controlled; never used for milestone work |
| `/home/z/my-project/m47-wt` | `a1ce6fa` | `feat/m47-native-tool-operations-activation` | M47 delivery (PR #41 head — **read-only reference for this hotfix**) |
| `/home/z/my-project/m48-wt` | `4cc1e92` | `feat/m48-live-operations-activation` | M48 baseline (merged via PR #42; preserved) |
| `/home/z/my-project/riishe-reliability-wt` | `683ffc4` → advances with hotfix commits | `fix/riishe-always-respond` | **all P0 hotfix work happens here** |
| `/tmp/m46-pristine` | `82fd028` (detached) | — | pristine comparison tree |

- **Watchdog:** zcode-driver is ACTIVE (`boot.sh` / `main.mjs` processes confirmed). All hotfix work is confined to the `riishe-reliability-wt` linked worktree per established practice.
- **Local `main` drift:** the watchdog continues to auto-create local-only bookkeeping commits on the primary worktree's `main`. Remote `origin/main` remains authoritative and clean; local drift is ignored and never pushed.

---

## 4. Actual baseline used for implementation

**Baseline SHA for all P0 source work: `683ffc4`** = `a1ce6fa` (complete M47) ⊕ `bafc9aa` (current main). Every R0–R5 milestone commit builds directly on this ancestry chain.

### Historical regression figures carried forward as claims-to-re-measure (M47 recorded; NOT assumed current)

- Test suite: 244 files, per-file hermetic strategy, 3,322 pass / 0 fail / 10 skip; documented pre-existing batched-run `mock.module` interference (per-file runs are the hermetic evidence standard).
- TypeScript: 234 errors at the M47-measured environment baseline; hotfix rule = zero NEW errors against a **freshly measured** baseline on this branch.
- ESLint clean; production build exit 0 (historical).

Fresh R0 measurements are recorded in the implementation report as they are taken.

---

## 5. Hotfix scope contract (from the owner mandate — binding for every R-milestone)

1. **R1** — remove the always-visible `ResearchStatusStrip` from normal chat; move the infrastructure inventory to existing admin diagnostics; fix ordinary-chat completion semantics (conversation delivery ≠ evidence verification ≠ operational execution) without falsifying any internal Trust Engine state.
2. **R2** — send the conversation ID as the first valid SSE data event; robust bounded dead-wire recovery that adopts the server-persisted answer, never duplicates messages, never replays side-effecting operations.
3. **R3** — authorized server-side failover (credential-gated, breaker-honoring, bounded) + consented, ready browser-local fallback for eligible ordinary turns; accurate provenance; honest no-ready-provider UX.
4. **R4** — research isolation: `search not warranted` is policy, not degradation; optional-source failure never aborts core generation; quota-free `/api/health` preserved; stream-completion reliability (partial content preserved; interrupted ≠ completed; slots released once).
5. **R5** — 54-scenario acceptance with exactly-one classification each; desktop/mobile Preview verification against the real app; full regression; honest documentation of every remaining boundary.

**Red lines preserved:** M41–M47 architecture, one orchestrator, one governed execution loop, one provider registry, one local-model framework, no hidden paid fallback, no Ollama, no fabricated availability/citations/responses, no credentials in prompts or logs, no automatic production writes, no unrelated redesign, **no merge into main by the assistant**.

---

## 6. Phase 0 verdict

- Remote state: verified and recorded above; **PR #41 preserved open and untouched.**
- Hotfix branch: created with complete M47 ancestry + current main; **no existing branch modified.**
- Baseline doc: this file.
- Next: R0 fresh baseline measurement + source-level diagnosis (the six confirmed source areas), then implementation milestones R1–R5, each committed + pushed + remote-SHA-verified on `fix/riishe-always-respond`.
