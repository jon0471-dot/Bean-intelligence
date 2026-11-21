# 02 — Phase 0 Baseline: Repository, Release State and Feature Inventory

Measured 2026-11-20 on the working clone at `/home/z/my-project`
(remote `https://github.com/jon0471-dot/Bean-intelligence.git`). Every claim
below was verified against the actual repository, Git state, code and
documents — nothing is assumed from prior reports.

## 1. Git and release state (measured)

| Item | Measured value |
|---|---|
| Branch | `main` (HEAD `c472668`, working tree clean) |
| vs `origin/main` | local `main` is **11 commits ahead**; `origin/main` is a verified strict ancestor (fast-forward relationship) |
| Push status | **nothing pushed** — the publication freeze is in effect (see §2) |
| Local branches | 10 `backup/*` refs (the preserved WIP line), `m25-intel-lanes`, `m26-audit` (`b0b03da`), `m26-release` (`8cb93a9`), `m261-security-closure` (`601c90d`), `main` |
| Remote-tracking refs | `origin/main`, `origin/feat/laxii-jazmii-restoration`, `origin/feat/m26-2-media-capabilities`, `origin/fix/laxii-image-output-ux` |
| Migrations | **no `prisma/migrations` directory** — schema changes ship as additive, nullable/defaulted columns via `prisma db push` (documented per-block in `prisma/schema.prisma`) |
| Recovery material | no `recovery/` directory in the tree; the M26.1.x recovery/encryption artifacts live in committed root manifests only |

## 2. Security and publication gate — UNRESOLVED (evidence-based)

The historical security incident (session-token and database snapshot
material in published Git history) is **not resolved**. Authoritative records:
`M26_1_2_PUBLICATION_MANIFEST.md` (gate table), `M26_1_3_OWNER_GATES.md`,
`M26_1_4_PUBLICATION_MANIFEST.md`, `M26_1_5_R2_WIP_ENCRYPTION.md`,
`M26_1_5_R2_OWNER_VERIFICATION_REPORT.md`.

| Gate | State (measured 2026-11-20) |
|---|---|
| Public remote history rewrite | **NOT DONE.** M26.1.2 live-verified remote `main` still at the pre-rewrite SHA `a0148628…` (2026-11-17); the rewritten staging clone was lost and never re-derived |
| Pre-rewrite bundle + off-machine copy | M26.1.2: source files lost on this machine; owner attestation never received — **BLOCKED** |
| 10 WIP refs (the preserved pre-rewrite line) | **PRESENT locally** — 9 `backup/*` heads + `refs/backup/scratch-bf47b8c` with verbatim pre-rewrite history; out of publication scope forever (M26.1.2 §5) |
| 8 published DB blob SHAs (the objects a rewrite must render unreachable) | recorded in `M26_1_2_PUBLICATION_MANIFEST.md` §6; still reachable from local pre-rewrite history (expected — recovery path) |
| WIP bundle encryption (M26.1.5-R2) | **DONE — verifier ready.** `M26_1_5_R2_OWNER_VERIFICATION_REPORT.md`: `VERIFIER READY — OWNER EXECUTION REQUIRED`; 30/30 fixture assertions passed; one real run-2 container authenticated-decrypted and Git-restored in-workspace. **`GATE 1 CLOSED — OWNER VERIFIED` is NOT recorded** — it can only be recorded after the owner runs the verifier on their own PC and all ten restoration checks pass |
| Collaborator notification | no delivery evidence — **BLOCKED** (per M26.1.2) |
| Provider-credential residual check | owner confirmation pending |

**Consequence (standing rule):** no push, no merge, no history rewrite, no
force-push, no bypass of the collaborator push freeze, no deletion or
overwrite of recovery bundles, no treating the local sanitized state as proof
that GitHub's public history is cleaned. Implementation work is committed
**locally** on safe branches only. Note: the `download/` copies of the run-2
package and owner verifier that existed on 2026-11-19 are not present in this
recycled sandbox workspace; their contents are fully described in the
committed M26.1.5-R2 documents, and re-delivery to the owner is an open
transfer item.

## 3. Stack (measured)

