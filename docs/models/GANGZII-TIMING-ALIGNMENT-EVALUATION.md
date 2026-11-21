# GANGZII Narration Timing & Forced-Alignment Evaluation (M28 Priority E)

**Date:** 2026-11-21 · **Decision:** no local forced-aligner is bundled with M28; segment-level MEASURED timing with explicit confidence labels is the production contract. Word-level alignment stays reserved (`word-verified` is never self-assigned by heuristics).

## The confidence vocabulary (implemented in `src/lib/gangzii/timing.ts`)

| Level | Meaning | Used for |
|---|---|---|
| `word-verified` | Word boundaries aligned against the audio by an actual aligner | RESERVED — no engine produces this today |
| `segment-measured` | Segment boundaries derived from the REAL audio artifact duration (engine output + ffprobe) | subtitles (SRT/VTT), JAZMII narration-timing.json, ducking regions |
| `segment-estimated` | Duration estimated from text length (≈2.6 words/s measured Kokoro pace), explicitly labeled | preview / sync planning ONLY — never subtitles, never ducking |
| `unavailable` | No trustworthy timing (measured chain broken before this segment) | flagged for review / regeneration |

Consumers must carry the label through to the user. Subtitles continue to SKIP unmeasured segments (counted, never estimated) — unchanged from M27 and still the honesty rule.

## Local forced-aligner candidates — evaluated, none bundled

| Candidate | Code license | Weights license | Commercial use | Runtime | Verdict |
|---|---|---|---|---|---|
| **whisperX** (m-bain/whisperX) | BSD-2-Clause (repo) | Whisper weights MIT; **alignment uses wav2vec2/MMS-family models — MMS is CC-BY-NC-4.0 (non-commercial)**; pyannote diarization needs HF gated agreement | Conditional — the default alignment weights are the blocker | Python + PyTorch (multi-GB), CUDA-preferred, CPU-usable | **Not bundled.** Wrong runtime (TS/Node ₹0 stack), heavy weights, weight-license review required. Candidate for the owner's GPU host with explicit license sign-off — *Planned, not blocked* |
| **aeneas** (ReadBeyond) | **AGPL-3.0** (verified: readbeyond.it + GitHub) | n/a | AGPL network-copyleft — incompatible with BEAN's closed product hosting | Python + C | **Rejected** (license) |
| **torchaudio MMS_FA** | MIT (torchaudio) | **CC-BY-NC-4.0** (Meta, verified in torchaudio 2.8 docs) | **Non-commercial → rejected** for BEAN | Python + torch | **Rejected** (weights license) |
| **ctc-forced-aligner** (MahmoudAshraf97) | BSD-2-Clause | **Default model CC-BY-NC-4.0** (stated in the repo README itself) | Conditional — needs a different (commercially usable) multilingual model | Python + torch | **Not bundled** — same runtime objection as whisperX |
| **gentle** (lowerquality/gentle) | MIT | bundles Kaldi (Apache-2.0) | OK in principle | Python + Kaldi binaries, Linux-oriented; Windows support weak | **Not bundled** — Python runtime + heavy binaries; stale maintenance |

Common thread: every practical local aligner is a Python/torch stack with hundreds-of-MB+ weights. BEAN's production runtime is TypeScript/Node on a ₹0 2-vCPU host; M27/M28 policy explicitly forbids automatic installation of large weights and new mandatory runtimes. A Python sidecar would also complicate the Windows owner machine.

## What M28 does instead (implemented)

1. **Explicit confidence on every timeline surface** — `narrationSceneTiming`, the JAZMII `narration-timing.json` (now carries `timingLevel`, per-segment `confidence`, and explicit `estimatedDurationMs` only where the measured chain is broken).
2. **Broken-chain honesty** — a segment AFTER an unmeasured segment cannot have a trustworthy measured start: it is labeled `unavailable` (with an optional preview estimate), never presented as measured.
3. **Measured-chain preservation** — timing derives from stored per-segment `durationMs` (measured at artifact time). Regenerating ONE segment re-derives only cumulative positions; every unchanged segment keeps its exact measured duration. JAZMII narration timing is recomputed from the same measured source (no stale estimates).
4. **Manual adjustment** — segment text editing + per-segment regeneration + Soundtrack trim/volume/fade ops remain the manual correction surface (M27, unchanged).

## Future path (explicitly out of M28 scope)

- Owner-host whisperX alignment behind an OPTIONAL adapter (license review of the alignment weights first, explicit install, never automatic) would upgrade segments to `word-verified` for export-quality subtitles.
- The adapter contract is already representable: an aligner that produces word boundaries upgrades `TimingConfidence` — no schema change needed.
