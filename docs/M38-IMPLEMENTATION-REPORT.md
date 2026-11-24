# M38 — RIISHE WORLD KNOWLEDGE ATLAS + UNIVERSAL ADAPTIVE AI + PROFESSIONAL CREATION ENGINE — IMPLEMENTATION REPORT

> Branch: `feat/m38-world-atlas-adaptive-ai-creative-engine` (from `origin/main` @ `52b40713d6c5fbc148b1ffb775e5115070d1006b`, verified by fetch before any change)
> Date: 2026-11-24 · Product: BEAN Intelligence · Primary AI: RIISHE · Budget: ₹0 recurring
> Every claim below carries real evidence; environmental blockers and unmeasured lanes are named, never papered over.

## 1. Git record

| Milestone | Commit | Remote verified |
|---|---|---|
| M38.1 atlas foundation | `e00e3cc` | `git ls-remote` = `e00e3cc` (after the daemon-flip recovery; local `main` restored to `origin/main`, no force-push) |
| M38.2–4 domain guides | `5c6b125` | `git ls-remote` = `5c6b125` |
| M38.5 lifecycle + coverage | `9f94245` | pushed (cherry-pick of `3462b9d` after the second daemon flip) |
| M38.6 quality routing | `b374ef0` | pushed |
| M38.8a standards docs | `62d4d6d` | `git ls-remote` = `62d4d6d` |
| M38.7 atlas retrieval integration | `69925f3` | `git ls-remote` = `69925f3` |
| M38.8b standards wiring | `d2bb304` | `git ls-remote` = `d2bb304` |
| M38.10 docs + acceptance fixture | (final commit) | verified at push time |

All pushes were normal fast-forwards on the feature branch only; `main` was never touched and is not merged without separate authorization.

**Environment incident, recorded honestly:** this sandbox's auto-commit daemon repeatedly flipped the working tree to `main` between commands. Three commits initially landed on local `main`; each was recovered by restoring `main` to `origin/main` and cherry-picking onto the feature branch (the M36 precedent). One production build was made from the wrong tree and was **repeated from the feature branch** — the M38 code (`search_atlas`, `buildEngineeringStandardsBrief`) was then verified present inside the built standalone by string search before the preview was served.

## 2. World Knowledge Atlas (Parts C & D) — 31 source-backed documents

- `docs/knowledge-atlas/` now holds **31 files** (foundation 5 + human anatomy & movement 5 + animals 7 + physical world 6 + human world & technology 5 + AI/agent knowledge 3), all passing the atlas validator (`scripts/m38-atlas-validate.mjs`: header schema, ≥3 numbered sections, references, ≥600-word substance for domain guides, relative-link integrity, coverage-map consistency, non-commercial license warnings).
- Human movement is covered by the schema in `01` (12-field action schema, controlled Class/gait/joint vocabularies); files 05–08 carry **22 fully-specified action entries** (walking, running, jump, squat, sit-to-stand, grasp, hammering, pointing, pouring, buttoning, plié, jab, freestyle stroke cycle, snatch, cartwheel, front kick, slip recovery, trip with protective reach, backward roll, soft landing, and more).
- Bird flight (`13`) is a dedicated physics reference (lift equation with every symbol, mass/area scaling, stroke phases, soaring modes, aspect ratio / wing loading as defined quantities).
- Source register (`02`) records publisher, URL, version, license, commercial-use flag and access date for every source; verification log dated 2026-11-24: **Uberon CC BY 3.0** (OBO Foundry page), **Motion-X CC BY-NC-SA** with per-sub-dataset licenses, **AMASS non-commercial research license** (MPI), **HumanML3D** (scripts only; AMASS-derived data not redistributable), **GBIF CC0/CC BY/CC BY-NC per dataset**, **GSAP 100% free since 3.13 (Webflow)**, **wllama MIT 4.0.0**. Non-commercial datasets are flagged as blocked for commercial BEAN use without separate authorization.
- Honest scope: `00` and `03` record explicit gap areas (quantitative biomechanics data, per-species pages, advanced physics depth, deep national histories, per-model catalogues) — "not yet documented" is never conflated with "does not exist".

## 3. Atlas ↔ RIISHE integration (Part E)