- **Runtime:** Bun + Next.js 16.1.1 (App Router, SPA shell in `src/app/page.tsx`), React 19, TypeScript 5.
- **Data:** Prisma 6 + SQLite (`db/custom.db`, `connection_limit=1` single-writer; CAS `updateMany` settle pattern everywhere).
- **Jobs:** durable `GenerationJob` queue + append-only `JobEvent` transport (72 h pruning — the job row is the permanent record), embedded engine + standalone workers, lease/heartbeat crash recovery, cooperative cancel.
- **Auth:** scrypt passwords, opaque 256-bit session cookies (httpOnly, SameSite=None+Secure, Origin-checked CSRF compensation), API keys (`bgk_`, SHA-256-hashed, project-scoped), portal single-owner tenancy.
- **Design system:** black & gold tokens (`src/app/globals.css`), 47 shadcn/ui components, product accents in `src/lib/registry/products.ts`.
- **Canonical test gate:** `bun test --isolate tests/`; `npx tsc --noEmit`; `eslint`; `bun run build` (`docs/M26_RELIABILITY_TEST_PLAN.md`).

## 4. Implementation inventory (capability → evidence → gap)

Legend: ✅ exists and verified · 🟡 partially exists · ❌ missing.
"Minimal change" is the planned approach that reuses existing infrastructure.

| Capability | Exists? | Existing location | Missing behavior | Minimal change | Dependencies | Acceptance criteria | Risks |
|---|---|---|---|---|---|---|---|
| Trust Engine: truthful lifecycle | ✅ NEW (2026-11-20) | `src/lib/trust/types.ts`, `tasks.ts`; schema `TrustTask`/`TrustStep` | interactive-turn receipts; LAXII/JAZMII/CODE GIFTZ receipt adapters | add adapters per product; wire SSE route | trust lib | every background task has an honest receipt (done for RIISHE background); no completion without verification | none — additive tables, best-effort recording |
| Trust Engine: execution receipts | ✅ NEW | `src/lib/trust/receipt.ts`; `GET /api/trust/tasks/[id]/receipt`; UI `src/components/bean/tasks.tsx` | receipts for interactive RIISHE turns and coding tasks | extend recorder wiring | orchestrator events | receipt composes real ledger + stable digest | receipt noise if every micro-task recorded — keep "meaningful task" bar |
| Trust Engine: scoped approvals | ✅ NEW | `src/lib/trust/approvals.ts`; decision route; approval UI in Tasks view | agent actions that *request* approval (file-ops use their own CodeFileOperation ledger) | make destructive agent actions request TrustApproval before execution | agent planners | consume-once proven; digest binds decision to exact action | over-prompting users — request only consequential actions |
| Trust Engine: evidence ledger | ✅ NEW | `TrustEvidence`; RIISHE adapter stores sources with channel/engine provenance + tool runs + document evidence | page/section locators for documents; per-claim links in answers | extend `intel/grounding` + documents pipeline to emit locators | research pipeline | claims linkable to sources; extracted vs model_interpretation separated | evidence volume — capped (200/task) |
| Trust Engine: checkpoints/recovery | ✅ NEW (lib) | `src/lib/trust/checkpoints.ts` (append-only, resume-point semantics) | executors that actually resume from checkpoints | resume path in coding handler + long tasks | handlers | resume never replays side effects; checkpoint superseded on use | double-execution — consume/supersede on use |
| RIISHE unified chat | ✅ | `src/lib/riishe/orchestrator.ts` (Understand→Retrieve→Tools→Solve→Verify→Respond), SSE + background job paths, citations UI (`citation-view.ts`), claim audit (`claims.ts`) | model/provider selection surfacing in UI; receipts shown in-chat | Tasks view (done) + model info panel (Phase 2) | registry | one chat experience; states from actual execution | none |
| Project Memory | 🟡 | `RiisheMemory` model, `src/lib/riishe/memory*.ts` (save/forget/list, sensitivity guard, limits), REST `/api/riishe/memory` | user edit, export, conflict detection beyond exact dedupe, retrieval explanation | additive columns + endpoints | memory-db delegate | CRUD + export + why-retrieved explanation | schema migration on SQLite — additive only |
| Research Agent | 🟡 | `src/lib/research/pipeline.ts` (queries, caching, page reads, reach lanes), evidence packs, semantic router | task-shaped research reports with structured sections + receipt per research task | wrap pipeline in a TrustTask (planned steps: queries → reads → report) | research pipeline + trust | report + sources + receipt; no fabricated sources | provider rate limits (bounded already) |
| Document Intelligence Agent | 🟡 | `src/lib/files/extract.ts` (PDF/DOCX/XLSX/PPTX/text, honest notes), `src/app/api/riishe/documents/*`, document-aware turns | document-grounded Q&A mode that refuses general-knowledge substitution; page/section references; deliverables | grounding mode flag + locator capture from extractors | files/extract, orchestrator | answers grounded in provided material or honestly refused | scanned PDFs (no OCR — stated) |
| CODE GIFTZ Engineering Agent | ✅ (strongest base) | `src/lib/giftz/turn.ts`, `src/lib/code/file-ops/*` (planHash approval ledger), versions/rollback (M22), refactoring (M25), sandbox | TrustTask receipt per coding task; checkpoint/recovery for long runs | giftz trust adapter mirroring the RIISHE one | file-ops ledger | diffs shown; verification outcomes exact; never claims pushed | sandbox constraints unchanged |
| Model transparency + zero-budget | 🟡 | `src/lib/registry/*` (backends/models/products), 9-state health semantics, cost-guard/account-quota, llama.cpp local lanes, client-compute probes (WebGPU/WASM) | user-visible model/runtime identity panel; device-fit recommendations UI | Phase 2 UI over existing registries | registry, client-compute | no hidden fallback; availability honest; no paid defaults | model identity is private per ARCHITECTURE.md — public projection must stay sanitized |
| Reliability/privacy/security readiness | 🟡 | M26 queue audit fixes, security sweep docs, rate limits, quotas, retention, GDPR deletion | launch-hardening pass + supported-capability matrix publication | checklist-driven pass (07) | all | zero false-success reports | publication gate (§2) |

