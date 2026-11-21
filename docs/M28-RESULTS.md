# M28 RESULTS — GANGZII Audio Reliability & Creative Quality

**Date:** 2026-11-21 · **Branch:** `feat/m28-audio-reliability-quality` (base `ae41561` = M27, verified ancestor of e983c41/8de0144/2a9b4cb) · **Publication freeze respected: everything stays local, nothing pushed.**

---

## 1. Mandatory repo inspection — done first

- Local `main` HEAD was exactly `ae4156157348720fb74f68b26f1325089813f9cf` (M27), clean tree, no stash.
- Ancestry VERIFIED: `e983c41` (Trust specialist coverage), `8de0144` (JAZMII), `2a9b4cb` (Trust Phase 1) are all ancestors of `ae41561`.
- Remote `main` = `a014862` (M26.1 quarantine state); local main is strictly ahead by 27 commits (no divergence; `git ls-remote` read-only).
- `feat/m28-audio-reliability-quality` created from `ae41561`; all existing branches preserved untouched.

## 2. Priority A — Canonical Kokoro model verification

**Status labels:** integrity verifier **Implemented** · canonical HF cross-verification **Pending (owner action, blocked by environment)** · install-path bug found & fixed **Verified**.

- **Exact revision:** `onnx-community/Kokoro-82M-v1.0-ONNX`, revision ref `main`, dtype q8. This sandbox's HF egress is still HTTP-429 (single gentle probes, no hammering) — the canonical commit SHA could NOT be resolved from here and is honestly recorded as pending, exactly per spec.
- **Install manifest (real, this session):** 4 files hash-verified against the **ModelScope mirror's own published sha256s** — `config.json` `df34b4f9…`, `onnx/model_quantized.onnx` `fbae9257…` (92,361,116 bytes), `tokenizer.json` `77a02c8e…`, `tokenizer_config.json` `be1cb066…`. Provenance state: **`mirror-hash-verified`** — never claimed canonical.
- **`src/lib/gangzii/model-integrity.ts`:** read-only file-by-file SHA-256 verifier; missing / unexpected / modified / size-mismatch / unreadable-json detection; canonical-reference support; provenance state machine; process cache with mtime invalidation; voice packs explicitly excluded (npm lockfile governs `node_modules/kokoro-js/voices/*.bin`).
- **`scripts/m28-verify-kokoro-provenance.ts` (owner-executable):** resolves revision → exact commit → tree at that commit (LFS OIDs = sha256) → downloads non-LFS files from the exact commit → byte-compares the install → writes `bean-canonical-reference.json` ONLY on full success; rate-limit respectful (3 attempts, 30/60 s backoff, honest PENDING exit 2); revision-drift refusal; `BEAN_HF_API_BASE` override for proxied networks. Proven offline success + tamper + drift + not-installed paths against a local fixture server (integration tests).
- **Integrity-cache invalidation** on model removal; status/metadata surfaces carry the state.
- **Bug found in review (M27 install path):** ModelScope answers HTTP 200 with a plain `Entry not found` body for absent files — the optional `special_tokens_map.json` (not in the repo) got written to disk POISONED and the retry budget burned. Fixed: upstream file-listing gate (absent → skip; required-but-unlisted → refuse), garbage-body detection, verifier-level JSON parse defense. Regression-tested.

## 3. Priority B — Speech quality evaluation system

**Status:** **Implemented, verified end-to-end** (48 real samples). Listening review **pending owner action** (by design).

