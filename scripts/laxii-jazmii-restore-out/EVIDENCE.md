LAXII & JAZMII CAPABILITY RESTORATION — MEASURED LIVE EVIDENCE
Run date: 2026-11-14 (UTC). Deployment: bean-intelligence working clone at
feat/laxii-jazmii-restoration base d33e530, Next dev on 127.0.0.1:3100,
fresh SQLite DB (db/custom.db), embedded engine pools (BEAN_ENGINE_EMBEDDED=1),
platform gateway credentials present (/etc/.z-ai-config), ffprobe 7.1.5.
Evidence user: laxii-jazmii-restore-1794628285879@bean-evidence.local
(role admin on this single-user evidence deployment). All jobs below are real
GenerationJob rows executed by the real embedded engine; nothing synthetic.

ENVIRONMENT (measured)
- ffprobe: ffprobe version 7.1.5-0+deb13u1 (Debian); ffmpeg 7.1.5
- python3: 3.12.16; worker.py py_compile: PASS
- GPU: none (no nvidia-smi); RAM 3.9 GB; disk free 5.7 GB (< worker 12 GB min)
- Test baseline at start: bun test tests/ → 1658 pass / 0 fail

LAXII — FOUR REAL RUNS, ALL COMPLETED (job ids verbatim)
1. Text-to-image  job cmwfvclye000hqecz7dwf1q2h  COMPLETED
   prompt "A single crisp red apple on a matte slate surface, soft studio
   lighting, photorealistic" size 1024x1024 → jpeg 1024x1024, 92,743 B,
   durationMs 32,384; generation strategy "native" ("generated at the exact
   requested resolution by the provider"); artifact asset
   cmwfvdcct0017qecz4kpsbm8v (owner-checked /api/laxii/assets/:id, HTTP 200).
2. Conversational edit  job cmwfvcm6b000kqecz70nnpps6  COMPLETED
   mode conversational-edit on fixture-edit.png (768x768 synthetic red-circle
   scene, asset cmwfvclqn0008qeczahhyhpri); prompt "Replace the background
   with a warm sunset beach scene while keeping the red circular subject
   unchanged", size 1024x1024 → png 1024x1024, 1,082,941 B, durationMs 13,698;
   artifact cmwfvcxpf000tqeczsdegtjii (HTTP 200). First real edit in THIS
   deployment; the evidence gate flipped conversational-editing to operational
   ("a real edit completed successfully — the recorded blocker is lifted").
3. Background removal  job cmwfvcm6u000nqeczlgcvspjh  COMPLETED (pre-fix
   pipeline, output at provider stage-1 resolution)
   mode background-removal on fixture-bgrem.png (640x640 synthetic subject,
   asset cmwfvclr4000bqecztw3gbugg) → png 1312x1312, 196,503 B, durationMs
   16,664; measured alpha: transparentFraction 0.8983, opaqueFraction 0.0494,
   hasAlphaChannel true (analysis.json).
   RE-RUN AFTER the source-dimension restoration (job cmwfvf1pz0001qesstyhka1f1
   → asset cmwfvfffy0004qess7ilfooz9): png 640x640 EXACT source dimensions,
   34,066 B, durationMs 17,334; measured alpha: transparentPct 89.82,
   opaquePct 9.31, partialPct 0.87, hasAlpha true (bgrem-result-restored.png).
4. Deterministic enhancement  job cmwfvcmb2000qqeczhoaglbxq  COMPLETED
   full-frame global enhancement + 2x Lanczos upscale on fixture-enhance.png
   (512x512, asset cmwfvclrk000eqecz8sdr6nv0) → png 1024x1024 (2x), 178,467 B,
   durationMs 484 (deterministic local engine — no network model).

JAZMII — THREE REAL VIDEO RUNS + TWO CONTRACT PROBES
1. Text-to-video  job cmwfvfqsw0008qessxsnfkq9c  COMPLETED
   prompt "Slow aerial drone shot flying over misty green mountains at
   sunrise, cinematic" durationSec 5 quality quality → mp4 3,626,952 B;
   ffprobe: h264 1890x1080, 5.194 s, 161 frames, no audio track;
   media route HTTP 200 with owner check (t2v-result.mp4).
2. Image-to-video (through the NEW server-side validation path)
   job cmwfvfqtg000aqess6ej1n4z6  COMPLETED
   reference fixture-i2v.jpg (1024x576 synthetic landscape still, submitted as
   data URL; validated server-side: decodable jpeg, 1024x576 within
   256..4096 px, 12,259 B under the 15 MB cap) + prompt "The camera slowly
   pushes toward the mountain peaks while clouds drift past the sun",
   durationSec 5 → mp4 1,278,155 B; ffprobe: h264 1920x1080, 5.129 s,
   159 frames; media route HTTP 200 (i2v-result.mp4). paramsJson carries the
   additive imageValidation summary {format jpeg, width 1024, height 576,
   bytes 12259}; the provider received the EXACT original reference string.
3. Final t2v regression  job cmwfvylpt000zqessqkq4g0l0  COMPLETED
   (clears the throttle-window evidence from the cancel probe; durationMs
   234,900 including a rate-limit retry_wait window) → mp4 10,785,929 B;
   ffprobe-validated h264 1890x1080 via the new completion artifact JobEvent.
4. Bad-reference rejection probe (defect D3, live)  HTTP 400
   imageUrl "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" →
   {"code":"VALIDATION_ERROR","message":"The reference image is not a
   decodable image (png/jpeg/webp required)."} — rejected BEFORE any job row
   existed (no real submission consumed, no evidence pollution).
5. Durable cancellation probe (defect D4, live)  job cmwfvwlgu000tqessy8sd8r5v
   submit 202 → DELETE 200 {"cancelled":true}; the submission hit the account
   429 window and parked (retry_wait, "submission attempt 2 of 5 starts
   automatically in ~60s"); after the retry window the engine claim protocol
   settled the row from the PERSISTED flag:
   cancelRequested=true, status=cancelled, errorCode=CANCELLED,
   errorMessage="Cancelled before processing started." (verified via direct
   DB read). Stop-tracking semantics unchanged.

DASHBOARD VERIFICATION (GET /api/health, after all runs above)
laxii status: operational
  text-to-image          -> operational   evidence: real-attempt ("the most recent real generation attempt succeeded")
  conversational-editing -> operational   evidence: real-attempt ("a real edit completed successfully — the recorded blocker is lifted")
  background-removal     -> operational   evidence: real-attempt ("a real run completed successfully")
  image-enhancement      -> operational   evidence: probe ("local Sharp preservation engine (executed, not claimed)")
  generative-worker      -> not-configured evidence: registry (honest: no GPU host; see report §5)
jazmii status: operational
  text-to-video          -> operational   evidence: real-attempt
  image-to-video         -> operational   evidence: real-attempt ("a real run completed successfully")
  ffprobe: {available: true, version: "ffprobe version 7.1.5-0+deb13u1 …"} (defect D5 reporting, live)

JOB-EVENT PARITY: three 'artifact' JobEvent rows written for the completed
video jobs (codec/w/h/validatedBy:ffprobe) — the SSE event log is no longer
empty for jazmii.

RAW ARTIFACTS (this directory, NOT committed except harness + state + this file)
- fixture-*.png/jpg (deterministic synthetic inputs), bgrem-result*.png,
  t2v/i2v-result.mp4 (real outputs), analysis.json, state.json (job ids),
  run-live.ts (the harness), mk-fixtures.ts.

HONEST LIMITS
- The hosted gateway throttled one submission window during the session
  (HTTP 429 on the cancel probe's submission); the built-in bounded retry
  handled it; the final t2v completed through a retry_wait window.
- The local Diffusers worker remains not-configured on this host (no GPU,
  5.7 GB disk < 12 GB min, torch stack absent). No inference test has run
  here — the capability stays honestly blocked until the GPU-host acceptance
  run records a verdict (workers/laxii-diffusers/README.md + runbook).
