# BEAN — JAZMII ACCEPTANCE (FULL FUNCTIONAL TEST)

**Date:** 2026-11-07 · **Users:** `fulltest-20261107021847@bean-e2e.test` + retry account · **Evidence:** `scripts/fulltest-out/evidence.jsonl` (`jazmii-*`), artifacts `jazmii-t2v-*.mp4`, `jazmii-*.mp4`, screenshot `ui-jazmii-suite-final.png`

| # | Item | Result | Classification |
|---|---|---|---|
| 1 | Text-to-video | **REAL completed run**: job `cmw5sj5r20067r9vi3o23jz3o` — 1,537,913 bytes MP4, ffprobe: `h264, 1280x720, 5.19 s`. (Two earlier bounded attempts hit account 429s — recorded, not retried inside their windows) | REAL |
| 2 | Image-to-video | **REAL completed run — first in project history**: job `cmw5s0xdo005ir9vijf0xtte6` driven by the **real LAXII-generated image** (172,553-byte JPEG as base64 data URL) → 3,585,301 bytes MP4, ffprobe: `h264, 768x768, 5.13 s`. An earlier I2V attempt was accepted and rendered to 37 % progress before a throttle window failed it — proof the pipeline is genuinely end-to-end, and the completion removes the previous "blocked until a real completed run" gate | REAL |
| 3 | Asynchronous job submission | POST `/api/jazmii/generate` → 202 with job id; no HTTP request held open during rendering | REAL |
| 4 | Job status tracking | GET job detail polls observed `queued/running → completed` transitions with timestamps | DETERMINISTIC |
| 5 | Progress reporting | Progress values observed (5 → 17 → 27 → 37 … → 100); labeled "BEAN tracking estimate", not a provider percentage | DETERMINISTIC |
| 6 | Video preview | `videoUrl` served via owner-checked media route, 200 | DETERMINISTIC |
| 7 | MP4 playback | `ftyp` magic verified on both artifacts + ffprobe codec/resolution/duration above | DETERMINISTIC |
| 8 | Persistence | Job row re-fetch after refresh: status stable, bytes stable; media re-download **bytes-exact** (3,585,301 = 3,585,301) | DETERMINISTIC |
| 9 | Download / export | Full download 200 bytes-exact; **Range request → 206** with `content-range: bytes 0-1023/3585301` (streaming/seek supported) | DETERMINISTIC |
| 10 | Cancellation & failure handling | (a) Invalid size → **typed 400** before any provider call. (b) Cancel of a queued/running job → `DELETE /api/jazmii/jobs/<id>` returns `{cancelled: true}` (honest stop-tracking — the provider exposes no cancel API); observed follow-up: the poller recorded the provider's own failure (RATE_LIMITED) so the row ends `failed` — truthful, documented. (c) Two T2V 429 failures surfaced verbatim as typed RATE_LIMITED errors in the workspace | REAL / DETERMINISTIC |

## Notes

- The workspace "Generation history" shows the completed I2V video with a preview thumbnail and a working Download button (screenshot `ui-jazmii-suite-final.png`).
- All 429s (`02:09:38`, `02:11:38`, `02:18:58`, `02:22:5x`, `02:36:5x`) are recorded verbatim in evidence; each was a single bounded attempt per breaker window — no retry storms.
- I2V acceptance is based on an actual video generated **from the actual image** (Rule 5's requirement), not on pipeline wiring.

## In-product test workflow (Rule 8)

JAZMII workspace → "JAZMII test suite" card: T2V submission (REAL), async tracking (DETERMINISTIC), MP4 verification + download (DETERMINISTIC), invalid-size validation (SIMULATED). In-browser run during a throttled window: 2/4 passed with the tracking row honestly blocked; the deep harness separately completed both T2V and I2V.

## Verdict

**OPERATIONAL** — both text-to-video and image-to-video have real, ffprobe-verified completed runs with persistence, streaming export and honest failure handling. Remaining limitation: the external account-level throttle, which surfaces as typed RATE_LIMITED states and can delay job starts.
