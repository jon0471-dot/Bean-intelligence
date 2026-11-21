# M27 RESULTS — GANGZII Audio Production Engine + JAZMII Integration

**Date:** 2026-11-21 · **Branch:** `feat/gangzii-audio-production` (base `e983c41` = main, which already contains the six JAZMII Auto Director commits) · **Publication freeze respected: everything stays local.**

---

## 1. GANGZII backend status — **Verified end-to-end**

The pre-M27 state (measured, not assumed): GANGZII had routes + UI but **no execution handler** — every TTS/transcription/conversion job settled `NO_BACKEND` (queue.ts F-G1), and the GANGZII UI component was ORPHANED (not in ViewId, navigation or the view switch — `#gangzii` rendered a blank pane).

M27 changed exactly that:

- `src/lib/jobs/audio-worker.ts` — REAL execution handlers for `speech-synthesis`, `audio-transcription`, `audio-conversion`, `audio-production` (voice-driven engine selection, real progress, cooperative cancellation, partial-output preservation, ffprobe self-validation, Trust receipts, honest usage metering).
- Engine wiring: handlers registered (`ai-engine/handlers.ts`), a GANGZII worker pool started (`runner.ts`, embedded + standalone), concurrency config, kickProduct chain, rate limit + daily quota entries (previously the missing daily-quota entry would have made gangzii quota 0 — found and fixed).
- Registry: five gangzii backends (`bean-audio-tts-local-kokoro`, `bean-audio-tts-hosted-primary`, `bean-audio-tools-local-ffmpeg`, `bean-audio-convert-local-ffmpeg`, `bean-audio-asr-hosted-primary`) with truthful limits, licenses and health probes; gangzii added to the public product catalog (BEAN_PRODUCTS, sidebar navigation, dashboard, health payload, landing copy corrected 4→5 flagship).
- UI: GANGZII mounted in `page.tsx` + `shell.tsx`; two new tabs (Narration, Soundtrack) join the four existing ones.
- Health: `/api/health` now carries a measured gangzii entry (local ONNX engine check + hosted gateway probe + ffmpeg probe + queue depth + capability array).

## 2. TTS model selected — **Kokoro-82M v1.0** (q8)

- Repo: `onnx-community/Kokoro-82M-v1.0-ONNX` (mirror of the Apache-2.0 hexgrad/Kokoro-82M), dtype **q8** (92.4 MB), loader `kokoro-js@1.2.1` + `@huggingface/transformers` (onnxruntime-node, CPU).
- Runtime config: offline inference enforced (`allowRemoteModels=false` + local model path) — the server never silently fetches weights.
- Evaluation vs Qwen3-TTS: `docs/models/GANGZII-TTS-ENGINE-EVALUATION.md` (Apache-2.0 weights; CPU-capable; measured RTF on this host).

## 3. Licenses — **Implemented (recorded in the registry + manifest)**

- Weights: Apache-2.0 (hexgrad/Kokoro-82M v1.0 model card).
- Code: Apache-2.0 (kokoro-js).
- Dependency: phonemizer/espeak-ng WASM (GPL-3.0) — unmodified server-side dependency, recorded in the backend descriptor with the commercial-use note.
- Hosted gateway synthesis/ASR: platform inference agreement (unchanged, measured since 2026-10-27).

## 4. Supported languages and voices actually tested

- **Tested end-to-end (real synthesis + ffprobe + ASR round-trip on earlier probes):** English (American + British) through the local engine; the hosted gateway's Chinese/English verified set (unchanged).
- **Advertised as UNTESTED (never claimed):** the 26 non-English Kokoro voices (es/ja/zh/hi/it/pt/fr) — visible in the UI combobox labeled "unverified"; the model card grades are shown verbatim for the 28 English voices.
- Voice cloning: **not implemented, not accepted** (upload path rejects voice cloning use; the audioTools capability states it requires its own consent + rights design).

## 5. Real generated audio evidence

