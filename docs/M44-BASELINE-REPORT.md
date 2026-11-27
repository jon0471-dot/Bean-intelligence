# M44 BASELINE REPORT — Phase 0 (recorded 2026-11-27)

Mission: `M44 — Autonomous Decision Intelligence & Verified Execution`
Branch: `feat/m44-autonomous-decision-execution`
Rule honored: no merge into `main`, no PR opened/closed, no protected-branch changes by this session.

## 1. Verified remote SHAs (fetched fresh, not assumed)

| Ref | SHA | Status |
|---|---|---|
| `origin/main` | `0861430` | Verified via `git fetch origin` — exactly the M43-reported PR #33 merge commit |
| `origin/feat/m43-real-world-intelligence` | `ec5adb2` | Verified — exactly the M43-reported final branch SHA |
| M43-reported main reconciliation merge | `fee31c2` | Verified — exists, reachable from **both** `origin/main` and the M43 branch |
| M43-reported PR #33 merge | `0861430` | Verified — `Merge pull request #33 from jon0471-dot/feat/m43-real-world-intelligence`, parents `5cad5a0` (pre-merge main) + `dd84b44` (branch head at merge time) |

## 2. Branch relationships (verified with ancestry checks)

- `dd84b44` (carries M43 m43.0 → m43.10, and through it the complete M42 history `a75b62b`, `ace7023`, `e02b551`, `9d05757`) **is** an ancestor of `origin/main` — delivered by the owner's PR #33 merge.
- `ec5adb2` (M43 branch tip) is **not** an ancestor of `origin/main`.
- Branch-only commits (in `origin/feat/m43-real-world-intelligence`, not in `origin/main`) — exactly 4:
  1. `d0e7dff` — m43.11 suite-found giftz mock fix + full-suite record (3099/0/10)
  2. `9f02b04` — m43.12 live preview + UI preservation walk
  3. `ce4df4a` — m43.13 complete documentation set
  4. `ec5adb2` — m43.14 observed-owner-action record (PR #33 merged by the owner mid-session)
- The only commit in `origin/main` that is not in the M43 branch is the merge commit `0861430` itself; both of its parents are ancestors of `ec5adb2`, so its content is fully contained in the branch tip.

**Conclusion:** M43 delivery on `main` is complete through m43.10; the 4 branch-only commits are the outstanding M43 remainder. Nothing was lost; nothing was merged into main by this session.

## 3. M44 baseline construction (stacked, history-preserving)

- Branch `feat/m44-autonomous-decision-execution` created from `origin/feat/m43-real-world-intelligence` (`ec5adb2`).
- Reconciliation merge `0c9b4c0` — normal merge of `origin/main` (`0861430`) into the branch, message `chore(m44.0): baseline reconciliation …`. **Tree verified content-identical to `ec5adb2`** (zero-diff), `origin/main` now an ancestor of the branch, no history rewritten, no force-push.
- The 4 outstanding M43 commits ride inside the M44 lineage and will reach `main` only through the owner's future merge decision.
- Pushed: `origin/feat/m44-autonomous-decision-execution` = `0c9b4c0`, verified by an independent fetch after push.

## 4. Local worktree reconciliation (sandbox recycled since the M43 session)

- Local checkout was stale at `77f9890` (old M39-era `main` + an auto-commit message) while all M42/M43 delivery existed on `origin` — origin treated as the authoritative record.
- 73 untracked leftover files (M41.7-era session artifacts) were inventoried against the M43 tree:
  - 34 byte-identical to already-delivered content,
  - 6 strictly older versions of delivered content (the M43 versions are supersets — M42/M43 additions present only upstream),
  - 18 never-committed session artifacts (`scripts/m417/*` walk scripts, `scripts/m43-baseline/resolve-worklog.py`, …).
- All 73 were **archived** to gitignored `backup/m44-phase0-worktree-leftovers/` (nothing deleted), leaving the primary worktree clean.

## 5. Environment incidents recorded verbatim

1. **zcode-driver watchdog:** the sandbox driver (root `zcode-driver` process) force-checks out `main` on the primary worktree 6–8 seconds after every checkout away from it (observed 3×: 12:30:00, 12:30:54, 12:32:30 UTC). Branch refs are untouched — only the primary worktree's HEAD is reset. **Mitigation:** all M44 work now happens in a linked worktree `/home/z/my-project/m44-wt` on the M44 branch (precedent: the repo's earlier `.m33-cg` linked worktree); the primary worktree stays on `main` where the driver wants it.
2. **Stale local database:** `db/custom.db` was M39-era (39 tables, no `EvidenceKnowledge`, no mission tables, no users). The worktree got an isolated copy at `m44-wt/db/custom.db`, and the full M44-era Prisma schema was pushed (`prisma db push` → 42 tables incl. `EvidenceKnowledge`, `AgentMission`, `AgentMissionTask`).
3. **Gitignored pinned vocab** absent after recycle (the M42/M43 lesson) — restored for both MiniLM companions from the manifest-pinned source, SHA-256 `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` (231508 bytes) verified exactly for `minilm-l6-embeddings` and `ms-marco-minilm-rerank`.
4. `bun install --frozen-lockfile` clean; `prisma generate` + `prisma validate` clean.

