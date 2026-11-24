# M37 — RIISHE FULL-WORKFLOW AGENT — IMPLEMENTATION REPORT

> Branch: `feat/m37-riishe-full-workflow-agent` (from `origin/main` @ `c6cb7f95e63e87b1073a52b101835e8becfd44d7`, verified by fetch before any change)
> Date: 2026-11-24 · Product: BEAN Intelligence · Primary AI: RIISHE
> All evidence below is measured in the deployment host. No mock is reported as real execution; environmental limitations are named.

---

## 1. Git SHAs

| | SHA |
|---|---|
| Starting `origin/main` (verified by fetch before any change) | `c6cb7f95e63e87b1073a52b101835e8becfd44d7` |
| Working branch | `feat/m37-riishe-full-workflow-agent` |
| Implementation commit | recorded in §11 (publication record) |
| Remote verification | recorded in §11 (independent `ls-remote` after push) |

Publication SHAs are recorded in §11 after the push (the report cannot know its own commit's SHA before it exists; the publication commit below finalizes this section, the same reconciliation pattern as M36).

## 2. Scope discipline

M37 explicitly forbids a competing agent framework, queue or database architecture (`§4`). Accordingly **no upstream framework was adopted and no new runtime dependency was added** — the coordination layer is composed from the EXISTING orchestrator, bounded tool loop, durable `GenerationJob` queue, CODE GIFTZ turn pipeline, research pipeline and Trust Engine. Every new capability is a tool the existing registry can gate, or a deterministic module with no I/O.

## 3. Implemented (all mapped to the brief)

**§1 Research agent (improve, not rebuild)**
- `src/lib/riishe/contradictions.ts` (new, 290 lines): deterministic, conservative cross-source claim comparison over the ACTUAL retrieved text (title + snippet + full-page excerpt). A contradiction is flagged only when two DIFFERENT sources attach DIFFERENT values of the SAME measure (dead/injured/percent/money/magnitude/years-old/displaced/arrested/date) to a shared entity anchor. Bounded (`MAX_SOURCES_SCANNED=24`, `MAX_TEXT_CHARS=40k`, `MAX_SENTENCES=400`, `MAX_CONTRADICTIONS=5`). It never decides which source is right; the disagreement is surfaced, attributed to `[n]` sources, and never silently resolved.
- Orchestrator wiring: contradiction scan feeds (a) a `cross-source consistency` verification check (status `warning`), (b) the verification note, (c) the bounded claim-repair pass as an explicit repair item ("state each disagreement explicitly, attribute every version to its source [n], never silently pick one").
- Existing pipeline untouched: evidence packs, citation verification, full-page-read vs snippet distinction (`pageRead`), honest degradation notes all continue to work as before (regression-pinned by the existing research suites, still green).

**§2 Document intelligence agent**
- `src/lib/files/extract.ts`: PDF extraction now emits GENUINE `[page N]` markers built from pdf-parse v2's per-page text layer (never invented for sources without page metadata); the honesty note states the markers' provenance; scan-only pages remain explicitly un-analyzed (no fabricated OCR claims).
- `src/lib/riishe/prompts.ts`: page-reference rule (cite `[page N]` only when the extraction carries it; otherwise cite by document name + quote), structured-summary rule (every point traceable to the extraction).
- New `DOCUMENT_COMPARISON_PROTOCOL` (two+ documents: per-document attribution by name, agreements stated, disagreements presented side by side as unresolved, extraction limits carried through) and `STRICT_DOCUMENT_GROUND_PROTOCOL` (documents-only contract: no general knowledge substitution, "the documents do not contain X" IS the answer, relaxation only by asking).
- `capability-plan.ts`: new deterministic `docOnlyGrounding` flag (narrow phrasing set: "based only on the documents", "only from the attached report", …).
- Orchestrator: when `docGrounded` ∧ documents attached, web retrieval is SUPPRESSED for the turn (`searchNeeded = … && !docGrounded`) so general knowledge can never silently substitute the documents; the persisted metadata records `docGrounded: true`.
- Owner checks and file limits untouched: documents are still ownership-validated in the route, `MAX_STORED_PER_USER=100`, size caps and unsupported-format notes unchanged.

**§3 CODE GIFTZ engineering agent**
- `src/lib/riishe/code-delegation.ts` (new, 383 lines): two tools.
  - `delegate_coding` (explicit permission `allowCodingDelegation`): submits a REAL background `code-giftz`/`coding-task` job through the SAME gates as the product route — router preflight (availability, rate limit, quota, budget; slot released immediately), same dedupe key + active-duplicate refusal, same per-user active-job cap, same retry message-collapse, owner-scoped project resolution (a foreign id is an honest refusal), project auto-create only when none resolved, audit `riishe.coding_delegate`, dynamic-import enqueue (import-cycle guard as in M36 specialists). It NEVER claims an artifact: the honest output is a queued job id + where results will appear.
  - `check_coding_job` (standard, read-only, owner-scoped): probes the REAL `GenerationJob` — in progress (with a Trust-aware "WAITING FOR APPROVAL" note when the ledger task is `waiting_for_approval`), failed/cancelled with the real reason, or completed with the REAL file changes, self-verification summary and sandbox-run evidence from `resultJson`. Foreign or unknown job ids are honest refusals.
- `capability-plan.ts`: new `codingDelegation` flag with a narrow build-request pattern (`CODE_BUILD_RE`) guarded by `QUESTION_OPENER_RE` (how-do-I / explain questions never delegate; `run_code` stays the tool for snippet execution).
- Orchestrator: `allowCodingDelegation` = route permission key AND capability plan (the same two-key gate as code execution and M36 media delegation); `selectTools` grants `delegate_coding` + `check_coding_job` only when both agree; a single-domain non-delegation turn's tool universe is provably unchanged (test).
- Preserved exactly: project ownership, plan-hash checks, version history/rollback, sandbox isolation, file-operation approvals (destructive rename/move/delete exist ONLY in the CODE GIFTZ product surface; a delegated job can never delete or move project files), and "never publish to GitHub automatically" (delegation creates no external calls beyond the existing product job path).

**§4 One RIISHE workflow**
- `src/lib/riishe/workflow.ts` (new, 75 lines): PURE deterministic multi-domain detection (`detectWorkflow`) — research/documents/coding/media/computation parts, each requiring its own concrete signal; active only at ≥2 parts, so ordinary single-domain turns behave exactly as before. `WORKFLOW_PROTOCOL` shapes the reply into plan → execute with real tools → Findings (cited) → Unfinished work → Verification. The protocol cannot grant any capability the orchestrator did not already expose; every step acts only through the existing bounded tool loop.
- Orchestrator: workflow detection runs after the capability plan; when active, the planning stage is a REAL emitted event and the protocol is injected. The example flow (research → analyze attached report → build → verify) is exercisable end-to-end with the real tools; approvals still gate everything the brief says they must.

**§5 Task progress and Trust receipts**
- `states.ts`: `TASK_STAGES` vocabulary (`planning, researching, reading-documents, delegating, approval-waiting, executing, verifying, completed, completed-with-limitations, failed, cancelled`) + `MessageMetadata.taskStages / workflow / docGrounded` (additive; customer-safe, no backend identities).
- Orchestrator: `emitTaskStage` fires ONLY at real execution events — workflow planning, retrieval start, `read_document`/`analyze_image` tool starts, `delegate_coding` submission, sandbox `run_code` start, the verification phase, and the terminal outcome derived through `mapRiisheStatesToOutcome` from the ASSIGNED response states (never from model claims). Each stage once per turn; `approval-waiting` is parsed from the REAL `check_coding_job` output.
- Wire + route: `OrchestrationEvent` gains `{type:'task'}`; the chat route forwards it as an additive SSE frame AND into the Trust ledger (`trust.onTaskEvent`); `sse-client.ts` passes `task` frames through (additive — old clients unaffected).
- Trust adapter (`src/lib/trust/adapters/riishe.ts`): `onTaskEvent` records a `workflow-plan` measurement evidence row for real planning, a `delivery` step for a real coding delegation, an `approval` step for a real waiting-for-approval state; rapid events are SERIALIZED through a promise chain so the ledger's per-task monotonic seq stays unique; steps settle honestly with the turn outcome; cancellation skips/cancels them.
- UI (`riishe-messages.tsx`, `use-riishe-chat.ts`): server-driven `task` frames render as honest stage chips (Planning… / Searching the web… / Reading documents… / Delegating to the engineering workspace… / Waiting for approval… / Executing in the sandbox… / Verifying…), visible both while the draft is empty and while content streams; the persisted terminal chip (Completed / Completed with limitations / Failed / Cancelled) renders from the message metadata after reload; strict-grounded turns show "Answered from your documents only". The UI renders ONLY what the server recorded — no client-side progress invention, no backend/model identities.
- Provider identity hygiene preserved and re-asserted by tests (forbidden-pattern scans over the UI files).

## 4. Files changed (22; +2447/−203 vs `origin/main`)

| File | Change |
|---|---|
| `src/lib/riishe/code-delegation.ts` | new (383) |
| `src/lib/riishe/contradictions.ts` | new (290) |
| `src/lib/riishe/workflow.ts` | new (75) |
| `src/lib/riishe/orchestrator.ts` | +166 (two-key coding gate, workflow detection, doc-grounded suppression, task-stage emission, contradiction wiring, verifying stage) |
| `src/lib/riishe/capability-plan.ts` | +68 (codingDelegation, docOnlyGrounding + narrow regexes) |
| `src/lib/riishe/prompts.ts` | +32 (comparison/strict-ground protocols, page-reference rule, WORKFLOW_PROTOCOL wiring) |
| `src/lib/riishe/states.ts` | +49 (TASK_STAGES, metadata fields) |
| `src/lib/riishe/sse-client.ts` | +4 (additive task frame) |
| `src/lib/riishe/tools/builtin-registry.ts` | +5 (delegate_coding, check_coding_job registration) |
| `src/lib/files/extract.ts` | +33 (genuine PDF `[page N]` markers) |
| `src/lib/trust/adapters/riishe.ts` | +74 (onTaskEvent ledger wiring, serialized chain) |
| `src/app/api/riishe/chat/route.ts` | +8/−2 (permission key + userId already present; task-frame forwarding) |
| `src/components/bean/riishe/riishe-messages.tsx` | +66 (stage chips live + terminal, doc-grounded badge) |
| `src/components/bean/riishe/use-riishe-chat.ts` | +15 (liveTaskStage consumption, additive meta fields) |
| `tests/unit/riishe-workflow.test.ts` | new (21 tests) |
| `tests/unit/riishe-code-delegation.test.ts` | new (25 tests) |
| `tests/unit/riishe-task-progress.test.ts` | new (8 tests) |
| `tests/unit/files-pdf-page-markers.test.ts` | new (2 tests, real PDF fixture) |
| `docs/M37-IMPLEMENTATION-REPORT.md` | new (this report) |
| `m37-work/patch*.py` (11 files) | removed (one-off development scaffolding; the implementation it produced is fully landed in `src/`) |

No Prisma schema change was needed — delegation reuses `GenerationJob`/`CodeProject`/`CodeMessage` rows exactly as the product route does ("additive database changes only where genuinely necessary": none were).

## 5. Test totals (measured on the final committed tree)

- **Full suite** (`bun test --isolate tests/`): **2708 pass / 0 fail / 5 skip** across 205 files (41,710 expect calls). The 5 skips are the pre-existing environment-gated renders (HyperFrames/ffmpeg-class), unchanged from M36.
- **New M37 tests: 56** — riishe-workflow 21, riishe-code-delegation 25, riishe-task-progress 8, files-pdf-page-markers 2 (2708 = M36's 2652 + 56).
- **M36 regression**: `riishe-specialist-delegation.test.ts` 17 pass; model registry / client-compute / UI-identity suites all green within the full run.
- **M35 regression**: `riishe-chat-slot-release.test.ts` green within the full run (slot release on completed/failed/cancelled/timeout, burst cap, product+user isolation).

## 6. Static checks

- **TypeScript** (`npx tsc --noEmit --incremental false`): 158 diagnostics on the branch. Measured against `origin/main` in an IDENTICAL fresh worktree (same symlinked node_modules): 159 diagnostics. **M37 introduces zero new errors**; the shared set is pre-existing debt in `scripts/`, `validation/` and `src/workers/` harnesses (the workers' `@mlc-ai/web-llm` and `@huggingface/transformers` diagnostics reproduce at `origin/main` in the same worktree setup and stem from the documented nested-dependency design in `src/workers/package.json`). Two type errors inside the new M37 test files (duplicate key; incomplete fake `EvidencePack`) were found by this comparison and fixed before commit.
- **ESLint**: 0 problems across all 18 touched source/test files.
- **Prisma** (`bunx prisma validate`): schema valid.
- **Production build** (`bun run build`): succeeds (Next.js standalone + worker bundle steps complete; `copy-native-libs` finishes). Note: the build regenerates `public/ort/*` and worker bundles from the locally installed runtime; the regenerated assets were restored to the committed versions before commit so the branch diff stays M37-only.

## 7. Security scans

- Full-diff secret scan (key/token/bearer/private-key patterns): clean (only `task-stage` matched the `sk-` pattern as a false positive).
- Identity hygiene: forbidden-pattern scans over the RIISHE UI files pass (`WebLLM`, `web-llm`, `onnxruntime`, backend channel names, etc. — none present); `metadataToJson` keeps backend ids out of persisted metadata (M36-D behavior unchanged).
- No new host-command surface: the only execution paths remain the existing restricted sandbox (`run_code`, unchanged) and the existing CODE GIFTZ sandbox route (approval-gated, unchanged).
- No arbitrary network surface: the delegation submits through the existing queue only.

## 8. Trust receipt evidence (what the ledger records for real events)

For a workflow turn the composed receipt contains: fixed orchestration steps (retrieval/tool/generation/verification) with sources + tool-run evidence as before, PLUS:
- `workflow-plan` measurement evidence ("capability domains coordinated: research+documents+coding") recorded when the workflow actually activated;
- a `delivery` step ("Coding delegation to the engineering workspace") started when `delegate_coding` actually submitted, settled with the turn outcome;
- an `approval` step ("Waiting for a required approval") started only when the REAL job probe reported `WAITING FOR APPROVAL`;
- the terminal outcome still passes `mapRiisheStatesToOutcome` (never upgrades UNVERIFIED/TOOL_UNAVAILABLE/PARTIALLY_VERIFIED to plain completed).

All receipt paths are covered by `riishe-task-progress.test.ts` (8 tests) against an in-memory ledger fake, and the composed-receipt digest path is unchanged.

## 9. Preservation checklist

- RIISHE UI and streaming: unchanged except additive stage chips (old events still handled; `task` frame is additive).
- Project Memory: untouched (M33 surfaces intact; full suite green).
- M35 concurrency fix: untouched and regression-pinned.
- M36 model registry, specialist delegation, model routing, UI privacy, local compute: untouched and regression-pinned.
- Trust Engine and approval controls: extended additively (`onTaskEvent`); all existing lifecycle/approval rules intact (`trust-*` suites green).
- CODE GIFTZ sandbox and project protections: untouched; delegation cannot bypass preflight, dedupe, caps, plan-hash checks, rollback or approvals.
- LAXII / JAZMII / GANGZII: untouched.
- Database: no schema change; provider routing and cost controls untouched.

## 10. Environmental limitations (honest)

- No live end-to-end browser run of a full workflow against real provider credentials was performed in this deployment host (no provider credential is configured in this environment; the hosted gateway path is exercised through the same adapter seams the existing suites already pin). The UI verification for this milestone is: production build compiles the changed components, the identity scans pass, and the server-driven stage logic is pinned by unit tests against the real orchestrator/recorder — a manual browser walkthrough with a configured provider remains recommended operator validation.
- The TypeScript diagnostic set on this host is non-empty both before and after M37 (pre-existing harness debt, quantified in §6); the milestone gate used is "no new diagnostics introduced", verified by an identical-environment baseline comparison.
- The working tree on the deployment host is subject to an environment auto-commit mechanism (UUID-named commits on the checked-out branch). Two such auto-commits had landed on the local `main` during development (partial M37 fragments + a 6.6 MB acceptance binary). Local `main` was restored to `origin/main` (`c6cb7f9`) — the documented, non-force recovery — and all M37 work lives on the working branch. No shared remote history was rewritten anywhere in this milestone.

## 11. Publication record (finalized after push)

Recorded in the publication commit on the same branch: implementation commit SHA, `git ls-remote` verification, and the independently fetched remote SHA comparison. See the commit history of `feat/m37-riishe-full-workflow-agent` for the exact values; they are also reproduced in the final milestone report to the operator.
