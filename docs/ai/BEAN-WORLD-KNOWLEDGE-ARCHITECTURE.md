# BEAN World Knowledge Architecture

**Status:** Implemented and verified (commits `68d7590`, `d1ad9bb`)
**Scope:** The shared intelligence layer inside BEAN's existing backend — invisible to users, additive to all four products.

## 1. What this is

BEAN Intelligence is a shared, lightweight knowledge-retrieval, reasoning-context, verification and generation-conditioning layer built **inside the existing backend**. The internet supplies information and references; **the existing four BEAN models produce every answer, image, video and piece of code**:

| Product | Model lane (unchanged) |
| --- | --- |
| RIISHE | Hosted chat primary (authorized gateway) — the deployment's Qwen3-class chat lane |
| LAXII | Hosted text-to-image + hosted/managed editing (authorized gateway) |
| JAZMII | Hosted video (authorized gateway; async tasks) |
| CODE GIFTZ | Hosted coding model (authorized gateway) |

No new model, no new LLM, no new inference server, no new provider, no Ollama, no standalone product, no user-facing intelligence dashboard. The layer is code under `src/lib/intel/` plus minimal additive hooks in the four products' existing execution paths.

## 2. Module map

```
src/lib/intel/
  language.ts      Universal multilingual understanding: Unicode-script language
                   identification (en/ta/hi/ml/ar/es/zh/ja + und), mixed-language
                   segmentation, transliteration awareness, Unicode-safe
                   normalization, proper-noun/technical-term/measurement
                   preservation, search-language selection. Pure, microseconds.
  understanding.ts Unified prompt understanding: intent classification per
                   product lane, 24-domain professional taxonomy (routing, not
                   knowledge), creature/nature/material/physics-action/place
                   extraction, conservative ambiguity flags. Pure.
  world.ts         Structured world-knowledge components: human anatomy &
                   locomotion, animal species (crow, eagle, cat/dog, monkey,
                   elephant, reptile/aquatic) and locomotion, nature (waves,
                   waterfall, fire/smoke, rain/storm, wind/vegetation,
                   snow/ice), materials (glass, metal, wood, rubber/cloth,
                   liquids, collisions/vehicles), physics (gravity/momentum,
                   friction/fluid, optics/shadows), space-time continuity.
                   Assembled on demand — no knowledge database, no warehouse.
  cinema.ts        Cinematography & visual intelligence: shot types, camera
                   moves, lens/DOF, lighting set-ups, color treatment,
                   composition tables; extraction verbatim-first, safe defaults
                   for video (static + subtle push-in), continuity directives.
  grounding.ts     Generation grounding pipeline: mode decision (none / facts),
                   bounded snippet-only retrieval through the EXISTING
                   authorized gateway search, evidence digest, per-product
                   conditioning compilers with hard character budgets.
  crosslingual.ts  One bounded English query variant for non-English prompts
                   (proper nouns preserved verbatim); honest degrade.
  techdocs.ts      CODE GIFTZ official-docs retrieval: deterministic
                   library/version detection, official-host-first ranking,
                   untrusted-data labeling. Bounded, honest degrade.
  vision.ts        Bounded vision service over the EXISTING gateway vision lane
                   (glm-4.5v via createVision — the same lane already proven in
                   src/lib/files/media.ts). Breaker-aware, non-fatal.
  continuity.ts    JAZMII continuity engine + LAXII verification: real ffmpeg
                   frame extraction, vision scene-state extraction, defect
                   checklists (limbs, identity, clothing, lighting, camera,
                   collisions), honest method reporting.
```

**Existing infrastructure reused (not duplicated):** `src/lib/research/` (policy, semantic router, rank, cache, provider — the breaker-protected retrieval backbone), `src/lib/upstream/gateway.ts` (429 cooldown breakers per endpoint class), `src/lib/files/media.ts` (proven vision lane), ffmpeg/ffprobe, the four products' job lanes and `/api/ai/jobs` background engine.

## 3. How a generation flows through the layer

```
User prompt (any language)
   │
   ├─ understandPrompt()            deterministic, <1 ms measured
   │    language · intent · domains · entities · ambiguity
   │
   ├─ decideGenerationGrounding()   pure; live retrieval ONLY for real-specific
   │    subjects (species, places, technical domains); fantastical/abstract
   │    prompts take the fast path with zero network cost
   │
   ├─ [mode=facts] 1 bounded search (≤9 s timeout, single documented retry,
   │    shared cache) → evidence digest (host + snippet, top 3)
   │
   ├─ assembleWorldKnowledge()      ≤8 curated components (bounded)
   ├─ extractCinematography()       user directives verbatim; safe defaults only
   │    for what the user did not set
   ├─ [video] buildMotionTimeline() beginning → action → physics → end state
   │    (phrasing derived from the USER'S prompt, never invented events)
   ├─ [I2V] extractSceneState()     vision analysis of the reference frame →
   │    SCENE CONTINUITY directives
   │
   └─ compileConditioning()         budget-bounded block appended AFTER the
        verbatim user prompt: world reference → motion timeline → camera &
        light → scene continuity → fidelity notes (real hosts only)
```

The conditioned prompt goes to the **existing** hosted model exactly as before. The conditioning is metadata (`intel` in `resultJson`), audit-visible, never user-facing UI.

## 4. Honest-scope contracts

- **Not a physics simulator.** `world.ts` opens every rendered block with: *"PHYSICAL-REALITY REFERENCE (curated constraint knowledge, not a physics simulation)"*. Facts are conservative invariants (limb counts, gait phases, fracture behavior) — no invented measurements.
- **Never a fabricated source.** Fidelity notes cite only hosts actually returned by the provider. Retrieval failures degrade into recorded notes and generation continues with curated knowledge alone.
- **Verification is a detector, not a guarantee.** Continuity/image verification reports its method (`vision-frame-analysis` / `unavailable`) and lists observed defects; frame-level analysis explicitly cannot prove temporal smoothness. Defects are reported, not silently "corrected" (the LAXII edit path remains the only genuine correction route, unchanged).
- **No permanent knowledge warehouse.** Bounded per-process caches only (the research layer's TTL caches; a 256-entry cross-lingual cache). Nothing is persisted for reuse across restarts.

## 5. Latency design (measured targets)

| Stage | Budget | Measured |
| --- | --- | --- |
| Prompt classification (understanding) | 1–3 s | **< 1 ms** (pure, deterministic) |
| Search (when mode=facts) | 3–10 s | one bounded search, ≤9 s hard timeout |
| Page extraction | 3–15 s | skipped in generation paths (snippets only) |
| Evidence ranking / compile | 1–3 s | < 2 ms (pure) |
| Vision checks (workers only) | bounded | ≤20 s timeout, non-fatal, inside async jobs |

Chat answers (RIISHE) use the existing research pipeline whose measured p50 search is ~1–3 s; large image/video renders are unaffected by the 60-second target (they are async jobs).

## 6. What was deliberately NOT built

- No SearXNG/Crawl4AI/Firecrawl deployment (evaluated — see `BEAN-RETRIEVAL-AND-SOURCE-POLICY.md`).
- No new product, workspace, dashboard, background-jobs button or test-suite panel.
- No schema migration: intelligence metadata lives in existing JSON columns (`resultJson`/`paramsJson`).
- No separate inference of any kind: every model call rides the four existing lanes.
