# LAXII LIVE Acceptance Report (GO-LIVE Phase 4)

**Date:** 2026-11-05 · **Branch/HEAD:** `main` @ `dca2220` (+ this session's adapter-fix commit) · **Environment:** real Next.js dev server on :3000, real Prisma/SQLite, real provider gateway. No mocks counted as evidence; every claim below points at a real job row, artifact file or recorded probe.

## 1. Verdict (feature level)

| Feature | Status | Real evidence |
|---|---|---|
| Text-to-image (submit → queue → worker → artifact → delivery) | **PASS (LIVE)** | 2 completed generations 2026-11-04: `cmw2bk6ld0024ss9fifjvuxhc` (1024×1024, 186,940 B, 34.9 s) and `cmw2bmzbl002css9fl5ru71os` (1024×1024, 131,909 B); artifacts on disk `scripts/golive-out/laxii/t2i-*.jpg` with verified JPEG magic bytes; outputs stored as owned ImageAssets and re-served owner-checked via `/api/laxii/images/:id` (HTTP 200, magic verified by the harness) |
| Same-session continuation + refresh persistence + history | **PASS** | Job/artifact rows persist in the DB; conversation history and assets re-listed after reload (prior live UI run-throughs, `scripts/phase5-ui-out/laxii.png`) |
| Deterministic exact-preservation editing (masks, face zones, enhancement) | **PASS** | Completed jobs with original/diff asset triples (`cmw1zqmh3…`, `cmw1zojm9…`, `cmw1f4s6a…`); unit suites `laxii-preservation`, `laxii-enhance`; live honest-503 refusal while the GPU worker is disabled (acceptance harness step, typed `PROVIDER_UNAVAILABLE`, nothing queued) |
| Hosted conversational editing (background / object / lighting / restyle / variations) | **IMPLEMENTED, BLOCKED by an undocumented provider contract** | The endpoint is real and attempted; the provider rejects every request shape known to this tenant (measured 10-shape probe, §3); the typed 400 is recorded verbatim on the job (`cmw2bnsrb002mss9frrxua4eb`). Nothing faked, nothing retried into |
| Capability honesty | **PASS** | `GET /api/laxii/edit` returns per-mode truth incl. the measured conversational-edit blocker; masked modes report `diffusers-worker` availability honestly |

## 2. What runs live, end to end

1. **Submission** `POST /api/laxii/generate` → 202 + persisted `GenerationJob` (owner-checked).
2. **Worker** invokes the authorized hosted image backend (real provider call, images-class breaker guarded).
3. **Validation** — the adapter accepts only a JPEG-magic-byte payload; a wrong payload can never masquerade as an image (unit-pinned).
4. **Storage** — bytes land in per-user storage; an owned `ImageAsset` row is created; the media route re-serves under per-user authorization.
5. **Job API** — `GET /api/laxii/jobs/:id` reflects queued/running/completed/failed with typed `errorCode` and the provider message verbatim on failure.

## 3. The conversational-edit contract blocker (measured, explicit)

The gateway exposes `POST {baseUrl}/images/generations/edit` (SDK: `zai.images.generations.edit`). The SDK typings declare `image?: string`, but the server answers `1210: image_to_image task must provide images` for the typings' own shape. Ten request shapes were measured across two sessions (`scripts/probe-image-edit-out/contract-probe*.json`):

| # | Shape tried | Result |
|---|---|---|
| 1 | `image: <raw b64>` (typings) | 1210 "must provide images" |
| 2 | `images: [<b64>]` | 1210 "must provide images" |
| 3 | `images: [<data URL>]` | 1210 "must provide images" |
| 4 | `images: [<public https URL>]` | 1210 "must provide images" |
| 5 | `images: "<public https URL>"` (string) | 1210 generic (passes the named check!) |
| 6 | `image: "<public https URL>"` | 1210 "must provide images" |
| 7 | `images: "<raw b64>"` (string) | 1210 generic |
| 8 | `images: "<data URL>"` (string) | 1210 generic |
| 9 | `images: <gateway-issued CDN URL>` (string, captured from a raw T2I response) | 1210 generic |
| 10 | prior-session variants (data-URL arrays, multi-image arrays) | 1210 "must provide images" |

Measurement conclusion: the field name is `images` (a singular `image` is rejected by name), the validator wants a **string** (arrays fail the named check), but the expected string format is not derivable tenant-side — public Z.AI documentation describes **no edit endpoint at all**, and even the provider's own freshly-issued CDN URL is rejected. Metadata doc routes (`/openapi.json`, `/docs`, `/api-docs`) do not exist on this gateway.

**Shipped handling:** the adapter (`src/lib/adapters/hosted-image.ts`) now sends the measured-deepest shape (`images: <data URL>`, self-describing, consistent with this gateway's vision-chat image convention) with the full evidence table in-code; per-attempt failures surface as typed `BACKEND_FAILURE` jobs with the provider error verbatim; the capability endpoint discloses the measured blocker with its date; the images-class 429 breaker still guards the endpoint (fail-fast, bounded escalation).

**Unblock path (operator):** obtain the documented request contract for `/images/generations/edit` from the provider (or an administrator-visible API doc); the adapter then changes one field. No product or data-model change is required.

## 4. Blockers and external dependencies

1. **Account-wide provider throttling (HTTP 429)** — intermittent windows measured in minutes; the bounded escalating breaker (60 s → 600 s cap) spaces real probes; a fresh 429 during acceptance opens the breaker and is reported, never retried into. Today's fresh T2I attempt recorded a typed `BACKEND_FAILURE` this way (`cmw2vm9la001gsmvibk8ygx6s`).
2. **Generative masked editing (InstantID/IP-Adapter class)** — requires a GPU host + licensed checkpoints; honestly refused with typed 503 `PROVIDER_UNAVAILABLE` until deployed (unchanged policy).
3. **Edit contract documentation** — §3.

## 5. Test baseline (this report)

- `bun test`: **1,045 pass / 0 fail / 67 files** (the hosted-edit suite re-pins the measured `images` data-URL contract; a date-fragile sidebar fixture was made calendar-safe).
- `tsc --noEmit`: pre-existing scripts-only baseline (11 → now 12 incl. the new probe script's typing; none in `src/`).
- `eslint`: clean on all changed files.

## 6. Deliverables & rollback

- Adapter contract fix + probe scripts: `src/lib/adapters/hosted-image.ts`, `scripts/probe-image-edit-{images-field,contract-2,3,4,5}.ts` (raw results in `scripts/probe-image-edit-out/`).
- Live evidence: `scripts/golive-out/` (artifacts + `evidence.jsonl`, committed at `dca2220` for the 11-04 run), job rows cited above in `db/custom.db`.
- Rollback: revert this session's commit; the LAXII data model is unchanged, no migrations were added; user data untouched (acceptance runs use isolated `golive-acc-*` accounts).
