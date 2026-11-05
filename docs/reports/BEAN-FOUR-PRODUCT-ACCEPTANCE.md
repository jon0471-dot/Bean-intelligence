# BEAN Four-Product Acceptance Report — FINAL (GO-LIVE)

**Date:** 2026-11-05 · **Branch/HEAD:** `main` @ `dca2220` (+ this session's commit) · **Evidence:** committed `scripts/golive-out/evidence.jsonl` + artifacts, live DB job rows (cited by id), fresh probe JSON (`scripts/probe-image-edit-out/`, `scripts/giftz-verify-out/`), live-rendered UI captures, and the four per-product LIVE reports (`LAXII-LIVE-ACCEPTANCE.md`, `JAZMII-LIVE-ACCEPTANCE.md`, `CODE-GIFTZ-LIVE-ACCEPTANCE.md`, `W6-FINAL-ACCEPTANCE.md`).

## 1. Verification environment

Real Next.js dev server on :3000 (the deployment the public preview serves), real Prisma/SQLite database, real authorized provider gateway, real local sandbox runner. Every counted result is a real backend execution, a real provider artifact or a real rendered page. Provider mocks exist only inside isolated adapter unit tests and are never counted as generation proof.

## 2. Final acceptance matrix

| Product | Feature | Implementation | Real test | Result |
|---|---|---|---|---|
| RIISHE | Assistant: streaming turn, multi-turn context, persistence, memory | Full (pre-existing, audited) | **LIVE 2026-11-04**: turn 1 streamed (SSE 200, conversation created), turn 2 held the codename ("GOLDEN CANYON"), 5-message history re-listed with intact roles; chat-class probe succeeded again 2026-11-05 00:51Z; the research turn hit the account 429 window and is recorded verbatim | **PASS** (generation/context/persistence) · research turn live attempt recorded `RATE_LIMITED` during a throttle window |
| LAXII | Text-to-image pipeline | Full | **LIVE 2026-11-04**: two completed generations (1024×1024, 186,940 B / 131,909 B, JPEG magic verified, owner-checked delivery); fresh 2026-11-05 attempt honestly `BACKEND_FAILURE` (429 window) | **PASS** |
| LAXII | Deterministic exact-preservation editing | Full | Completed original/diff asset triples; live honest-503 refusal while GPU worker disabled | **PASS** |
| LAXII | Hosted conversational editing | Implemented + adapter fixed to the measured contract | Provider rejects every known request shape (10-shape measured probe); typed 400 recorded verbatim on the job; capability endpoint discloses the blocker | **BLOCKED** (undocumented provider contract; unblock = one field once documented) |
| JAZMII | Text-to-video (async end-to-end) | Full | **LIVE**: 202 submission → provider task `20261105…f82` → completed in ~88 s → 1,506,330-byte MP4 magic-verified server-side → owner-checked Range delivery | **PASS** |
| JAZMII | Image-to-video | Implemented, unit-pinned | Live submission 202; worker call hit the 2026-11-05 throttle window → typed `RATE_LIMITED` recorded; completion awaits a window | **PARTIAL** (pipeline real; fresh completion blocked) |
| JAZMII | Progress/cancel/preview/download/history | Full | Worker lifecycle + honest stop-tracking cancel + Range media route (unit-pinned + completed-job media verified) | **PASS** |
| CODE GIFTZ | Real coding responses (SSE) | Full | **LIVE 2026-11-04**: two streamed answers (1,052/1,041 chars) containing working `debounce` code; honest in-stream 429 error frames keep the message for retry | **PASS** |
| CODE GIFTZ | Conversation sidebar + persistence | Full | 24 unit tests + live UI run-through; calendar-safe fixture fix this session; project restore verified live | **PASS** |
| CODE GIFTZ | Task mode + sandbox execution | Full | Contract pinned (approval + ownership + files); sandbox returns verbatim exit code/output; 6 completed tasks in DB (3 with generated `main.js`); fresh task-create attempts today typed-429'd | **PASS** (executor live-verified on gateway-created tasks; fresh creation throttle-gated) |
| CODE GIFTZ | W6 self-verification | Full, default-off | Local eval PASS this session (4/4 executed ground truth, 8/8 detection, 8/8 verifier contract); live R3 best 66/67; live re-run throttle-gated | **PASS (local)** / live **BLOCKED** |

## 3. Separation of claim levels

- **Implemented:** everything in the matrix (source-level, unit-pinned).
- **Locally tested:** `bun test` **1,045 pass / 0 fail / 67 files** (29k+ expects); `tsc --noEmit` baseline errors remain scripts-only; `eslint` clean on changed files.
- **Integration tested:** four-product acceptance harness runs on the real server incl. cross-user IDOR guards, typed failure envelopes, health projection.
- **Real-provider tested:** RIISHE (2-turn conversation), LAXII (2 completed images), CODE GIFTZ (2 streamed coding answers), JAZMII (1 completed video) — all with committed artifacts/rows. 2026-11-05 fresh attempts during the sustained throttle window were recorded as typed failures rather than retried into.
- **Public-preview tested:** dashboard + product UIs inspected in real browsers this session (uniform cards, honest 5-state statuses, JAZMII degraded-capability label).
- **Production-ready:** not claimed — single-node queue/rate-limit stores, process-level sandbox isolation, and the shared-account throttle dependency remain documented limitations.

## 4. Honest status dashboard (measured at report time)

| Product | Status | Evidence |
|---|---|---|
| RIISHE | operational↔unavailable (throttle windows) | chat probe 200 at 00:51Z; later probes 429 → breaker escalation; research class independent |
| LAXII | operational (reachability) with generation gated by the same account throttle | images-class breaker opened on a real 429 during the fresh attempt — exactly the designed behavior |
| JAZMII | operational (reachability + completed-job evidence) with fresh submissions throttle-gated | video-class typed failures recorded verbatim |
| CODE GIFTZ | operational↔unavailable (throttle windows) | probe 200 at 01:21Z; later windows 429 |

HTTP 200 on reachability is never treated as generation proof; the five-state contract (Operational/Degraded/Unavailable/Not configured/Checking) renders the measured reality, and one product's failure never alters another's health result (per-class breakers + isolated probes).

## 5. Blockers (explicit, current)

1. **Shared-account provider throttling (HTTP 429, all endpoint classes)** — external; the bounded escalating breaker (60 s → 600 s cap) is verified working; fresh live evidence gathering simply waits for windows. No workaround without violating the no-fabrication rules.
2. **LAXII conversational-edit provider contract** — `/images/generations/edit` rejects every tenant-derivable request shape (10-shape measured probe incl. gateway-issued CDN URLs); public provider docs describe no edit endpoint. Unblock requires the provider's documented contract; the adapter change is then one field.
3. **Generative masked editing / InstantID-class identity preservation** — requires a GPU host + licensed checkpoints (honest typed 503 refusal shipped); hardware fit for open video models on the workstation not yet assessed (no weights downloaded).
4. **W6 live R3 (67/67)** — requires chat-class windows; local suite PASS.

## 6. Cost discipline

No uncontrolled API spend: acceptance used single spaced real calls per product feature (2 image generations 11-04, 1 video generation 11-04, plus 400-class rejections that cost no inference); the 10-shape edit probe produced only 400 rejections (no inference cost); no alternative-provider credentials exist; no model weights were downloaded.

## 7. Deliverables, migrations, backups, rollback

- This task's commits (session of 2026-11-04/05): `dca2220` (real-artifact GO-LIVE evidence), the pending commit for this session (LAXII edit-contract fix + capability disclosure + calendar-safe fixture + probe scripts + four LIVE acceptance reports + this final matrix).
- **DB migrations:** none added; schema unchanged. **Backup before any work:** `db/custom.db.backup-20261104-135209.db`.
- **Deployment config:** single dev-server process on :3000; provider credentials remain tenant-runtime-managed (never in the repo); no new env vars required.
- **Rollback:** revert the listed commits; no migrations to undo; user data untouched (acceptance runs use isolated `golive-acc-*` / `accept-*` / `e2e-*` accounts).
