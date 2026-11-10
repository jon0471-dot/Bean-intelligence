# LAXII IMAGE QUALITY UPGRADE

**Date:** 2026-11-10 · **Branch:** main · **Base HEAD:** `d4d059d` · **Scope:** LAXII image quality, prompt understanding, visual consistency and physical plausibility (Part B of the brief). All existing generation, editing, enhancement and preservation features preserved; no UI change; JAZMII/CODE GIFTZ untouched.

---

## 1. What already existed (audited, preserved)

The `bean-intel/1` layer shipped earlier (`src/lib/intel/{understanding,world,cinema,grounding,continuity}.ts`) already provides: verbatim-first prompt conditioning, curated world-knowledge components (human gait/hands/jump, birds/eagle/crow/cat-dog/primates/elephants/reptiles, waves/waterfalls/fire/rain/wind/snow, glass/metal/wood/rubber/liquids/vehicle collisions, gravity/friction/optics, space-time continuity), cinematography vocabulary (shots/moves/lens/DoF/lighting setups/color schemes/composition), bounded factual retrieval for real-specific subjects, and one bounded non-fatal vision verification per generation. All of it is preserved unchanged in behavior; the upgrade extends it.

## 2. The upgrades (Part B §1–§5)

### 2.1 Structured scene specification (§1) — `src/lib/intel/scene-spec.ts` (new)

Before generation, the prompt is compiled into a bounded `SCENE SPECIFICATION` block covering the brief's checklist: **subjects and identities, subject count with anatomical expectations** (persons: "exactly two arms, two legs and five digits per hand"; birds: "two legs, two wings with flight-feather groups, and a beak"; quadrupeds: "exactly four limbs of correct species proportions"), **exact-count preservation** ("count must stay exact, no duplicated or merged bodies"), **spatial layering** (stated foreground/middle/background honored; a conservative default layering only when unstated), **camera position** (default eye-level medium framing ONLY when the user set no shot/angle), **lighting direction, intensity and shadow behavior** (stated cues — backlit / golden hour / overhead / window / moonlight / firelight — each rendered with its physical shadow consequence; "shadows fall OPPOSITE the key and never point two ways"), **color harmony** (one harmonious palette + complementary accent when the user gave none), **materials and surface behavior** (glass refraction/transparency, liquid wetting, metal reflection/deformation, wood grain, cloth drape, rubber elasticity, rigid-solids fracture), **environmental conditions** (indoor/outdoor/night/wet/windy/fog/underwater with each condition's light implication), and **physical interactions and contact points** (sitting/standing → "contact points carry weight visibly"; holding → "hands CLOSE around what they hold — fingers wrap, surfaces deform"; falls/breaks → gravity + single contact zone + debris; pouring → single impact point + rising level; riding/perching → compression + balance).

Contracts kept: the user's prompt is verbatim and FIRST; the block is appended guidance; **explicit user directives always win** (defaults fill only unstated fields — unit-pinned); deterministic microseconds; bounded output; honest scope line ("compiled guidance… not a physics simulation"). The structured fields are persisted to `resultJson.intel.sceneSpec` for audit.

**Supporting extraction** (`src/lib/intel/understanding.ts`): `subjects`, `subjectCount` (number words/digits next to subject nouns; "a tiger" = 1; resolutions/years like "4k"/"2026" are NOT counts — unit-pinned), `spatialLayers`, `lightingDirection`, `environment` (multiple real conditions co-collected: "rain at night" yields both). `extractSubjectCount` is exported pure for tests.

### 2.2 Species-specific and optical knowledge (§2, §3) — `src/lib/intel/world.ts`

- **`big-cat-tiger`** (new): digitigrade gait (the backward "knee" is the heel/ankle — the classic reversed-knee deformity is named as a defect to avoid), irregular stripe bands (no geometric grids), heavy forequarters, sheathed claws at rest, Panthera muzzle proportions, diagonal walk with rolling shoulders. Covers the tiger/leopard/lion/jaguar/cheetah class — benchmark case B's subject.
- **`transparency-optics`** (new): background SHIFT through glass/water boundaries, edge displacement and doubling (the straw-bend at the surface line), specular edge streaks vs low-contrast faces, translucent shadows with caustic hotspots; defects-to-avoid include "background perfectly identical inside and outside the glass" and "shadows as dark as an opaque object". Covers benchmark cases D/E/J.
- No species rule contradicts actual anatomy; nothing claims the conditioning is a physics simulation (the scope line is rendered into every block).

### 2.3 Exposure and grading vocabulary (§4) — `src/lib/intel/cinema.ts`

