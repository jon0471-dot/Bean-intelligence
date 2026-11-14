# LAXII & JAZMII Capability Restoration — Phase 0 Architecture Audit

> Produced 2026-11-14 (UTC+8) before any restoration change, per the task's Phase-0 mandate.
> Every claim below was verified against the current code and the live deployment — nothing is
> inferred from older documentation. Repository: `https://github.com/jon0471-dot/Bean-intelligence.git`.

## 0. Repository and branch state (measured, not assumed)

| Item | Measured value |
| --- | --- |
| Authoritative working clone | `/home/z/my-project/bean-intelligence` (full clone of the official repo, own `.git`, remote `origin` → `jon0471-dot/Bean-intelligence`) |
| Current local branch | `feat/agent-reach-integration` at `d33e530` ("feat(research): shared research gateway — Agent Reach adapter + optional Obscura browser backend"), parent `6c280e4` |
| `origin/main` at audit time | `6c280e4` ("feat(giftz): frontend intelligence toolkit") — the frontend-intelligence integration IS the remote main tip |
| Agent Reach commit `d33e530` | Exists ONLY on the local feature branch — NOT merged into main, NOT pushed (remote has a single branch, `main`) |
| Fast-forward relationship | `git merge-base --is-ancestor origin/main HEAD` → true: `origin/main` (6c280e4) is a strict ancestor of `d33e530`, so any commit built on `d33e530` can be pushed to `main` as a verified fast-forward |
| Working tree | Clean on the feature branch (no uncommitted work to preserve inside the clone) |
| Host parallel checkout (NOT authoritative) | `/home/z/my-project` (sandbox workspace) sits on a stale local `main` (`5246b52`) that diverged from `origin/main` at `a82f3f6`; its only extra commit adds embedded-repo gitlinks plus ~229 MB of Obscura reference binaries — content-identical to `6c280e4` otherwise. It hosts the sandbox's port-3000 dev server and its own SQLite DB. It is not the delivery vehicle; the nested clone is. |

Baseline test run on `d33e530` (this environment): **bun test `tests/` → 1658 pass / 0 fail** (119 files, 33,703 expect calls, ~53 s).

## 1. Live capability dashboard at audit time (fresh deployment evidence)

`GET /api/health` on a fresh database (0 `GenerationJob` rows) returned exactly the state the
restoration task describes:

```
laxii  status: degraded   available: true
   text-to-image          -> operational      (statusAffecting: false)
   conversational-editing -> blocked          (statusAffecting: true)
   background-removal     -> blocked          (statusAffecting: true)
   image-enhancement      -> operational      (statusAffecting: false)
   generative-worker      -> not-configured   (statusAffecting: false)
jazmii status: degraded   available: true
   text-to-video          -> operational      (statusAffecting: false)
   image-to-video         -> blocked          (statusAffecting: true)
```

The product badges read `degraded` solely because `conversational-editing`, `background-removal`
and `image-to-video` are status-affecting and non-operational.

## 2. Per-capability root-cause analysis

The architecture-level finding first: **all three "blocked" capabilities are fully implemented,
wired and registry-enabled. Their blocked state is an EVIDENCE-ABSENCE state, not a code
absence** — the capability model (`src/lib/registry/capabilities.ts`) deliberately refuses to
advertise a wired-but-unproven capability until one real run completes in the deployment that is
asking. On top of that honest core, this audit found five real defects that must be fixed for the
dashboard to tell the truth and for image-to-video to be robustly restored.

### 2.1 LAXII text-to-image — OPERATIONAL (no restoration needed)

- Route `POST /api/laxii/generate` → `preflight(user,'laxii','image-generation')` →
  `GenerationJob(product:'laxii', task:'image-generation', status:'queued')` → `enqueueJob` →
  embedded engine pool claim (`src/lib/ai-engine/queue.ts:130-182`, CAS + lease + heartbeat) →
  `processImageJob` (`src/lib/jobs/image-worker.ts`) → `hostedImageAdapter.generateImage`
  → `POST {gateway}/images/generations` (`src/lib/adapters/hosted-image.ts:333-337`).
- Backend `bean-image-hosted-primary` (`src/lib/registry/backends.ts:124-168`, `enabled: true`);
  credentials from the platform-managed gateway config (`src/lib/providers/credentials.ts:41-58`;
  measured this session: `/etc/.z-ai-config` present with baseUrl + apiKey + token).