- New tools `search_atlas` (deterministic section scoring, title > heading > body, real scores, no drift-prone index) and `read_atlas_doc` (section-granular paged reads mirroring `read_document`'s contract) in `src/lib/riishe/tools/atlas.ts`, registered in the existing registry and admitted by `selectTools` under the SAME conditions as web search.
- Atlas sections enter the EXISTING citation universe as `ATLAS-<id> §<n>` sources (`bean-knowledge-atlas` host, review date as the date); honest unavailability when the docs tree is absent; no second vector DB, no second RAG, no memory-service duplication.
- 16 tests including real-library search quality (bird-flight ranking), paging honesty, no server-path leakage, registry + selectTools wiring.

## 4. Universal model ecosystem + adaptive inference (Parts B, B3–B6)

- **Execution lifecycle ladder (B2)** added additively to `src/lib/registry/capability-records.ts`: 11 stages from `discovered` to `operational`, last-verified-stage semantics with `blockedBy`; tests pin that a gate can never be skipped and only `execution-tested`/`output-validated`/`operational` are operational-representable.
- **Measured coverage report** (`docs/ai/MODEL-COVERAGE-M38.md`): the B2 capability table filled from REAL checks — MODNet CPU inference re-verified **2026-11-24: 483 ms, matte [0, 0.9943], SHA-256 pin `92e49898…` verified**; worker bundles built from pinned runtimes (WebLLM 5.88 MB / ASR 0.57 MB / segmentation 0.40 MB); WebGPU honestly **not measurable** on this host; lanes without real execution are labeled as such (a compiled bundle is never claimed as a model run).
- **Runtime research** (`docs/ai/UPSTREAM-RESEARCH-M38.md`): WebLLM 0.2.89 / Transformers.js 4.3.2 / onnxruntime-web 1.31.1 confirmed pinned-current; **wllama 4.0.0 (MIT) evaluated and NOT integrated** (no measured gap; no runtime added just to add one); no second gateway/registry; provider surface (OpenAI-compatible slot, Anthropic Messages adapter, Google GenAI by configuration) re-confirmed.
- **Quality routing (B5)**: `src/lib/client-compute/quality-routing.ts` — `resolveQualityRoute` decides local-approved / local-with-limitation / prefer-backend / require-backend / no-route from device tier, conservative mode, task complexity and honest model quality class. A weak local model **never silently replaces** a stronger authorized route; limitations are stated; local-only mode excludes backends by policy; 13 tests.
- Low-spec behavior (B4) preserved from M36 (conservative tiers that cannot be inflated, one-heavy-model slot, on-demand worker loading, page-shutdown release) and documented in the coverage report; B6 download/consent/integrity gates preserved and pinned by the existing suite.

## 5. CODE GIFTZ professional standards (Part F)

- Five new standards documents under `docs/agents/` (engineering workflow, UI/UX design, animation & interaction, anti-AI-slop gates, delivery checklist), cross-linked, with the definition-of-done line.
- `buildEngineeringStandardsBrief()` (bounded 3,500 chars) injected into **both** execution paths (live SSE route + background coding worker) before the user message; 13 tests pin the wiring, the brief content, and that existing prompt contracts (SYSTEM_PROMPT, project context, targeted-edit brief) are untouched.
- Existing frontend-intelligence tooling (component catalog, GSAP patterns, Vanta) is complemented, not duplicated.

## 6. Real execution and preview evidence (Parts G & H)

- **Real CPU model execution**: MODNet ONNX, pinned SHA-256 verified, **483 ms**, matte range validated — re-run on this host on 2026-11-24 (the only lane where a full inference run is possible here; see §7 for the honest GPU/browser limits).
- **CODE GIFTZ acceptance fixture** (`evals/acceptance/m38-giftz-showcase/` — isolated, not part of the product): a professional landing page (editorial outdoors identity — forest green/cream, serif voice, no blue/purple gradients, no glassmorphism, every control functional, labelled demo data) with purposeful animations (IntersectionObserver reveal, animated stat counters, hover/focus states, `prefers-reduced-motion` honored, transform/opacity only). **Browser-verified with agent-browser**: desktop 1280×800 (title correct, nav click navigated to `#walks`, form validated + confirmed with real input, **console clean, zero page errors**), then 390×844 mobile (desktop nav hidden, Menu toggles the mobile nav — `MOBILE-NAV-OPEN`, `aria-expanded` synced).
- **Main app preview**: production standalone rebuilt ON the feature branch and string-verified to contain the M38 code, then served on port 3000 (HTTP 200, correct title, all embedded engines started). The platform Preview Panel serves the running application; note the preview serves the M38 working branch (not merged to main).

## 7. Verification totals and honest limitations

| Check | Result |
|---|---|
| Full test suite (`bun test --isolate tests/`) | **2764 pass / 0 fail / 5 skip across 209 files** (baseline 2652/0/5 on 201 files → **+112 tests, +0 failures**) |
| `npx tsc --noEmit` | 155 errors, byte-equal to the `origin/main` baseline count → **0 new type errors** |
| ESLint (11 touched files) | clean |
| `bunx prisma validate` | valid (no schema changes made at all) |
| Secret scan (full `origin/main..HEAD` diff) | clean |
| Production build (`bun run build`) | success; heavy runtimes remain out of the app graph |

**Not measured in this environment (stated, not hidden):** real-browser WebGPU inference (no adapter in the sandbox; the WGSL round-trip benchmark ships and is behavior-tested; a live WebLLM model download/run was deliberately not performed — the no-auto-download policy is itself a product behavior); the §H performance profiles on low-end/dedicated-GPU hardware (CPU-only host); live remote-provider calls (protocol + gate tests carry those lanes). Preserved regressions all green in the full run: M35 slot release, M36 registry/delegation/identity hygiene, M37 workflow/delegation/task-progress, Trust Engine, Project Memory, CODE GIFTZ sandbox, LAXII/JAZMII/GANGZII.

## 8. Remaining work

1. Real-GPU acceptance (tier-4 path) and the four §H performance profiles on real hardware.
2. Live remote-provider acceptance run (operator credential) — protocol tests exist; live calls not made from this sandbox.
3. Optional wllama adoption if a CPU-only chat requirement is confirmed on real low-spec devices.
4. Atlas growth per `03-coverage-gaps-and-update-policy.md` (G1–G8), and the commercial-use license path for Motion-X/AMASS-derived data if ever needed (G6).
5. Merging `feat/m38-world-atlas-adaptive-ai-creative-engine` into `main` — awaiting separate owner authorization, per policy.