## 6. Existing capability inventory (Phase 0 steps 8–9 — read before proposing abstractions)

- **M41 mission infrastructure** — `src/lib/riishe/mission/`: `executor.ts` (1169), `planner.ts` (450), `graph.ts` (292, task DAG), `store.ts` (367), `tools.ts` (187), `types.ts` (473), `verifiers.ts` (582), `verify-context.ts` (370), `safety.ts` (79), `evidence-summary.ts` (144), `handoff.ts` (106). Mission tables: `AgentMission`, `AgentMissionTask`.
- **M42 research gateway** — `src/lib/research/`: `pipeline.ts`, `provider.ts`, `rank.ts`, `direct.ts`, `reach/` (deterministic dispatch + techdocs), `browser/`, `academic.ts`, `security-community.ts`, `sensitive.ts`, `policy.ts`, `semantic-router.ts`, `geo.ts`, `cache.ts`.
- **M43 evidence engine** — `src/lib/research/`: `claim-verification.ts`, `contradiction-reasoning.ts`, `source-trust.ts`, `freshness.ts`, `evidence.ts`, `agent-evidence.ts`; knowledge memory + THE GUARD in `src/lib/riishe/evidence-memory.ts`; `EvidenceKnowledge` model.
- **Trust Engine** — `src/lib/trust/`: `approvals.ts`, `tasks.ts`, `receipt.ts`, `checkpoints.ts`, `resume.ts`, `digest.ts`, `adapters/`, `types.ts`.
- **Verification libraries (pre-existing)** — `src/lib/verification/` (config/pipeline/prompts), `src/lib/verify/` (citations/claims/exprcheck/injection), mission `verifiers.ts` pass rules.
- **Products** — `src/lib/{riishe,giftz,laxii,jazmii,gangzii}/` + `src/app/api/{riishe,code-giftz,laxii,jazmii,gangzii,trust,research,…}` routes; M43 claim-evidence integration inside the RIISHE orchestrator, giftz advisory enrichment, mission research evidence summary.
- **Recorded baseline quality** (M43 final): full suite 3099 pass / 0 fail / 10 standing honest skips across 231 files; production build clean; M43 unit suite 109 tests.

## 7. Architecture decisions for M44 (extend, never replace)

| # | Decision |
|---|---|
| D1 | Decision engine = new pure module(s) under `src/lib/riishe/mission/` consuming the M43 evidence summary; no new orchestration framework. |
| D2 | Action contracts extend M41 mission task types additively (typed contracts, pre/postconditions, risk/reversibility classes, retry + idempotency, checkpoints) — the existing planner/graph/executor stay the only mission engine. |
| D3 | Authorization boundary = server-side gate reusing Trust Engine approvals/checkpoints/receipts/digest; approvals bound to exact action + parameters + scope + plan version; stale/modified approvals rejected; AI-generated plans are never authorization. |
| D4 | Execution lifecycle states extend the existing mission task states with the M44 state machine (PLANNED → … → SUCCEEDED plus failure/recovery states). |
| D5 | Independent verification = postcondition evaluators per action type extending mission `verifiers.ts` + `src/lib/verify/*`; executor responses are never trusted as proof. |
| D6 | Recovery = failure classification + Trust Engine `resume`/`checkpoints` + compensation hooks; unverified execution observations can never enter trusted `EvidenceKnowledge` classes (M43 guard untouched). |
| D7 | Product integration stays at existing seams (mission tools, giftz handler, product verification passes) — additive, no new product, no provider-name exposure. |
| D8 | Zero customer-UI changes unless an existing surface must display a new honest state; black-gold identity untouched. |

## 8. Stop-and-report conditions check

No lost commits, no destructive changes, no unresolved M43 publication conflict (the remainder is preserved in-line), no security-critical architectural conflict found. M44 proceeds on the stacked baseline.
