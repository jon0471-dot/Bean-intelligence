# GANGZII — Audio & Speech

**Status: implemented. BEAN's audio specialist: TTS, narration studio, music/song production, transcription.**

## 1. Purpose and responsibilities

GANGZII produces real audio: speech synthesis (hosted + local Kokoro voices),
narration projects with segments and mixing, music/song generation, audio
conversion and transcription — with deterministic validation on every asset.

## 2. Actual architecture

- Product views `src/components/bean/gangzii.tsx`, `gangzii-narration.tsx`,
  `gangzii-soundtrack.tsx`.
- API surface `src/app/api/gangzii/`: `tts`, `tts-engine`, `voices`,
  `narration`, `music`, `produce`, `song-presets`, `lyrics`, `convert`,
  `transcribe`, `jobs`, `assets`, `audio`, `live`, `availability`.
- Durable worker `src/lib/jobs/audio-worker.ts` +
  `src/lib/adapters/gangzii-audio.ts` / `hosted-audio.ts` (chunked TTS math
  validated before any job row is created).
- Voice presets: `src/lib/registry/gangzii-presets.ts` (`isHostedVoice`,
  `isKokoroVoice` — unknown voices are refused, never substituted).

## 3. Source-code locations

| Concern | Path |
|---|---|
| TTS/voices | `src/app/api/gangzii/{tts,tts-engine,voices}/` |
| Narration | `src/app/api/gangzii/narration/`, Prisma `NarrationProject`/`NarrationSegment` |
| Music/songs | `src/app/api/gangzii/{music,produce,lyrics,song-presets}/` |
| Worker/adapters | `src/lib/jobs/audio-worker.ts`, `src/lib/adapters/{gangzii-audio,hosted-audio}.ts` |
| Delegation tool | `synthesize_speech` in `src/lib/riishe/specialists.ts` |
| Persistence | Prisma `GangziiAudioAsset` |

## 4. Model and provider integration

Hosted TTS/audio backend + the consented local Kokoro engine
(`tts-engine`); availability probes feed the health surface. Chunk math is
fail-fast pre-submission; no hidden fallback voice provider.

## 5. Input/output contracts

Speech: `{ text ≤1000 chars, voice ∈ known presets, speed }` — the delegation
tool validates the voice against the real preset lists BEFORE any job row.
Narration: project → segments → per-segment jobs → mixed asset. All outputs
are durable assets in owner-scoped history with validation flags.

## 6. Tools and permissions

`synthesize_speech` requires `allowSpeechSynthesis` + capability-plan
agreement; the AUTOBOTS `voice` capability grants the same key. Voice
substitution is structurally impossible (unknown voice → honest refusal).

## 7. Data and memory handling

Narration projects/segments/audio assets are owner-scoped rows; transcripts
(`transcribe`) persist with their source metadata; no audio leaves the
user's scope.

## 8. Execution workflow

submit → preflight → validation (voice + chunk math) → durable job → audio
worker → adapter/engine → deterministic audio validation → asset + receipt.

## 9. Existing tests and verification

`tests/integration/gangzii-audio-worker.e2e.test.ts`, chunking/validation
units in `riishe-specialist-delegation.test.ts`, narration suites in the
unit census (`gangzii-*`).

## 10. Failure handling and fallback behavior

Chunking overflow is a pre-submission refusal; engine failures classify
honestly; partial narration segments keep their real per-segment states.

## 11. Current implemented capabilities

TTS with preset voices (hosted + local Kokoro); narration studio with
segment mixing; music/song production lane; conversion; transcription;
RIISHE/AUTOBOTS delegation.

## 12. Partial capabilities and known limitations

No voice cloning; speech jobs capped at 1000 characters per submission;
music generation quality depends on the configured backend.

## 13. Planned capabilities (NOT implemented)

Real-time voice agents, singing-voice synthesis — roadmap only.
