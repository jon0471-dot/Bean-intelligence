# JAZMII — Video & Media Production

**Status: implemented; live generation depends on the configured video backend (currently reported honestly as not-configured when absent).**

## 1. Purpose and responsibilities

JAZMII is BEAN's video product: text-to-video generation with reference-image
support on the product surface, a conversational planning lane, and the
M-series "director" composition engine for narration-driven productions.

## 2. Actual architecture

- Product view `src/components/bean/jazmii.tsx` (+ `jazmii-director.tsx`).
- API surface `src/app/api/jazmii/`: `generate` (text-to-video submit),
  `jobs`, `chat`/`conversations` (planning lane), `director` (composition).
- Durable worker `src/lib/jobs/video-worker.ts` +
  `src/lib/adapters/hosted-video.ts` / `video-adapter.ts`.
- Director engine: `src/lib/jobs/director-worker.ts` composes narration +
  scene plans (hyperframes/sfx selection in `tests`-pinned pure modules) into
  productions with JAZMII scenes (`JazmiiProduction`/`JazmiiScene`).

## 3. Source-code locations

| Concern | Path |
|---|---|
| Submit/status routes | `src/app/api/jazmii/{generate,jobs}/` |
| Director | `src/app/api/jazmii/director/`, `src/lib/jobs/director-worker.ts` |
| Workers/adapters | `src/lib/jobs/video-worker.ts`, `src/lib/adapters/hosted-video.ts` |
| Delegation tool | `create_video` in `src/lib/riishe/specialists.ts` |
| Persistence | Prisma `JazmiiConversation`/`JazmiiMessage`/`JazmiiProduction`/`JazmiiScene` |

## 4. Model and provider integration

Video generation rides the hosted video backend through the durable queue;
availability is probed and surfaced per-capability (`/api/health`). When the
deployment has no video backend, every lane refuses honestly (the dashboard
shows `not-configured` — measured, not assumed).

## 5. Input/output contracts

Text-to-video: `{ prompt 3–2000 chars, size ∈ {1280x720, 720x1280, 1024x1024} }`
— identical validation in the route and the delegation tool; dedupe keys
prevent identical active jobs. Reference-image flows live on the product
surface only (upload UI lives there). Output: a durable job id; finished clips
appear in the owner's video history.

## 6. Tools and permissions

`create_video` requires `allowVideoCreation` + per-turn capability-plan
agreement; the AUTOBOTS `motion` capability grants the same key. Missions
route `video-asset` tasks through the same submission pipeline.

## 7. Data and memory handling

Productions, scenes and conversations are owner-scoped Prisma rows; job
params/dedupe persist on the GenerationJob; no cross-user sharing.

## 8. Execution workflow

submit → preflight → dedupe → durable row → queue → video worker → adapter →
honest completion/validation → asset + receipt → history.

## 9. Existing tests and verification

`tests/unit/director-*.test.ts` (composition/selection/schema/planner/worker/
hyperframes-sfx/ffmpeg-engine), video delegation in
`riishe-specialist-delegation.test.ts`, `four-product-full-test.ts` scripts.

## 10. Failure handling and fallback behavior

Backend absence is `not-configured`; provider failures classify into honest
receipts; director stages record real per-scene outcomes (no invented
renders).

## 11. Current implemented capabilities

Text-to-video jobs; reference-image product flow; conversational planning;
narration-driven director productions; RIISHE/AUTOBOTS/mission delegation.

## 12. Partial capabilities and known limitations

Full generative video quality depends entirely on the hosted backend; no
timeline editor; no licensed stock-footage integration.

## 13. Planned capabilities (NOT implemented)

Advanced editing/timeline, VFX composition — planned for the NIIKI era
(M51), not present here.
