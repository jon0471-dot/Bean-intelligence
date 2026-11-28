# LAXII — Image & Visual Intelligence

**Status: implemented; live generation depends on the configured image backend.**

## 1. Purpose and responsibilities

LAXII is BEAN's image product: text-to-image generation, image analysis
conversations, image enhancement and edit history — all through durable jobs
with honest availability reporting.

## 2. Actual architecture

- Product view `src/components/bean/laxii.tsx` (+ `src/components/bean/laxii/`).
- API surface `src/app/api/laxii/`: `generate` (submit), `jobs` (status),
  `images`/`assets` (owner-scoped results), `edit` (hosted edit history),
  `enhance`, `preflight`, `models`, `local-models`, `chat`/`conversations`
  (vision-grounded conversation), `history`.
- Durable worker `src/lib/jobs/image-worker.ts` executes queued jobs through
  the hosted image adapter `src/lib/adapters/hosted-image.ts`.
- Throttle parking (`tests/unit/image-throttle-parking.test.ts`) handles
  provider rate limits without losing jobs.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Submit/status routes | `src/app/api/laxii/{generate,jobs,images,assets}/` |
| Worker | `src/lib/jobs/image-worker.ts` |
| Adapter | `src/lib/adapters/hosted-image.ts` |
| Registry | `src/lib/registry/products.ts` (`LAXII_SIZES`), `src/lib/registry/status.ts` |
| Delegation tool | `generate_image` in `src/lib/riishe/specialists.ts` |
| Trust adapter | `src/lib/trust/adapters/media.ts` |

## 4. Model and provider integration

Generation goes through the configured hosted image backend (provider
identity is never exposed to the client); availability probes feed
`/api/health` per-capability rows. No local GPU path is claimed; if no
backend is configured the product reports `not-configured` honestly.

## 5. Input/output contracts

Generate: `{ prompt 3–4000 chars, size from LAXII_SIZES or width/height
256–2048 }` (same validation in the route and the delegation tool);
dedupe key prevents identical active duplicates. Output: a durable job id —
never an instant image claim; finished assets land in owner-scoped history.

## 6. Tools and permissions

`generate_image` delegation requires `allowImageGeneration` (route
permission) AND the per-turn capability plan (an actual image request). The
BEAN AUTOBOTS `visual` capability grants the same key to agent turns.

## 7. Data and memory handling

Image assets and edit history are owner-scoped Prisma rows
(`ImageAsset`, `LaxiiEditHistory`); prompts/dedupe params persist with the
job; conversations (`LaxiiConversation`) are separate from RIISHE.

## 8. Execution workflow

submit → preflight (availability, rate limit, quota, budget) → dedupe check →
GenerationJob row → queue → worker → adapter call → validation of the real
result → asset row + Trust receipt → product history.

## 9. Existing tests and verification

`tests/unit/laxii-*.test.ts` (hosted edit, image failure receipts, throttle
parking), delegation tests in `riishe-specialist-delegation.test.ts`, plus
availability scenarios in `availability-scenarios.test.ts`.

## 10. Failure handling and fallback behavior

Provider 429s park the job honestly; hard failures classify
(`IMAGE_PROVIDER_RESPONSE_ERROR` …) into truthful receipts; the UI never
shows a finished image that does not exist.

## 11. Current implemented capabilities

Text-to-image with preset/custom sizes; vision chat on uploaded images;
enhancement; edit history; RIISHE/AUTOBOTS delegation with real queued jobs.

## 12. Partial capabilities and known limitations

Live generation requires the hosted backend credential to be configured;
without it every path refuses honestly. No vector/logo production, no
inpainting-style local editing beyond the hosted edit lane.

## 13. Planned capabilities (NOT implemented)

 richer local control (masks, layers), video-frame visual intelligence —
roadmap only.
