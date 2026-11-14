# LAXII & JAZMII Capability Restoration — Delivery Report

> Completed 2026-11-14 (UTC+8). Companion to `docs/LAXII-JAZMII-RESTORATION-AUDIT.md`
> (Phase 0) and `scripts/laxii-jazmii-restore-out/EVIDENCE.md` (raw measured evidence).
> Every claim below was EXECUTED and VERIFIED against the real deployment — nothing is
> claimed as working without a recorded run.

## 1. What was restored (final measured state)

`GET /api/health` after the live runs, on a deployment that started with every
capability blocked/degraded:

```
laxii status: operational
  text-to-image          -> operational   (real-attempt: real 1024x1024 generation completed)
  conversational-editing -> operational   (real-attempt: "a real edit completed successfully")
  background-removal     -> operational   (real-attempt: real transparent-PNG run completed)
  image-enhancement      -> operational   (probe: local Sharp engine executed)
  generative-worker      -> not-configured (honest — no GPU host; §5)
jazmii status: operational
  text-to-video          -> operational   (real-attempt: ffprobe-validated MP4)
  image-to-video         -> operational   (real-attempt: ffprobe-validated MP4 from a validated reference)
  ffprobe: { available: true, version: "ffprobe version 7.1.5-0+deb13u1 …" }
```

RIISHE and CODE GIFTZ were not touched: no route, component, handler, prompt,
sandbox, or model-routing file belonging to them appears in the change set.

## 2. Exact root causes (measured, quoted)

**None of the three "blocked" capabilities was missing code.** All were
implemented, wired and registry-enabled; their dashboard rows derive from a
capability model that (correctly) refuses to advertise a wired-but-unproven
capability. The blocked states were:

1. **LAXII conversational editing** — `editingCapability` falls through to the
   recorded contract blocker when neither in-memory nor persisted attempt
   evidence exists. The historic HTTP 400 code-1210 provider-contract blocker
   was RESOLVED upstream on 2026-11-08 (the officially documented
   `images:[{url}]` body shape completed a real edit); what kept the row
   blocked in a fresh deployment was evidence absence only.
2. **LAXII background removal** — `unverifiedCapability('background-removal')`
   with `hasCompletedRun: false` ("wired but unverified: no completed real run
   on record"). The two-stage pipeline (hosted chroma separation → deterministic
   cutout with true alpha) was fully implemented.
3. **JAZMII image-to-video** — same evidence-absence state, compounded by five
   real defects (below). The hosted i2v path (`image_url` on
   `POST /video/generation`) was fully deployed.
4. **LAXII local Diffusers worker** — genuinely blocked by hardware: the host
   has no GPU, 3.9 GB RAM, 5.7 GB free disk (below the worker's own 12 GB
   minimum), and no torch stack; the backend is additionally `enabled: false`
   in the registry until a GPU-host preflight AND a recorded real-inference
   acceptance run pass (both by design).

**Defects fixed in this restoration** (each was verified in code and, where
applicable, live):

