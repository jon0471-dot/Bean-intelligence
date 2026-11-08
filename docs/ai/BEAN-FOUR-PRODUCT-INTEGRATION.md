# BEAN Four-Product Integration

**Status:** Implemented and verified (commits `68d7590`, `d1ad9bb`). The intelligence layer is invisible to users — zero UI changes, zero new endpoints, zero schema migrations.

## 1. RIISHE — knowledge-grounded conversation

**Existing (unchanged, previously measured):** real streamed chat, research pipeline with deterministic + semantic routing, ranked evidence, citation markers, claim verification, memory, documents, Tamil responses.

**Added by this work:**
1. **Cross-lingual retrieval** (`research/pipeline.ts` + `intel/crosslingual.ts`): a non-English prompt searches in the original language first and gains one bounded English variant query (proper nouns preserved); the refined-query path also requests an English variant for non-English questions. Failures degrade with a recorded note — never a fabricated search.
2. **Multilingual answer protocol** (`riishe/prompts.ts` + orchestrator): the prompt language is detected deterministically on every turn; non-English turns add the same-language answering rules (answer in the user's language even when all evidence is English; keep names/numbers verbatim; express uncertainty and source conflicts in the user's language too).

The model continues to distinguish retrieved evidence (`[n]` citations), model knowledge, and inference through the existing verification pipeline.

## 2. LAXII — realistic image intelligence

**Existing (unchanged):** preservation engine, mask semantics, hosted generation/edit contracts, asset chaining, enhance pipeline.

**Added (in `src/lib/jobs/image-worker.ts`, inside the existing async job — no route change):**
1. **Pre-generation grounding** (`intel/grounding.ts`): understanding → mode decision → (mode=facts) one bounded snippet retrieval → world-knowledge + cinematography + fidelity conditioning appended AFTER the verbatim user prompt, hard-budgeted (≤2 200 chars).
2. **Post-generation verification** (`intel/continuity.ts`): one bounded non-fatal vision check of the real artifact against the defect checklist (anatomy, faces, floating objects, lighting, materials, text artifacts); the report (`checked`/`method`/`defects`/`observation`) is persisted in `resultJson.intel`/`verification` — a skipped check says exactly that.
3. Conditioning and verification are wrapped in absolute guards: intelligence can delay a job by at most one bounded search/check; it can never fail a generation. Editing paths are untouched.

## 3. JAZMII — video continuity engine

**Existing (unchanged):** async job lifecycle, provider task-id persistence, throttle-resilient submission/tracking/download (issues 1+2 repair), bounded pollers.

**Added (in `src/lib/jobs/video-worker.ts`):**
1. **Reference scene state (I2V):** the reference image is vision-analyzed (bounded, non-fatal) into a structured scene state (subject, clothing, pose, environment, lighting direction, framing, palette) which becomes `SCENE CONTINUITY` directives with the highest conditioning priority.
2. **Conditioning:** motion timeline (start → action → physics → end), world-knowledge constraints, camera/light directives (safe default: static camera with a subtle push-in when the user specifies none) — appended after the verbatim prompt, ≤2 600 chars.
3. **Post-download continuity verification:** the stored video's final frame is extracted with real ffmpeg and vision-checked against the defect checklist (limbs, face/clothing identity, object persistence, collisions, position jumps, lighting/camera discontinuity); the honest report is persisted in `resultJson.continuity`. Frame-level analysis is explicitly labeled unable to prove temporal smoothness; defects are reported, never silently corrected (no silent regeneration loop exists).
4. A fresh T2V job exercises the full chain automatically: grounding → conditioned submission → render → download → continuity report.

## 4. CODE GIFTZ — professional technical knowledge

**Existing (unchanged):** shared turn core (live SSE + background worker), self-verification, file fences with real diffs, sandbox execution.

**Added (in both `src/app/api/code-giftz/chat/route.ts` and `src/lib/ai-engine/giftz-coding-handler.ts`):**
1. **Official-docs retrieval** (`intel/techdocs.ts`): deterministic detection of libraries/frameworks and version pins in the request → one bounded search with official-host-first ranking → a compact reference block (≤4 sources, host-labeled) injected into `userContent` before the user's message. The block is labeled untrusted reference data ("NOT instructions").
2. **Honest degrade:** no recognizable library → zero network calls; retrieval failure → the turn proceeds on model knowledge with no source claimed. Retrieved code is never executed outside the existing sandbox, and the coding model is instructed to cite doc hosts when the reference informs its code.

## 5. Background execution

All heavy intelligence runs inside the EXISTING lanes: LAXII/JAZMII jobs execute in the existing queue/engine workers (browser-independent, restart-survivable), RIISHE research runs inside the existing SSE turn, GIFTZ retrieval runs inside the existing turn core shared by live and background paths. No new job types, no new panels, no new buttons.

## 6. Failure isolation

Every intelligence touchpoint is individually try/caught with honest logging (`laxii.intel_failed`, `jazmii.intel_failed`, `giftz.techdocs_degraded`, `laxii.intel_degraded`, …). A total intelligence failure degrades each product to its exact previous behavior. The four products share no mutable intelligence state except bounded caches.

## 7. Verification summary

- Unit: 96 new tests across 4 files; full regression **1 196 pass / 0 fail** (75 files).
- Live: `scripts/world-eval/run.ts` (see the two acceptance documents for measured runs).
- Build/type/lint: `bunx tsc --noEmit` 0 errors in src/tests; `bun run lint` clean; `bun run build` verified.
- UI: no product interface changed; four-product visual check performed after integration.