- Evidence chain: `noteRealAttempt('image-generation', …)` (in-memory, 15-min freshness) +
  persisted completed/failed `GenerationJob` rows (`src/lib/adapters/persisted-attempts.ts`) →
  `generationCapability` (`capabilities.ts:196-334`). A failed attempt can never render
  `operational`; probe-driven `operational` requires an explicit "no generation attempted yet" note.

### 2.2 LAXII conversational image editing — blocked ONLY by evidence absence

- Full path exists and is enabled: `POST /api/laxii/edit` (`mode:'conversational-edit'`) and the
  conversational route (`/api/laxii/chat` intent `edit|image-to-image`) → job
  `task:'image-editing'` → `processEditJob` → `processHostedEditJob`
  (`src/lib/laxii/jobs.ts:588-725`) → `hostedImageAdapter.editImage`
  (`src/lib/adapters/hosted-image.ts:449-456`) with the officially documented body
  `{ prompt, images:[{url: dataURL}], size }`.
- ROOT CAUSE (measured history, quoted from `capabilities.ts:152-164`): the historic HTTP 400
  code-1210 contract blocker was **RESOLVED 2026-11-08** — the url-keyed-object shape completed a
  real edit through the real job path. What keeps the row `blocked` here is that
  `editingCapability` (`capabilities.ts:378-540`) falls through to the contract branch when
  neither in-memory nor persisted attempt evidence exists — and this deployment's DB has zero
  rows. One successful real edit flips the row to `operational` automatically
  (`edit/route.ts:210-211`, `capabilities.ts:446-462`).
- Therefore the restoration action is: (a) prove the pipeline with a real executed edit in this
  environment, (b) keep the evidence-driven gating exactly as-is (do NOT force the row green).

### 2.3 LAXII background removal — blocked ONLY by evidence absence (pipeline is real)

- Two-stage REAL pipeline, fully implemented:
  1. Stage 1 — hosted chroma separation: `processBackgroundRemovalJob`
     (`src/lib/laxii/jobs.ts:744-896`) calls the real `editImage` with the fixed
     `CHROMA_BG_PROMPT` ("Replace the entire background with … exact color #00FF00 …",
     `src/lib/laxii/bg-removal.ts:174-178`).
  2. Stage 2 — deterministic cutout: `measureChromaKey` (edge-band median key + 95th-percentile
     spread, `bg-removal.ts:71-106`) + `chromaCutout` (distance-to-key alpha ramp, feather,
     green-spill despill, `bg-removal.ts:112-169`) producing a TRANSPARENT PNG.
- Measured constraint documented in code (`bg-removal.ts:4-9`): the hosted edit endpoint returns
  opaque JPEG only (no alpha output — measured 2026-11-11: transparent-pixel fraction 0%), so the
  two-stage design is the genuine pipeline, not a workaround for missing code.
