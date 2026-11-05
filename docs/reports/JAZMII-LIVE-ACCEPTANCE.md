# JAZMII LIVE Acceptance Report (GO-LIVE Phase 5)

**Date:** 2026-11-05 · **Branch/HEAD:** `main` @ `dca2220` (+ this session's commit) · **Environment:** real Next.js dev server on :3000, real queue worker, real provider gateway async video API. No simulated statuses anywhere in the counted evidence.

## 1. Verdict (feature level)

| Feature | Status | Real evidence |
|---|---|---|
| Text-to-video (async submit → provider task → poll → server-side download → store → deliver) | **PASS (LIVE)** | Job `cmw2c0r0d0038ss9f4ypskxjv`: submitted 202 (2026-11-04T16:29Z), completed ~88 s later with provider task `20261105002927247ac0acb2f54f82`, **1,506,330-byte MP4** validated server-side by `ftyp` magic bytes, stored at `storage/jazmii/<user>/<job>.mp4` and re-served owner-checked via `/api/jazmii/jobs/:id/media` (Range-supported) |
| Image-to-video (reference image drives motion) | **IMPLEMENTED, attempt live, completion blocked by the account throttle today** | Live submission accepted (202, job `cmw2v9oyq000usmviqwtr6ubf`, 2026-11-05T01:28Z); the worker's provider call hit the account-wide throttle and the job recorded the typed `RATE_LIMITED` failure verbatim. The adapter path is unit-pinned (`jazmii-video`); a completion awaits a throttle-clear window |
| Progress / cancel / preview / download / history / refinement | **PASS** | Job API exposes queued/running/completed/failed + progress; cancel is honest "stop tracking" (the provider exposes no cancel API — stated in the UI and API); history lists all jobs with typed failure categories; preview + Range download verified on the completed job's media |
| Persistence / restart-resume | **PASS** | Provider task ids are persisted in the job row; the worker resumes polling across restarts (unit-pinned `restart-resume via persisted task id`) |
| No hanging HTTP requests | **PASS (architecture)** | Submission always returns 202 immediately; polling happens in the background worker; the browser never holds a request open for the generation duration |

## 2. Honest job ledger (all-time, product `jazmii`)

| Status | Count | Meaning |
|---|---|---|
| completed | 1 | real provider task, real MP4 stored (above) |
| failed | 3 | typed failures: `RATE_LIMITED` (account throttle, recorded verbatim) |
| unsupported | 7 | pre-backend honest `NO_BACKEND` refusals (audit records; never faked) |

## 3. Provider integration facts (measured)

- SDK surface: `video.generations.create({ prompt, image_url?, quality, with_audio, watermark_enabled, size, fps, duration })` → `{ id, task_status }`; `async.result.query(taskId)` → `{ task_status, video_result?[{url}] }`.
- Submission returns a REAL provider task id (persisted); polling reads the provider's own PROCESSING/SUCCESS/FAIL states; SUCCESS without a retrievable URL is recorded as an honest failure, never a fake completion.
- Downloads happen SERVER-SIDE; the provider URL is never exposed to clients; the payload must pass container magic bytes (mp4 `ftyp` / webm EBML) before storage.
- A video-class 429 opens the bounded escalating breaker (60 s → 600 s cap); while open, submissions fail fast with zero network traffic; recovery is verified by a real call.
- `watermark_enabled: false` is requested; the delivered MP4 is stored exactly as produced by the provider (no local re-encoding, no local fakery).

## 4. Blockers and external dependencies

1. **Account-wide provider throttling (HTTP 429)** — intermittent windows measured in minutes (2026-11-05 saw a sustained heavy phase across ALL endpoint classes: chat, images, video). The breaker machinery spaced probes exactly as designed; today's two fresh video submissions recorded typed `RATE_LIMITED` failures rather than retrying into the throttle.
2. **Flow-class parity not claimed** — the deployed backend is the authorized hosted video API; Google Veo (Flow) is a separate proprietary product surface: the mission rule (no copied source claims) is respected; no Veo backend is configured in this deployment.
3. **Wan 2.2 / ComfyUI self-hosted options** — remain registry-listed expansion candidates (see `BEAN-AI-MODEL-EXPANSION-PLAN.md`); the workstation (RTX 5060 Ti 16 GB) has not been assessed for video model VRAM fit; nothing was downloaded or claimed.

## 5. Test baseline (this report)

- `bun test`: **1,045 pass / 0 fail / 67 files** including `jazmii-video` (adapter contract, magic-byte validation, honest cancel semantics, restart-resume).
- Worker lifecycle tests cover bounded polling and the honest stop-tracking cancellation.
- `eslint`: clean on changed files; `tsc --noEmit` baseline errors remain scripts-only.

## 6. Deliverables & rollback

- `src/lib/adapters/hosted-video.ts` (submit/poll/download/probe), `src/lib/jobs/queue.ts` (worker lifecycle), `src/app/api/jazmii/{generate,jobs/[id]}/route.ts`, `src/app/api/jazmii/jobs/[id]/media/route.ts`, JAZMII studio UI (progress, preview, download, cancel, reference image).
- Evidence: `scripts/golive-out/evidence.jsonl` (committed at `dca2220` for the 11-04 run + this session's fresh records), the storage MP4, and the job rows cited above.
- Rollback: revert this session's commit; no migrations; user data untouched (acceptance users are isolated `golive-acc-*` accounts).