## 5. Known issues and honest limits (measured)

1. **Publication freeze (release blocker for any GitHub publication)** — §2. Safe isolated work continues locally.
2. **GANGZII is UI-orphaned by design**: `src/components/bean/gangzii.tsx` exists (1,896 lines) but is not mounted in `page.tsx`/shell/`BEAN_PRODUCTS`; its routes fail honestly with `NO_BACKEND`. Do not expose it until a real backend exists.
3. **Background job surface had no UI consumer** — fixed 2026-11-20 by the Task receipts view (`/api/ai/jobs` now has a UI-adjacent surface via Trust Engine receipts; job events remain SSE-only).
4. **Memory gaps** — no user edit/export/conflict explanation yet (Phase 2 scope).
5. **LAXII conversational editing and background removal measured Blocked** on this host (see Dashboard capability rows; provider-shape blocker `LAXII_EDIT_CONTRACT_BLOCKER` was resolved 2026-11-08, current blocks are host/worker related); Diffusers worker honestly `not-configured` (no GPU).
6. **Scripts TypeScript baseline** — earlier sessions recorded ~135–142 pre-existing `scripts/` tsc errors; current measured `tsc --noEmit` reports **0 errors repo-wide** (scripts baseline was cleaned between sessions).
7. **Observed flake**: `tests/unit/research-latency.test.ts` (freshness cache) failed once under full-suite load and passed standalone and on full-suite re-run — timing-sensitive, pre-existing, unrelated to Trust Engine work.
8. **No `prisma/migrations`** — deployment must run `prisma db push` (additive, non-destructive in this schema's discipline). See 09.

## 6. Test baseline (measured 2026-11-20)

| Check | Command | Result |
|---|---|---|
| Full suite | `bun test --isolate tests/` | **2224 pass / 0 fail** (162 files, 39,701 assertions) incl. 36 new Trust Engine tests |
| TypeScript | `npx tsc --noEmit` | **0 errors** (src + tests + scripts) |
| Lint (touched files) | `eslint` | clean |
| Production build | `bun run build` | success; all 5 `/api/trust/*` routes registered |
| Live path | background RIISHE turn via `/api/ai/jobs` on the dev server | job completed; receipt recorded with honest `completed_with_limitations` (states: `UNVERIFIED`), verification step `failed`, digest `c8c2b1f2…e2ebb`; UI verified at desktop + mobile sizes; disposable account deleted afterwards |