- Honest validation exists (`validateCutout`, `bg-removal.ts:185-196`): rejects degenerate
  cutouts with exact strings ("no meaningful background separation measured…", "no subject
  measured…", "the generated background was not uniform enough to key reliably…").
- Root cause of the blocked row: `unverifiedCapability('background-removal', …)` with
  `hasCompletedRun: bgCompletedRun !== null` (`health/route.ts:319,358`) — no completed run on
  record in this deployment. Evidence isolation is deliberate: attempts are recorded ONLY under
  the `image-bg-removal` key so a bg-removal failure can never block conversational editing
  (`src/lib/laxii/jobs.ts:879-883`, `persisted-attempts.ts:193-205,326-342`).
- Restoration action: real executed run with a real image sample + transparent-PNG/alpha
  validation tests. The pipeline itself needs no code change (input/output validation and temp
  hygiene are already implemented; verified in §3).

### 2.4 LAXII deterministic enhancement — OPERATIONAL (no restoration needed)

- `resolveProvider('deterministic-enhance')` → `'local-engine'` → backend
  `bean-image-local-sharp` (`backends.ts:224-256`, enabled, `generative:false`).
- `src/lib/laxii/enhance.ts` = measured-metrics planner (noise sigma, Laplacian variance, channel
  means, saturation) + deterministic Sharp pipeline (denoise / exposure-white-balance /
  grade-saturation / local-contrast / Lanczos upscale) composited through the byte-exact
  preservation engine (`src/lib/laxii/preservation.ts` — masks as byte artifacts, face protection,
  `compositePreserved` with bit-exact original bytes, `validatePreservation` report).
- Health probe EXECUTES a real decode→resize→raw round-trip
  (`src/lib/laxii/local-adapter.ts:44-49`) — "executed, not claimed".
- Verified independent of background removal (separate task kinds, separate routes
  `/api/laxii/enhance`, separate evidence keys). No changes required; regression test only.

### 2.5 LAXII local Diffusers worker — blocked by HARDWARE + registry gate (honest)

The worker implementation is real and complete (`workers/laxii-diffusers/worker.py` v0.3.1,
891 lines, `python3 -m py_compile` verified PASS this session):

| Task-mandated requirement | Worker evidence (file:line) |
| --- | --- |
| Health | `health` method over the JSON-lines stdin/stdout protocol (`worker.py` METHODS map L801-809); Node side `diffusersWorkerAdapter.health()` runs a real `preflight` request (`src/lib/laxii/diffusers-adapter.ts:42-54`) |
| Startup/shutdown lifecycle | spawn → wait `{"type":"ready"}` within 10 s (`src/lib/laxii/worker.ts:130`); idle unload after `LAXII_WORKER_IDLE_UNLOAD_MS` (default 600 s); `unload` method |
| Job execution | `txt2img` (L465), `inpaint` (L503), `reference_generate` IP-Adapter (L545), `identity_prepare/check` YuNet+SFace (L646), `upscale` Real-ESRGAN/Lanczos (L700), `object_removal` big-lama (L736) |
| Progress reporting | per-step progress events surfaced via `onProgress` (`worker.ts:218-224`) |
| Cancellation where safe | cooperative `cancel` checked every diffusion step |
| Timeout/memory limits | request timeout default 120 s → `WORKER_TIMEOUT` (`worker.ts:256-261`); preflight enforces `MIN_VRAM_GB=6.0`, `MIN_DISK_GB=12.0` (`worker.py:105-106`) |
| Structured errors | honest codes: `UNAVAILABLE`, `MODEL_MISSING`, `MODEL_UNSUPPORTED`, `CANCELLED`, `BACKEND_FAILURE`, `UNKNOWN_METHOD`, `INTERNAL_ERROR` |
| Queue integration | `resolveProvider('masked-inpaint'|'object-removal'|…)` → `diffusers-worker` → `processEditJob` → `workerRequest('inpaint'|'object_removal'|…)` with `compositePreserved` byte-exact compositing + identity gate (`src/lib/laxii/jobs.ts:958-1077`) |

Why it is blocked (all measured this session, both gates):
1. Registry code gate: backend `bean-image-selfhosted-diffusers` has `enabled: false`
   (`backends.ts:299`) — enablement requires preflight pass + a recorded real-inference
   acceptance run (`models/manifests/bean-image-selfhosted-diffusers.json` `enableGates`).
2. Preflight fails on this host: missing packages [torch, diffusers, transformers, accelerate,
   safetensors]; CUDA unavailable; disk 5.64-5.7 GB free (< 12 GB minimum); 0/9 checkpoints
   present; host has 2 CPU cores and 3.9 GB RAM.

CPU-fallback viability analysis (task asks for it explicitly): NOT technically viable here.
- SD1.5-family inference needs ~4 GB+ RAM for fp32 UNet activations (3.9 GB total RAM);
  SDXL needs ~10 GB VRAM-equivalent — out of the question.
- Torch CPU wheels alone are ~200 MB-2 GB installed; the 9 declared checkpoints total ~21.8 GB
  (SDXL 6.9 + SD1.5-inpaint 4.3 + SD1.5-base 4.3 + IP-Adapter 2.6 + PuLID 3.5 + others) against
  5.7 GB free disk — the manifest's own `MIN_DISK_GB=12.0` gate exists precisely for this.
- Policy constraints also forbid it: "Do not download large model weights automatically",
  "No mandatory paid API", "Report unavailable models honestly".
- Conclusion: the worker stays `not-configured` on this host with the precise missing-dependency
  report (missing packages, CUDA, disk, checkpoints). The restore-path documentation
  (GPU host → `windows/setup.ps1` → `local/download_models.py --accept-licenses` →
  `local/run_acceptance.py` ACCEPTED → flip registry gate) is already implemented in
  `workers/laxii-diffusers/README.md` and is carried into the restoration report.

### 2.6 JAZMII text-to-video — OPERATIONAL (no restoration needed)

- Backend `bean-video-hosted-primary` (`backends.ts:317-356`, enabled) → `submitVideoJob`
  (`POST {gateway}/video/generation`, `src/lib/adapters/hosted-video.ts:107-142`) → poll
  `GET {gateway}/async-result?id=…` (`hosted-video.ts:145-182`) → download (magic bytes,
  ≤100 MB) → **ffprobe completion gate** (`src/lib/media/ffprobe.ts`: decodable stream, duration
  ≥ 0.5 s, frames ≥ 8; measured facts stored in `resultJson.stream` with `validatedBy:'ffprobe'`)
  → `storage/jazmii/<userId>/<jobId>.mp4` → owner-checked media route with HTTP Range support.
- Async architecture: `GenerationJob` rows + `JobEvent` log + embedded engine pools
  (`src/instrumentation.ts` → `startEmbeddedEngine`, concurrency clamp
  `BEAN_ENGINE_CONCURRENCY_JAZMII ?? 2`) + standalone `bun scripts/ai-workers/worker.ts --all`
  on the same CAS'd claim protocol — no duplicate queue exists or is created.
- Historical degradation modes (account-wide 429 windows; the 2026-11-11 `X-Token` 401 outage)
  are mitigated in code (breaker + bounded `retry_wait` parking; health probe hard-fails `auth`
  when the token is absent). Regression test only.

### 2.7 JAZMII image-to-video — real code path EXISTS; blocked by evidence absence + five real defects

The i2v code path is fully deployed: `params.imageUrl` → `submitVideoJob({image_url})`
(`hosted-video.ts:116`) with BEAN-intel reference scene analysis + prompt conditioning
(`video-worker.ts:287-319`). Persisted completions are classified by scanning recent completed
rows for `"imageUrl"` (`persisted-attempts.ts:343-364`); attempts are recorded under both the
umbrella and the `video-generation-i2v` key (`video-worker.ts:726-729`). A real i2v run completed
2026-11-12 (documented evidence `docs/evidence/bean-optrans-jazmii.txt`: 110.6 s, 5,018,582-byte
MP4, ffprobe h264 1080x1080 5.13 s 159 frames).

Root causes of the current `blocked` row + the defects this restoration fixes:

| # | Defect (all verified in code) | Fix |
| --- | --- | --- |
| D1 | **Evidence-freshness asymmetry**: t2v and i2v feed the UNGUARDED `persistedUpstreamFailure(...)` into their `freshUpstreamFailure` slot (`health/route.ts:380,401`) — the exact pre-hotfix defect the T2I row fixed with `recentPersistedUpstreamFailure(..., { supersededBy })`. A stale-but-upstream failed row can outrank a newer success after restart; also only the single newest failed row is inspected, so a newer CANCELLED/GENERATION_FAILED row masks an older RATE_LIMITED one. | Use the guarded `recentPersistedUpstreamFailure(task, { supersededBy: lastAttempt })` for both video rows. |
| D2 | **i2v `hasCompletedRun` never wired**: `unverifiedCapability` supports the opt-in flag (`capabilities.ts:574-582`) but the i2v call site omits it — after any fresh failure, the row would render `blocked` with the factually false note "attempted live but never completed a real run" despite persisted completions existing. | Pass `hasCompletedRun: (await persistedAttempt('video-generation-i2v')) !== null`. |
| D3 | **No server-side i2v image validation**: the route zod schema checks only the URL/data-URL shape and 8 MB char bound (`generate/route.ts:25-32`, `chat/route.ts:43-50`); no dimension, format (magic-byte), or pixel-count validation — a corrupt or hostile image is only caught by the provider, wasting a real generation attempt and polluting evidence. | New `src/lib/jazmii/reference-image.ts`: bounded fetch/decode via sharp, format from decoded metadata, min/max dimensions + pixel bound, byte cap; wired into BOTH submit routes before job creation; summary persisted additively in `paramsJson`. |
| D4 | **Cancellation seam**: `DELETE /api/jazmii/jobs/[id]` → `requestVideoCancel` only flips an in-process Set (`video-worker.ts:892-905,133`); the durable `GenerationJob.cancelRequested` column (schema L141) that the engine claim protocol honors is never set, so a standalone-worker-owned or post-restart job ignores the cancel. | `requestVideoCancel` persists `cancelRequested: true`; the poll loop re-reads the row flag each iteration and stops tracking when set. Stop-tracking semantics and the verbatim provider-honesty message stay unchanged. |
| D5 | **ffprobe is a silent hard dependency**: a missing `ffprobe` binary turns EVERY video completion into `ARTIFACT_INVALID` (`spawn ffprobe ENOENT`) with no availability reporting anywhere (`ffprobe.ts:14-15` documents the honesty rule but nothing surfaces it). GANGZII audio probes ffmpeg at health time (`hosted-audio.ts:659-690`); video does not. | Report local ffprobe availability in the health payload (real `ffprobe -version` execution, cached), so "worker availability is reported accurately". |

### 2.8 Cross-cutting facts verified

- **Job pipeline (shared, Phase-5 constraint)**: one `GenerationJob` table, one `JobEvent` log,
  one claim protocol (`claimNextJob` CAS: `queued|retry_wait` + due `nextRunAt` → `starting` +
  lease + `attempts+1`; cancel-flagged rows settle as `cancelled` BEFORE claiming), one
  dispatch map (`src/lib/ai-engine/handlers.ts:30-57`), lease watchdog + `recoverStaleJobs`
  crash recovery. Image and video workers are separate modules over the SAME infrastructure —
  the restoration creates NO new queue and NO new tables.
- **Preservation engine** (`src/lib/laxii/preservation.ts`): masks are byte artifacts validated
  at exact geometry; `compositePreserved` keeps `alpha==0` pixels bit-exact; the conversational
  hosted-edit path is explicitly labeled NOT pixel-preserving in its provenance
  (`laxii/jobs.ts:634`) — honest labeling, unchanged.
- **Originals are never overwritten**: assets are stored per-user under
  `storage/laxii/assets/<userId>/<id>.<ext>` with ownership re-checks per request; edit jobs
  prepare a ≤1024 px JPEG copy for the provider (`laxii/jobs.ts:604-609`) and store outputs as
  NEW assets; cancellation settles with "The original image was never modified by this job."
- **Preview before accept**: the product UI renders generated results as preview cards
  (`src/components/bean/laxii.tsx`, `jazmii.tsx` `<video controls preload="metadata">` with
  owner-checked media URL + `<a download>` export); originals and generated versions are stored
  as separate assets.
- **Rate limits / quotas / audit**: `preflight` enforces product burst limits
  (`PRODUCT_RATE_LIMITS.jazmii = 6/min`), daily quotas, provider budgets, shared-account quota,
  admission concurrency (`maxInFlightPerUser: 1 / total: 2` for video), plus the identical-payload
  dedupe guard (409). All preserved untouched.
- **Isolation**: a failed LAXII worker cannot affect JAZMII — separate task handlers, separate
  evidence keys (`image-bg-removal` vs `image-editing`; `video-generation-t2v` vs
  `video-generation-i2v`), separate endpoint-class breakers (`images` vs `video`), separate
  product pools.

## 3. Environment facts measured for this audit

| Fact | Value |
| --- | --- |
| Hosted gateway credentials | PRESENT (`/etc/.z-ai-config`: baseUrl + apiKey + token) — real hosted runs are possible |
| ffprobe / ffmpeg | ffprobe 7.1.5, ffmpeg 7.1.5 (Debian) — the video completion gate is functional |
| Python | 3.12.16 — `python3 -m py_compile workers/laxii-diffusers/worker.py` PASSES |
| GPU | none (no CUDA device) |
| RAM / cores | 3.9 GB total / 2 cores — SD-family CPU inference not viable |
| Disk free | 5.7 GB — below the worker's own 12 GB minimum; model download prohibited by task policy anyway |
| bun / node | bun 1.3.14, node v24.22.2 |
| Test baseline on `d33e530` | 1658 pass / 0 fail |

## 4. Restoration plan derived from this audit

1. **LAXII**: prove conversational editing + background removal + enhancement + text-to-image
   with REAL executed runs in this environment (the code needs no functional change); keep the
   evidence-driven capability gates exactly as they are; keep the Diffusers worker honestly
   `not-configured` with the precise compatibility report.
2. **JAZMII**: fix D1-D5 above (guarded evidence, wired `hasCompletedRun`, server-side reference
   image validation, durable cancellation, ffprobe availability reporting); then prove t2v and
   i2v with real executed runs (i2v through the new validation path).
3. **Dashboard**: after the real runs, verify every touched row renders from real evidence
   (`operational` where a run completed, honest `blocked`/`not-configured` otherwise) — never
   flipped by hand.
4. **Tests**: new unit tests for the five fixes + regression of the four working capabilities;
   full suite, tsc, eslint, production build.
5. **Delivery**: `feat(bean): restore LAXII and JAZMII capabilities` on top of `d33e530`;
   fast-forward push to `main` (verified ancestor relationship); remote SHA verification.
