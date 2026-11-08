# BEAN Physical Grounding Evaluation

**Status:** Verified 2026-11-08 (eval harness `scripts/world-eval/run.ts`; unit suite `tests/unit/intel-*`; commits `68d7590`, `d1ad9bb`).

## 1. Scope and honest framing

This document reports what the grounding/conditioning/verification layers DO, with measured evidence, and states plainly what they are NOT: a text knowledge base is **not a complete physics simulator**, and a vision frame check **cannot prove temporal smoothness**. Every conditioned block opens with the scope line *"curated constraint knowledge, not a physics simulation"*, and every verification report records its method and limits.

## 2. Deterministic grounding layers (measured live, throttle-independent)

| Eval case | Prompt | Assembled knowledge | Mode | Latency | Result |
| --- | --- | --- | --- | --- | --- |
| crow-takeoff-video | "a crow taking off from a branch and flying…" | bird-flight, crow, wind-vegetation, wood-fibrous | facts | ~6–15 ms (+1 bounded search when the gateway allows) | PASS |
| human-walk-video | "a person walking through a busy market street" | human-proportions, human-walk-run | none (no live retrieval needed) | 0.4 ms | PASS |
| waterfall-fire-image | "a waterfall pouring into a river beside a campfire with smoke…" | waterfall-river, fire-smoke, liquid-pour | none | 0.4 ms | PASS |
| glass-shatter-image | "a glass window shattering after a cricket ball strike" | wind-vegetation, glass-brittle | none | 0.3 ms | PASS |
| cinema-directives | "close-up … golden hour, shallow depth of field, tracking shot" | — | — | <1 ms | PASS (all four directives extracted verbatim) |
| world-block-scope-honesty | eagle/storm prompt | 1 621-char bounded block with the scope line | — | <1 ms | PASS |

Contract checks pinned by these cases: the user's prompt stays **verbatim and first** in every conditioned prompt; mode=facts only for real-specific subjects (fantastical/abstract prompts take the zero-network fast path); assembly is bounded (≤8 components); fidelity notes cite only actually-retrieved hosts; retrieval failure degrades with a recorded note and never fabricates evidence.

## 3. Knowledge coverage (world.ts)

Curated structured components across the brief's six domains — **A** humans (proportions, walk/run gait with the flight-phase discriminator, jump/fall, hands/face, clothing), **B** animals (bird flight mechanics, crows, eagles/raptors, cats/dogs, primates, elephants, reptiles/aquatics with the fish-vs-whale tail-plane discriminator), **C** nature (waves, waterfall/river, fire/smoke, rain/storm, wind/vegetation, snow/ice), **D** materials (glass brittle fracture, metal ductility, wood grain, rubber/cloth elasticity, liquid viscosity/pour, collisions/vehicles), **E** physics (gravity/momentum, friction/fluid drag, optics/shadow/reflection/refraction), **F** space-time (persistence, occlusion, motion/lighting/camera continuity, identity anchoring). Each carries facts + visual notes + the specific generation defects it prevents (three hands, rigid-board wings, reversed knees, downward flames, sliding wheels, teleporting objects…).

## 4. Verification layers (vision over the EXISTING gateway lane)

**Design:** deterministic frame extraction (ffmpeg/ffprobe — the tools proven by the JAZMII acceptance evidence) + one bounded vision call (`glm-4.5v` via the existing `createVision` lane, ≤20 s, breaker-aware, non-fatal) against explicit defect checklists:

- **JAZMII** (`verifyVideoContinuity`): final-frame analysis vs the request + reference scene state; reports `{checked, method, defects[], observation}` into `resultJson.continuity`. Frame-level analysis explicitly cannot prove temporal smoothness — the report says so.
- **LAXII** (`verifyGeneratedImage`): full-image defect inspection (anatomy, faces, floating objects, lighting, materials, text artifacts) into `resultJson.verification`.
- **I2V continuity input** (`extractSceneState`): the reference image is vision-analyzed into subject/clothing/pose/environment/light/framing/palette → `SCENE CONTINUITY` directives at the highest conditioning priority.

**Unit evidence:** real ffmpeg frame extraction on a synthetic mp4 (last-frame + mid-position + honest failures for unsupported containers and missing files) — 5/5 pass.

**Live evidence during the acceptance window:** the vision lane was inside the measured account-wide 429 window during every eval attempt, so the continuity check on the REAL committed artifact (`storage/jazmii/…/cmw5tp9cg009sr9vi4magwm9c.mp4`, 1.2 MB, from the 2026-11-07 acceptance run) reported honestly: *"vision check skipped: the chat endpoint class is cooling down after a measured rate limit; no network call was made"*. Per the binding bounded-attempt policy no retry storm was made; a later bounded attempt supersedes this section when recorded in `scripts/world-eval/out/evidence.jsonl`.

## 5. Latency accounting (measured)

Understanding + world assembly + cinematography + conditioning compile: **0.3–1.2 ms** combined on every case (budget: 1–3 s classification + 1–3 s compilation). The only network stage is the single bounded grounding search (≤9 s hard timeout) in mode=facts — inside the brief's 3–10 s search budget. Vision checks run inside async jobs (not on the interactive path).

## 6. Declared limits

1. Curated knowledge components are conservative invariants — they do not simulate fluid dynamics, cloth solvers or collision physics.
2. Vision verification inspects frames, not motion fields; temporal defects (jitter, flicker) are NOT provably detectable — the report's method field makes this auditable.
3. Defects detected are REPORTED (persisted metadata + logs); automatic correction is attempted only where the existing model genuinely supports it (LAXII's edit path, unchanged) — never a silent regeneration loop.
4. Live retrieval/vision evidence is subject to the platform's measured account-wide 429 windows; every blocked attempt is recorded honestly rather than retried into the throttle.