| ID | Defect | Fix |
| --- | --- | --- |
| D1 | t2v and i2v capability rows fed the UNGUARDED `persistedUpstreamFailure` into `freshUpstreamFailure` — a stale-but-upstream failed row outranked a newer success after restart (the exact pre-hotfix T2I defect), and a newer CANCELLED/GENERATION_FAILED row masked an older RATE_LIMITED one. | Both video rows now use `recentPersistedUpstreamFailure(task, { supersededBy: lastAttempt })` — freshness window + supersession, restart-proof intent preserved. |
| D2 | `unverifiedCapability` supports `hasCompletedRun` but the i2v call site never passed it — after any fresh failure the row rendered the factually false "attempted live but never completed a real run" despite persisted completions. | `hasCompletedRun: (await persistedAttempt('video-generation-i2v')) !== null` wired into the health route. |
| D3 | No server-side i2v image validation: only the URL shape + an 8 MB char bound; corrupt/hostile payloads were discovered by the provider AFTER a real submission, wasting quota and polluting the evidence chain. | New `src/lib/jazmii/reference-image.ts`: SSRF-guarded bounded fetch (shared research-gateway guard), sharp decode with format from DECODED metadata, 256..4096 px per side, ≤ 16 MP, ≤ 15 MB, animated-image rejection, precise reasons; wired into BOTH `/api/jazmii/generate` and `/api/jazmii/chat` before preflight/job creation; additive `imageValidation` summary persisted in `paramsJson`; the original reference string is passed through verbatim. |
| D4 | `DELETE /api/jazmii/jobs/[id]` flipped only an in-process Set — a standalone worker or restarted process never saw the cancel, and the durable `GenerationJob.cancelRequested` column (which the engine claim protocol already honors) was never written. | `requestVideoCancel` persists `cancelRequested: true` first; the poll loop re-reads the row flag (`durableCancelRequested`) at entry, after `waitForDue`, and at both poll-loop boundaries. Stop-tracking semantics and the verbatim provider-honesty message unchanged. Live-verified: a throttle-parked job settled `cancelled` / `CANCELLED` / "Cancelled before processing started." from the persisted flag. |
| D5 | ffprobe is a HARD completion gate for every video job, but nothing reported its availability — with the binary missing every download silently terminated `ARTIFACT_INVALID` (spawn ENOENT). | New `src/lib/media/ffprobe-health.ts` (real `ffprobe -version` execution, 20 s cache, honest bounded detail); surfaced as `jazmii.ffprobe` on the health payload. |
| D6 (bonus) | Background removal delivered the provider's stage-1 resolution (measured 1312x1312) instead of the submitted dimensions, violating "preserve source dimensions where supported". | After the cutout, the transparent PNG is restored to the EXACT source dimensions when the geometry is recoverable (aspect match ≤ 2%, non-enlarging); otherwise keyed dimensions stand and the mismatch is recorded in provenance (`sourceDimensionsRestored`, `sourceWidth/Height`, `cutoutWidth/Height`). Live-verified: 640x640 source → 640x640 transparent PNG. |
| D7 (bonus) | Video jobs wrote NO JobEvents (row-only persistence) — the SSE event log stayed empty for jazmii. | A completion `artifact` JobEvent (codec/w/h/duration/`validatedBy:ffprobe`) is appended; verified live (3 rows). |

## 3. Files changed

**Source (8):**
- `src/app/api/health/route.ts` — D1 + D2 wiring, ffprobe availability on the JAZMII entry, import updates.
- `src/lib/jobs/video-worker.ts` — D4 (durable cancel write + `durableCancelRequested` reads), D7 (artifact JobEvent).
- `src/app/api/jazmii/generate/route.ts` — D3 (validation before preflight, additive `imageValidation` in paramsJson).
- `src/app/api/jazmii/chat/route.ts` — D3 (identical semantics on the conversational submit path).
- `src/lib/laxii/jobs.ts` — D6 (source-dimension restoration in `processBackgroundRemovalJob`).
- `src/lib/jazmii/reference-image.ts` — NEW (D3 validation module).
- `src/lib/media/ffprobe-health.ts` — NEW (D5 availability probe).
- `.gitignore` — additive rules keeping the live-run session cookie, generated media and `__pycache__/` out of git.

**Tests (5):**
- `tests/unit/jazmii-reference-image.test.ts` — NEW: 12 tests pinning D3 (real decodable images validate with measured facts; corrupt/non-image payloads, dimension bounds, animated webp, literal-private/metadata https references all rejected with precise reasons).
- `tests/unit/ffprobe-health.test.ts` — NEW: 4 tests pinning D5 (real execution + version banner, caching, forced re-measure; plus the honest-failure contract of the completion gate itself).
- `tests/unit/jazmii-evidence-wiring.test.ts` — NEW: 12 tests pinning D1+D2+D4 (persisted i2v/t2v completion classification, freshness window, supersession both directions, CANCELLED-as-non-evidence; source-contract assertions for the guarded feed, the wired `hasCompletedRun`, the durable cancel write and the poll-loop re-reads).
- `tests/unit/jazmii-chat.test.ts` — updated: the i2v params-verbatim test now uses a REAL 256x256 PNG (the old fixture was a non-decodable fake — correctly rejected since D3) and asserts the additive validation summary; new test pins 400-before-any-job for garbage references.
- `tests/unit/laxii-bg-removal.test.ts` — extended with a wiring pin for D6 (restoration contract, non-enlarging guard, honest provenance).