Added color/grade entries: documentary available-light grade, long-exposure light trails, moody underexposed, bright airy overexposed, vintage film grade. The existing conflict rule is unchanged and now unit-pinned: user-explicit directives win; defaults never override a stated shot/angle/light (scene-spec renders its default camera/light lines ONLY when the user set nothing).

### 2.4 Bounded targeted correction (§5) — `src/lib/jobs/image-worker.ts`

The post-generation vision check now triggers a **single bounded targeted correction** when a SERIOUS defect class is detected (`seriousAnatomyDefects()`, exported pure): anatomy errors (extra/missing limbs, fingers, hands, faces, wings, joints/knees), **subject-count errors**, and **object-persistence/geometry/spatial-relation errors** (floating/unsupported objects, broken geometry) — lighting nuance alone never triggers regeneration. Exactly ONE correction runs through the EXISTING hosted editing pipeline (`editImage`, breaker-aware), with a prompt that fixes ONLY the observed defects and preserves composition/identity/clothing/background/lighting (`buildCorrectionPrompt()`). The corrected image is then re-checked ONCE; it replaces the original **only if the re-check shows fewer serious defects** — otherwise the original stays and the report says so. The full report persists to `resultJson.verification.correction` (`attempted`, `applied`, serious-defects before/after, re-check method/observation, duration, reason on failure). No repeated regeneration loops, no silent corrections, no passed-check claims for checks that did not run. The correction edit and a failed attempt are metered honestly (separate `image-editing` usage rows, success/failure).

The generation worker now also persists `sceneSpec` in the intel metadata (`layer: bean-intel/2`) and stores the VERIFIED bytes (corrected only when the re-check proved it better) for the artifact file, the `ImageAsset` row, and `resultJson`.

## 3. Verification

- **Unit tests** (`tests/unit/laxii-image-quality.test.ts`, 13 tests): subject-count extraction (words, digits, articles, and the 4k/2026 exclusions), lighting/environment cue physics, the compiled scene spec's coverage (subjects/anatomy/contacts/materials/light direction), explicit-directive precedence, budget bound, verbatim-first composition for LAXII vs the JAZMII timeline (scene spec must NOT leak into video conditioning), tiger/optics component assembly, and the correction decision + prompt.
- **Persistence tests** (`tests/unit/persisted-chat-attempts.test.ts`) and the full suite: **1228 pass / 0 fail**; `tsc --noEmit` clean (src+tests); ESLint clean; production build compiled successfully (46/46 pages).
- **Live benchmark A–J**: see `docs/reports/LAXII-VISUAL-BENCHMARK.md` — 7/10 completed with real artifacts + persisted intel/verification; 3 failures with exact upstream causes recorded; the correction path's live exercise is prepared as a gated re-run (`scripts/laxii-benchmark-rerun.ts`) because the shared account's 300/day budget hit 0 during the run.

## 4. Files changed

| File | Change |
|---|---|
| `src/lib/intel/scene-spec.ts` | **new** — structured scene specification compiler (§1) |
| `src/lib/intel/understanding.ts` | scene-signal extraction: subjects, subjectCount, spatialLayers, lightingDirection, environment |
| `src/lib/intel/world.ts` | `big-cat-tiger` + `transparency-optics` components (§2, §3) |
| `src/lib/intel/cinema.ts` | exposure/grading vocabulary (§4) |
| `src/lib/intel/grounding.ts` | scene spec wired into conditioning (budget-precedent for LAXII), `sceneSpec` in output, budget 2200→2600 |
| `src/lib/jobs/image-worker.ts` | bounded targeted correction + re-check + honest report (§5); verified-bytes persistence; intel layer 2 |
| `tests/unit/laxii-image-quality.test.ts` | **new** — 13 tests |
| `scripts/laxii-quality-benchmark.ts` | **new** — the A–J harness |
| `scripts/laxii-benchmark-rerun.ts` | **new** — gated C/E/J completion (post-refill) |
| `docs/evidence/laxii-benchmark/*` | benchmark JSON + 7 real artifacts |

## 5. Honest limitations

1. **The scene spec is prompt conditioning, not a guarantee** — it makes physical expectations explicit for the model but cannot force correct pixels; the vision verification is a detector with curated knowledge, and the correction is one bounded attempt, not a promise of perfection. Both say so in their own reports.
2. **Benchmark C/E failed on the provider's content filter** (HTTP 400 code 1301, false positives on benign prompts — exact log evidence in the benchmark report). The adjusted re-run prompts are ready but await the daily quota refill.
3. **Benchmark J failed on the exhausted account budget** (429, not retried, per quota discipline). Same gated re-run.
4. The live correction path (edit + re-check) is unit-verified but its first LIVE exercise lands in the post-refill re-run — the benchmark's D/F defects were recorded under the pre-extension filter, and no re-run was possible today (budget 0/300).