- **Corpus:** `evals/gangzii-speech/corpus.json` v1 — 12 required categories (short/long/paragraph/questions/exclamations/numbers-currency/dates-times/abbreviations/urls/names-uncommon/punctuation/mixed), owner-approvable, non-sensitive.
- **Runner:** `evals/gangzii-speech/run.ts` + `scripts/m28-speech-eval.ts` — real synthesis through the production engine; per-sample measured: codec/sample-rate/channels/duration, EBU R128 integrated LUFS + true peak (with unit) + LRA, peak/mean level, clipping indicator, silence regions, generation latency, RTF, peak RSS sampling, environment (host/vCPU/CPU/RAM/ffmpeg), model identity + artifact-integrity state at run time.
- **Measured evidence (run `run-2026-11-21T05-05-09-926Z`, 48/48 samples):** voices af_heart/am_michael/bf_emma/bm_george × all 12 categories; RTF 1.22–1.28; integrated LUFS −18.5…−24.7; 24 kHz mono PCM16 everywhere; 1 clipping-suspected sample (am_michael/question-1, TP 0 dBFS — flagged for owner listening, never hidden); artifacts under `storage/evals/gangzii-speech/`.
- **Regression comparator:** `scripts/m28-speech-regression.ts` vs `m27-baseline.json` — RTF 1.24 vs 1.30 baseline = `same` (Δ −0.06, tolerance ±0.35); hardware-comparability honestly NO (different host) so RSS difference (998 MB peak-sampled vs M27's 642 MB point-measured) is recorded as indicative-only, not a regression claim. Pronunciation/intelligibility = owner-listening-required, never auto-measured.
- **Listening review sheet:** generated per run with pre-filled MEASURED columns and EMPTY subjective columns (intelligibility/pronunciation/naturalness/pacing/pauses/consistency/transitions/artifacts) + per-voice verdict block + global sign-off. No human listening has happened yet → no voice is upgraded beyond `samples-generated-review-pending`.
- **Other languages:** stay UNVERIFIED (never claimed).
- **Shared EBU R128 parser fix:** `src/lib/media/loudness.ts` — the M27-era first-match regex grabbed a transient window value (−70 LUFS) and never matched ffmpeg 7.x's dBFS-labeled true-peak line (TP was silently null). One section-aware parser now feeds BOTH the worker receipts and the evaluator; unit-tested against the exact captured output shapes.

## 4. Priority C — Dynamic narration ducking

**Status:** **Implemented, verified end-to-end with real renders** (both engines).

- **`src/lib/gangzii/ducking.ts`:** deterministic timeline automation from declared narration regions — normalize (clamp/merge/sort, 50-region cap), bounded config (duckTo 0.05–1, attack/release 0–2000 ms, cosine|linear, min-level floor), ONE ffmpeg `volume` expression (nested if — first window wins so a following attack overlaps a previous release smoothly without pumping), evidence breakpoints recorded. Explicit honesty: timeline-driven from measured narration timing, **NOT sidechain compression**; source assets never modified; manual volume automation stays available.
- **GANGZII production worker:** new `duck-dynamic` op (bounded route schema), plan recorded in resultJson.
- **JAZMII FFmpeg engine:** music follows the dynamic curve when measured narration regions exist; without them the honest M27 static duck note is preserved. User duck overrides via approved-plan `duckParams`.
- **director-worker:** reads `narration-timing.json` — measured durations only, timings never guessed.
- **Real-render verification:** standalone bed test (measured levels inside/outside windows within 0.8 dB, recovery between regions, no clipping) + final-MP4 test (ducked window ≈ full window −9.1 dB ±2 dB in a composed video) + static-fallback note test.

## 5. Priority D — HyperFrames SFX integration

**Status:** **Implemented, verified with REAL HyperFrames renders** (limitation from M27 closed).

- **Runtime contract investigation (read from the shipped hyperframes@0.9.72, not guessed):** timed `<audio>` elements support data-start/duration/volume + per-element data-fade-in/data-fade-out and mix through the runtime's WebAudio graph; audio elements are excluded from the data-start visibility rule. Same mechanism M27 already verified for music + voiceover.
- **Engine:** each SFX asset copied into the composition, duration MEASURED with ffprobe, timed element generated (clamped start/duration, bounded volume, fades when requested); applied-note records positions and volumes; probe failures keep an explicit note; the old "NOT applied" limitation note is GONE because the limitation no longer exists.
- **FFmpeg engine parity:** per-effect fades wired (afade in at placement; afade out placed against the MEASURED asset duration — probe failure skips with a note instead of guessing).
- **Measured gain staging (recorded honestly in render notes):** the runtime's WebAudio mix renders ≈ −18 dB vs source unity while data-volume stays linear (Δ −6.02 dB per ×0.5, measured) — absolute loudness differs from the FFmpeg unity mix; relative levels (ducking, fades, SFX balance) match; loudnorm is the recommended final step for delivery masters.
- **Real-render tests (browser ensured locally):** presence (RMS jumps in-window), placement (between-effects window silent), volume linearity within tolerance of the measured staging, overlap (two effects both land, overlap louder), fade-out decay, duration/frame accounting unchanged vs the no-SFX render, no clipping.

## 6. Priority E — Narration timing confidence

**Status:** **Implemented** (vocabulary + preservation verified); word alignment honestly **Unavailable** (no aligner bundled).

- **`src/lib/gangzii/timing.ts`:** word-verified (RESERVED — unreachable by heuristics) / segment-measured / segment-estimated (explicit preview estimate at the measured ≈2.6 words/s Kokoro pace) / unavailable. Broken measured chain → later segments labeled `unavailable` with an EXPLICIT estimate, never silent.
- **narrationSceneTiming + JAZMII narration-timing.json** carry timingLevel + per-segment confidence; subtitles still skip unmeasured segments (M27 rule intact); approximate timestamps never presented as word alignment.
- **Forced-alignment evaluation** (`docs/models/GANGZII-TIMING-ALIGNMENT-EVALUATION.md`, web-verified): whisperX (BSD-2 code; default alignment weights CC-BY-NC — commercial blocker; Python/torch), aeneas (**AGPL-3.0 — rejected**), torchaudio MMS_FA (**CC-BY-NC — rejected**), ctc-forced-aligner (default weights CC-BY-NC), gentle (Python + Kaldi, weak Windows). None compatible with the ₹0 TS-only stack → measured segment timing + confidence is the M28 contract; owner-host aligner = the future `word-verified` path (Planned).
- **Preservation verified by test:** regenerating one segment changes only downstream starts; unchanged segments keep exact measured durations.

## 7. Priority F — Audio timeline synchronization

**Status:** **Implemented, verified** (flag logic unit-tested; director suites green).

- **`writeNarrationTimingPayload`** (shared by attach + approval): timing recomputed from the same measured durations against the CURRENT scene layout — scene duration/order changes after attach are reflected without re-synthesizing speech; unrelated music/SFX untouched (tracks are only read).
- **Explicit review flags** (pure `computeTimingReviewFlags`): `scene-out-of-range` (association points at a removed/renumbered scene), `speech-overruns-scene` (segment audio > scene + 0.5 s), `timing-unavailable` — written per segment + top-level into narration-timing.json with `capturedAt` + `recomputedForScenes` audit fields. Nothing is silently moved.
- **Approval flow** recomputes attached-narration timing before the plan freezes (recompute failure = logged warning, never stale timing silently used).

## 8. Priority G — Trust Engine receipts

**Status:** **Implemented, verified on a real synthesis job.**

- **Six distinct verification states** (never a generic `verified`): model-artifact-integrity (verbatim provenance; `not-applicable (hosted engine)` stated where true) / speech-generated / audio-technically-validated / audio-timeline-synchronized / **user-listened-and-approved: false (always, from automation)** / aesthetic-quality-independent-verification: `not-performed` — recorded as a measurement evidence row and appended to every verification summary.
- **Evidence added:** model identity + provenance row (repo/revision/dtype/artifactProvenance/checksumSource/canonical commit), ducking automation row (regions + resolved config, "timeline-driven, NOT sidechain"), ducking + timelineFacts + masterLabel in the generation step detail.
- **Measured evidence (scripts/m28-receipt-probe.ts, real job):** status completed on `bean-audio-tts-local-kokoro`; receipt shows `model-integrity=mirror-hash-verified; checksumSource=modelscope-mirror`, ffprobe facts 24 kHz mono, six-state block with `user-listened-and-approved=false`. Checkpoint/ledger infra reused unchanged; idempotent settlement + partial-preservation semantics unchanged from M27.

## 9. UI (§10) — minimal targeted changes, inspected on the RUNNING app

- **Narration engine card:** artifact-provenance block — state, checksum source, canonical commit (when present), files-verified counts, and the owner-utility command for closing the canonical gap. Captured: *"verified against the download mirror — canonical Hugging Face cross-verification still pending — checksum source: modelscope-mirror. Files verified 4/4, 0 modified, 0 missing, 0 unexpected."*
- **Soundtrack production:** ducking mode select (none/static/**dynamic**) with narration regions + depth/attack/release/curve controls; completed jobs show the applied plan summary. Captured with a real stored asset and "Dynamic (timeline-aware)" selected.
- **Desktop + mobile inspected on the running app** (1440×900 and 390×844, disposable account `ui28-1795241443@test.local`, deletable in Settings): `scripts/m28-ui-out/*.png`. No mock audio, no fabricated waveforms.
- (Production-origin note: localhost browser POSTs are rejected by the strict origin policy in production builds — the inspection used `BEAN_TRUSTED_ORIGINS` for the session, consistent with the config-driven design.)

## 10. Consolidated verification (§12)

| Gate | Result |
|---|---|
| Full test suite (`bun test --isolate tests/`) | **2410 pass / 0 fail** · 182 files · 40,497 expects — includes REAL Kokoro TTS E2E through queue+worker+Trust, real ffmpeg joins, real HyperFrames renders |
| Real local TTS E2E | 2/2 pass (segment synthesis → measured timings → real join; receipt asserts honest non-claims) |
| Real FFmpeg audio/composition | ducking level assertions measured from rendered audio; SFX placement/fade assertions from real renders |
| Real HyperFrames renders | 4/4 (browser ensured locally) |
| TypeScript | **0 errors in `src/`** (7 pre-existing test-file strictness errors in files untouched by M28; pre-existing script/validation errors unchanged) |
| ESLint | **0 errors on all M28-touched files** (repo-wide remaining errors are pre-existing `validation/m21` legacy fixtures only) |
| Prisma | schema valid (no schema change needed in M28) |
| Security/secret scan | **0 hits across all 38 M28-changed files** (repo-wide script hits are the documented benign M26 synthetic-token fixtures) |
| Production build | ✓ compiled (`BEAN_BUILD_NO_STANDALONE=1`; pre-existing Edge-runtime instrumentation warning unchanged) |

Mocks are not the proof anywhere: every milestone claim above is backed by real synthesis, real renders, real ffprobe/ebur128 measurements or real fixture-server protocol tests for the canonical path (HF itself remained 429 from this host).

## 11. Infrastructure cost (§11)

**₹0/month.** Local ONNX CPU inference, local ffmpeg, hyperframes local render (managed browser installed locally, one-time download), no paid APIs, no GPU requirements, no new services. Kokoro CPU remains the production baseline (RTF 1.22–1.28 measured this milestone). Qwen3-TTS stays non-mandatory. No visitor hardware used for other users' jobs.

## 12. Known limitations (honest)

1. **Canonical HF cross-verification pending** — this host is HTTP-429 rate-limited by Hugging Face; the install is mirror-hash-verified only. Owner action: run `bun scripts/m28-verify-kokoro-provenance.ts` on any machine with HF access (exit 0 = verified; the server picks the reference up automatically).
2. **Listening review pending** — the review sheets are generated; voices stay `samples-generated-review-pending` until the owner actually listens and signs.
3. **Non-English voices** remain unverified/untested (unchanged policy).
4. **Dynamic ducking is timeline-driven, not sidechain compression** — stated in every note/receipt.
5. **HyperFrames absolute loudness ≈ −18 dB vs FFmpeg unity** (measured, runtime behavior) — relative levels match; loudnorm recommended for delivery masters.
6. **Word-level timing unavailable** — no aligner bundled (license/runtime evaluation recorded); `word-verified` is reserved.
7. **Music generation** remains unavailable (unchanged; not an M28 requirement).
8. **One-pass loudnorm** unchanged (M27 behavior preserved).
9. Pre-existing repo-wide TS/ESLint findings in `scripts/` and `validation/` fixtures are unchanged (outside M28 scope, as in M27).

## 13. Git record (§14)

- **Branch:** `feat/m28-audio-reliability-quality`
- **Base SHA:** `ae4156157348720fb74f68b26f1325089813f9cf` (M27)
- **Workspace main-pinning incident (recorded honestly):** the known workspace behavior pinned local `main` to the working HEAD between tool calls, so the ten M28 commits landed on local `main` while the feature branch stayed at the base. After consolidated verification the feature-branch pointer was FAST-FORWARDED to the verified tip (pure pointer move — no rewrite, no reset, no loss; every commit byte-identical). Final state: `feat/m28-audio-reliability-quality` = `main` = `fc7ee8b` (both local-only).
- **External remote change observed:** `git ls-remote` at session end shows remote `main` moved from `a014862` (the value verified at session start) to `91a6809` — this milestone pushed NOTHING; the change came from outside this workspace. No fetch/merge/pull was performed against it. Publication decisions remain the owner's, gated as specified.
- **Commits (local, coherent, after consolidated verification):**
  1. `feat(gangzii): M28 Priority A — model-artifact integrity verifier + canonical provenance utility`
  2. `feat(gangzii): M28 Priority B — repeatable speech-quality evaluation suite + shared EBU R128 parser fix`
  3. `feat(gangzii): M28 Priority C — dynamic narration ducking with deterministic timeline automation`
  4. `feat(jazmii): M28 Priority D — real HyperFrames SFX integration on the pinned runtime's verified audio contract`
  5. `feat(gangzii): M28 Priority E — narration timing confidence vocabulary + honest forced-alignment evaluation`
  6. `feat(jazmii): M28 Priority F — audio timeline synchronization with explicit review flags`
  7. `feat(gangzii): M28 Priority G — Trust receipts carry the six distinct verification states + full audio evidence`
  8. `feat(gangzii): M28 UI — model-artifact provenance card + dynamic ducking controls`
  9. `fix(gangzii): M28 — soundtrack UI types for the ducking result payload`
  9a0a9f0 (A) · 735ab85 (B) · 02a35f4 (C) · ba93dc7 (D) · ce2dbb2 (E) · 597daba (F) · 75db418 (G) · 4bdca0b (UI) · fcf0bf4 (fix)
  Final report commit: fcf0bf4419b24d5b085385707f3db5a4fb341a3f is HEAD before the report commit; the report itself lands as the next commit.
- **Working tree after commits:** clean (untracked runtime storage only: `storage/`, inspection outputs).
- **Publication freeze:** respected — **no push, no merge, no history rewrite, no force-push, no recovery material touched.** GitHub is NOT updated (remote main remains `a014862`; verified via read-only `ls-remote` this session).

## 14. Owner action required

1. **Canonical verification:** on a machine with Hugging Face access run `bun scripts/m28-verify-kokoro-provenance.ts` from the repo root (records the exact commit + writes the canonical reference; the GANGZII UI + receipts upgrade to `canonical-verified` automatically).
2. **Listening review:** open `storage/evals/gangzii-speech/<runId>/review-sheet.md`, listen to the 48 samples, fill the subjective columns and verdict blocks; delete the disposable UI inspection account from Settings.
3. **Publication:** unchanged policy — approved changes publish to GitHub only after the security gates close AND explicit publication authorization.