**Documentation & evidence (4):**
- `docs/LAXII-JAZMII-RESTORATION-AUDIT.md` — NEW (Phase 0 audit, produced before any change).
- `docs/LAXII-JAZMII-RESTORATION-REPORT.md` — this report.
- `scripts/laxii-jazmii-restore-out/EVIDENCE.md` — NEW (verbatim measured evidence: job ids, bytes, ffprobe facts, alpha fractions, dashboard states).
- `scripts/laxii-jazmii-restore-out/run-live.ts`, `mk-fixtures.ts`, `state.json`, `analysis.json` — the reproducible harness and its state (media/cookie files gitignored).

## 4. Actual inference evidence (summary — full detail in EVIDENCE.md)

| Run | Result | Key measured facts |
| --- | --- | --- |
| LAXII t2i `cmwfvclye000hqecz7dwf1q2h` | COMPLETED | jpeg 1024x1024, 92,743 B, 32.4 s, strategy native |
| LAXII conversational-edit `cmwfvcm6b000kqecz70nnpps6` | COMPLETED | png 1024x1024, 1,082,941 B, 13.7 s (real hosted edit of a synthetic subject scene) |
| LAXII bg-removal (post-D6) `cmwfvf1pz0001qesstyhka1f1` | COMPLETED | png **640x640 (exact source dims)**, transparent alpha: 89.82% transparent / 9.31% opaque / 0.87% feather, `hasAlpha: true`, 17.3 s |
| LAXII enhancement `cmwfvcmb2000qqeczhoaglbxq` | COMPLETED | png 1024x1024 (2x Lanczos of the 512x512 source), 484 ms, deterministic local engine |
| JAZMII t2v `cmwfvfqsw0008qessxsnfkq9c` | COMPLETED | mp4 3,626,952 B — ffprobe: h264 1890x1080, 5.194 s, 161 frames |
| JAZMII i2v `cmwfvfqtg000aqess6ej1n4z6` | COMPLETED | mp4 1,278,155 B — ffprobe: h264 1920x1080, 5.129 s, 159 frames; from a validated 1024x576 reference; additive `imageValidation` in paramsJson |
| JAZMII t2v regression `cmwfvylpt000zqessqkq4g0l0` | COMPLETED | mp4 10,785,929 B through a bounded 429 retry_wait window |
| D3 probe (live) | REJECTED | HTTP 400 "The reference image is not a decodable image (png/jpeg/webp required)." before any job row |
| D4 probe (live) | SETTLED | cancelRequested=true persisted; after the throttle retry window the row settled `cancelled`/`CANCELLED`/"Cancelled before processing started." |

## 5. Hardware compatibility & remaining blocked capability

**Local Diffusers worker (`workers/laxii-diffusers/`)** — SHIPPED AS CODE, NOT
DEPLOYED here, by design and by policy:
- `python3 -m py_compile workers/laxii-diffusers/worker.py` → PASS (v0.3.1;
  stdin/stdout JSON-lines protocol; methods: preflight / txt2img / inpaint /
  reference_generate / identity_prepare / identity_check / upscale /
  object_removal / health / unload / cancel; cooperative cancellation per
  diffusion step; 120 s request timeout; idle unload; honest error codes).
- This host: **no GPU** (no CUDA device), 2 cores, 3.9 GB RAM, 5.7 GB free
  disk — below the worker's own `MIN_DISK_GB=12.0` and `MIN_VRAM_GB=6.0`
  preflight gates; the torch stack (torch/diffusers/transformers/accelerate/
  safetensors) is absent by policy (no large model dependencies in the dev
  sandbox). CPU inference of SD1.5/SDXL on this host is NOT technically viable.
- CPU-fallback policy: the worker keeps honest `UNAVAILABLE`/`MODEL_MISSING`
  reporting; no CPU mode is fabricated where it cannot pass the acceptance
  gate. The capability stays `not-configured` until a real inference test
  succeeds on the GPU host — never flipped green by configuration.

**Model manifest (declared, not downloaded here)** —
`models/manifests/bean-image-selfhosted-diffusers.json` (status
`not-deployed`), all licenses recorded at download time by
`workers/laxii-diffusers/local/download_models.py --accept-licenses`:

| Model | License | Size | VRAM |
| --- | --- | --- | --- |
| SD1.5-inpaint / SD1.5-base | CreativeML OpenRAIL-M | 4.3 GB each | 4 GB |
| SDXL-base-1.0 (diffusers layout, fp16) | CreativeML Open RAIL++-M | 6.9 GB | 10 GB |
| IP-Adapter h94 SD1.5 (+ CLIP ViT-H) | Apache-2.0 | 2.6 GB | 2 GB |
| PuLID-SDXL (+ EVA-CLIP) | Apache-2.0 code / OpenRAIL++-M weights | 3.5 GB | 4 GB |
| Real-ESRGAN x4plus | BSD-3-Clause | 0.07 GB | 1 GB |
| big-lama (TorchScript) | Apache-2.0 | 0.2 GB | — |
| YuNet face detection / SFace recognition | MIT (SFace provisional) | 0.05 GB | 0 |

Rejected upstream for license reasons: InstantID, IP-Adapter-FaceID,
FLUX.1-dev, PuLID-FLUX, ComfyUI-as-runtime. The hosted capabilities use the
authorized provider gateway (checkpoints not disclosed to the tenant —
recorded verbatim in `src/lib/registry/backends.ts`).

## 6. Tests and build results (final commit contents)

- **Unit/integration suite**: `bun test --isolate tests/` → **1689 pass / 0 fail** (122 files, 33,784 expect calls) — up from the 1658/0 baseline on `d33e530` (31 new tests, 1 updated fixture, 0 regressions).
- **TypeScript**: `tsc --noEmit` → **0 errors in src/ and tests/** (194 pre-existing errors in `scripts/` evidence tooling are byte-identical to the pristine `d33e530` baseline and outside the build graph).
- **ESLint**: `eslint .` → **0 errors** (2 pre-existing warnings in `src/components/giftz-kit/*`, untouched files from the frontend-intelligence commit).
- **Production build**: `bun run build` → **Compiled successfully** (50/50 static pages).

## 7. Exact setup / operations instructions

**Hosted capabilities (all restored features) — nothing to install:**
1. `bun install && bunx prisma generate && bunx prisma db push` with `DATABASE_URL` pointing at a SQLite file.
2. The gateway client is platform-managed (`/etc/.z-ai-config`, or `.z-ai-config` in the working directory; requires `baseUrl` + `apiKey`, `token` required by the video endpoints).
3. `ffprobe` must exist on `PATH` for video completion (Debian: `apt install ffmpeg`); its availability is now reported at `GET /api/health` → `products.jazmii.ffprobe`.
4. Start the server (`next dev` or the standalone build); the embedded engine pools run automatically (`BEAN_ENGINE_EMBEDDED=1` default). Video worker availability is the engine pool status in the same health payload.
5. Each capability proves itself on first real use: the dashboard rows read
   measured evidence (probe + real attempts + persisted completions) and will
   show `blocked` until a first successful run completes in a fresh deployment
   — by design; one successful edit / bg-removal / i2v run flips its row.

**Local Diffusers worker (optional GPU host, Windows):**
```powershell
powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\hardware_report.ps1
powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\setup.ps1   # torch 2.11.0+cu128 stack
& workers\laxii-diffusers\.venv\Scripts\Activate.ps1
cd workers\laxii-diffusers
python local\download_models.py --accept-licenses     # 9 checkpoints, SHA-256 verified, ~21.8 GB
python local\run_acceptance.py                        # real inference verdict
```
Record the ACCEPTED verdict in `worklog.md`, then flip
`DIFFUSERS_WORKER.enabled = true` in `src/lib/registry/backends.ts`. Until
then the dashboard honestly reports `not-configured`. Full runbook with
troubleshooting: `workers/laxii-diffusers/local/ACCEPTANCE-RUNBOOK.md`.

**Environment variable names** (all optional, no secrets in docs): `LAXII_PROVIDER`,
`LAXII_WORKER_PYTHON`, `LAXII_WORKER_MODELS_DIR`, `JAZMII_VIDEO_POLL_INTERVAL_MS`,
`JAZMII_VIDEO_MAX_POLL_MS`, `JAZMII_VIDEO_DOWNLOAD_RETRY_MS`,
`BEAN_ENGINE_CONCURRENCY_JAZMII` — see `.env.example`.

## 8. Delivery

One commit, `feat(bean): restore LAXII and JAZMII capabilities`, on top of the
Agent Reach integration (`d33e530`, feature branch) — a verified fast-forward
of `origin/main` (`6c280e4`); no force push, no history rewrite, no secrets
(session cookie, media, DB files gitignored), remote SHA verified with
`git ls-remote`. Exact SHAs and the push result are recorded in the final
delivery section of the session summary and `docs/HANDOFF.md`.