- `scripts/m27-kokoro-smoke.ts` — real WAV: pcm_s16le / 24000 Hz / mono / **8.225 s**, ffprobe-validated.
- `tests/integration/gangzii-audio-worker.e2e.test.ts` — TWO real E2E tests through the actual worker + queue + Trust Engine: (1) a speech-synthesis job → completed with real artifact + receipt + usage row; (2) a 2-segment narration → measured timings → real ffmpeg join → master duration ≈ segment sum (±1 s), EBUR128 loudness measured.
- UI-driven run: a narration created in the UI, generated (measured 6.68 s), joined; artifacts deleted only as test cleanup (evidence = assertion output + logs).

## 6. Measured generation speed and RAM

- Model load: **824–885 ms**; inference **RTF ≈ 1.30** (10.7 s wall for 8.2 s audio) on 2 vCPU / 3.9 GB RAM.
- RSS ≈ **642 MB** during loaded inference (heap delta ≈ 121 MB).
- No GPU in this environment; the owner's RTX 5060 Ti is NOT assumed for production (CPU is the verified baseline).

## 7. Audio editing and mixing capabilities — **Implemented, verified**

- Operations (deterministic local ffmpeg, bounded and validated): trim, fade-in/out, volume, static ducking, basic EQ (bass/treble shelves), compression, limiting, one-pass loudness normalization, concatenation (multi-input, real `concat` filter graph), master export (WAV / MP3 / M4A; sample-rate + channel conversion; stereo = explicit dual-mono).
- Every result: ffprobe stream facts + **EBUR128 integrated LUFS + true peak** recorded in resultJson + receipt.
- Master labeling honesty: `masterLabel` states `measured-master` ONLY when a mastering operation actually ran; a plain transcode is labeled `processed-audio (…NOT labeled mastered)`.

## 8. Format and export-validation results

- WAV master / MP3 delivery / M4A (AAC) verified through the real conversion + production paths; ffprobe validation is the completion gate (a produced file that cannot be decoded is delivered only with an explicit limitation, and the receipt settles `completed_with_limitations`).
- SRT/VTT export: measured segment-level timings; unmeasured segments are SKIPPED and counted — never estimated.

## 9. JAZMII integration — **Verified end-to-end (through the UI)**

- Storyboard → narration hand-off: the Auto Director awaiting-approval audio block gains "Draft narration from captions" (explicit user action — captions become the draft; the pipeline still never auto-narrates) + a narration picker with per-project readiness.
- Attach flow: `/api/jazmii/director/[id]/narration` copies the COMPLETED joined master into the production workspace as `voiceover.wav`, writes `tracks.json` (role voiceover + GANGZII attribution) and `narration-timing.json` (MEASURED segment-level timings, approximate — flagged for review when scene durations change).
- Verified live: production planned via the real planner → narration drafted from captions → generated in GANGZII (measured 11.73 s) → joined → attached ("GANGZII narration attached as voiceover") — files verified on disk.
- Music bed + volume/attribution: pre-existing upload path unchanged; SFX: `audioTrackSchema.role` extended with `'sfx'` + `startSec` (FIFO cap 4), audio route accepts them.

## 10. Synchronization evidence

- FFmpeg engine: music (static duck ×0.55 under voiceover) + voiceover + **scene-timed SFX** (`adelay` at exact positions) mixed in ONE amix graph; notes state the effect count and ducking. Real-render tests produce MP4s whose ffprobe audio facts are asserted (`director-ffmpeg-engine.test.ts` — 3 new M27 tests, all passing on REAL renders).
- HyperFrames engine: voiceover now rendered via the same timed `<audio>` mechanism as the music bed; scene-timed SFX are NOT applied and the render notes say so explicitly (honest limitation, never a silent drop).
- Scene regeneration: pre-existing preserve/recompute behavior unchanged; narration timing JSON carries the recompute-or-review note.

## 11. Trust Engine receipts and checkpoints — **Wired**

- `src/lib/trust/adapters/audio.ts`: completion / failure / cancellation receipts for all four audio task families; ffprobe facts as `measurement` evidence; the verification summary explicitly states what automation cannot claim (speech content correctness, listening approval).
- One receipt per job (idempotent settlement guard); partial outputs recorded as evidence with their segment counts; engine identity recorded per job.
- Cancel semantics: mid-run cancel preserves completed segments, settles `cancelled` (never failed/success), receipt states the preservation.
- Checkpoints: narration projects are resumable by construction (per-segment jobs; `reconcileNarrationSegments` claims completed jobs and preserves artifacts — a retry never re-generates a ready segment; the queue dedupe + CAS claim prevents duplicate side effects).

## 12. Desktop and mobile UI evidence

- 14 screenshots captured against the RUNNING app (production build for boot, dev mode for the authenticated pass — see `scripts/m27-ui-inspect.sh`): dashboard card, Voice/Narration/Soundtrack tabs at 1440×900 and 390×844, narration create → generate → join states, JAZMII narration block + attach toast.
- Layout: existing shell/design system untouched; the narration/soundtrack tabs reuse the champagne-gold kit; audio players wrap (`max-w-full`) on mobile.
- Fixed during inspection: a React #31 crash (EmptyState contract) — caught by the real browser pass and corrected.

## 13. Tests / TypeScript / lint / Prisma / security / build

- **Tests:** 2359 pass / 0 fail / 176 files / 40,326 expects (`bun test --isolate tests/`) — includes the real E2E audio tests and 3 new real-render composition audio tests. The M26 F-G1 regression test was updated to the new truth (gangzii tasks wired; genuinely unwired tasks still settle NO_BACKEND).
- **TypeScript:** 0 errors in `src/` (pre-existing script-file errors outside M27 scope unchanged).
- **ESLint:** clean on all touched source files.
- **Prisma:** schema valid; `db push` applied (NarrationProject / NarrationSegment / GangziiAudioAsset + User relations); client regenerated.
- **Security/secret scan:** clean across all 40 changed tracked files (key patterns + the redacted credential string).
- **Production build:** compiles successfully (`next build` with `BEAN_BUILD_NO_STANDALONE=1` for the ₹0 host's disk budget); one PRE-EXISTING warning remains (Edge-runtime analysis of `instrumentation.ts:30 process.pid` — M26 code, unchanged here).
- Real engines exercised: local Kokoro ONNX inference, real ffmpeg concat/mix/ebur128, real ffprobe gates.

## 14. Existing failures or limitations (honest)

1. **HF egress throttling (environment):** this sandbox's IP is HTTP-429 rate-limited by HuggingFace; the model was installed from the ModelScope mirror of the same repo (sha256 recorded; HF LFS-OID cross-verification pending — idempotent re-install on an unthrottled host verifies against the canonical source).
2. **No GPU here:** RTX 1.30 realtime factor on CPU is the verified baseline; Qwen3-TTS-class expressive engines remain Planned for GPU hosts.
3. **HyperFrames SFX limitation:** scene-timed SFX are not applied by the HyperFrames engine path (recorded in render notes); voiceover IS supported there.
4. **Static ducking:** no sidechain detection — a declared volume reduction under narration (stated in notes and receipts).
5. **Music generation:** still honestly unavailable (license review pending on the candidate weights) — the brief's launch requirement is the licensed soundtrack editing/mixing system, which is what shipped.
6. **Word-level timing:** no forced-alignment engine is bundled; timings are segment-level measured + approximate (never labeled as word alignment).
7. **ui-inspect account:** the UI inspection created one disposable admin account on the dev database (`ui-inspect-…@test.local`) for the authenticated pass; the DB is the local dev database and the account can be deleted from Settings like the M26.2 inspection account.

## 15. Actual monthly infrastructure requirements

**₹0.** Local ONNX CPU inference, local ffmpeg processing, on-demand model storage (~92 MB disk), no paid APIs, no new services.

## 16. Git record

- Branch: `feat/gangzii-audio-production`
- Base SHA: `e983c41` (main; ancestor of all JAZMII commits)
- Commit SHA: see the commit line below (recorded at commit time) — all changes committed locally; **no push, no history rewrite**.
- Working tree after commit: clean (except intentionally untracked runtime storage).

## 17. Publication status

**Publication freeze remains active — nothing was pushed.** The owner's standing instruction (publish approved changes once security gates close) remains gated on the explicit publication authorization; no GitHub state was verified or claimed.
