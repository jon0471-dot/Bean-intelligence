# BEAN — LAUNCH READINESS REPORT

**Date:** 2026-11-08 (UTC) · **Report baseline commit:** `f6d8c86dec08ab33fb2373147fa0251de10c5591` (fixes delivered on top, same day)
**Scope:** four-product commercial launch recovery — verify, fix, and measure; no architecture changes.

---

## 1. Exact current Git state

- HEAD at inspection: `f6d8c86dec08ab33fb2373147fa0251de10c5591` (checkpoint commit; working tree clean).
- This report's fixes ship as a new commit on top; the fixes are: Python sandbox execution (RULE 3), LAXII conversational-edit 400 resolution with live verdict (RULE 4), capability-constant/test re-pins, sandbox health probe covering both interpreters.

## 2. Real inference supply (measured, not assumed)

- All four products ride **one platform-managed z-ai gateway** (credential from `/etc/.z-ai-config`; values never read by BEAN code).
- The **local llama.cpp lanes are real code but dormant**: no GGUF weights exist on disk, `BEAN_LLAMACPP_BASE_URL` and `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS` are unset. The registry slot (`bean-chat-local-llamacpp`) is designed for an operator-provisioned `llama-server` and consumes nothing while dormant. **The "local Qwen3 / Qwen2.5-Coder" lanes cannot serve traffic until the operator provisions weights** — this is the honest answer to "make RIISHE independent": today's independence is achieved by **degrade-not-die paths** (breaker + fallback to model knowledge), not by a second always-on model.

## 3. Actual working capabilities (all evidence from live runs, 2026-11-08)

### RIISHE — chat core OPERATIONAL, research OPERATIONAL, fallback PROVEN

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | English chat | PASS — HTTP 200, 785 ms | conv `cmw81pkc10024o2zvtzpylomy`, correct streamed answer |
| 2 | Tamil chat | PASS — HTTP 200, 808 ms | answered **in Tamil** ("இந்தியாவின் தலைநகர் புதுதில்லி.") |
| 3 | Chinese chat | PASS — HTTP 200, 5.8 s | "水的沸点是100摄氏度。" |
| 4 | Spanish chat | PASS — HTTP 200, 519 ms | "La capital de Perú es la ciudad de Lima." |
| 5 | Conversation history | PASS — HTTP 200, 728 ms | recalled the exact first question in the same conversation |
| 6 | Web research | PASS — HTTP 200, 21.8 s | `VERIFIED_FROM_SOURCES`, 2 official **nodejs.org** sources with URLs (Node 26.13.0 LTS + Nov-2026 security release) |
| 7 | Research fallback | PASS (honest degrade) — HTTP 200, 2.2 s | during a live 429 window: `TOOL_UNAVAILABLE`, "couldn't verify… based on stable knowledge"; **chat did not go down** |
| 8 | Background chat job | PASS — HTTP 202 → completed 723 ms | job `cmw810n1e000co2zvi9revwb8`, reply persisted to conversation |
| 9 | Duplicate-submission guard | PASS | identical resubmit → `CONCURRENCY_LIMIT` "An identical background job is already queued or running." |
| 10 | Cancellation | PASS | `POST /api/ai/jobs/<id>/cancel` → `signalled:true`, cooperative worker checkpoint |

### CODE GIFTZ — codegen OPERATIONAL, sandbox OPERATIONAL (Python now FIXED)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Python codegen (SSE) | PASS — HTTP 200, 1.24 s | real `is_prime` generated and persisted (`main.py`, 219 B) |
| 2 | **Python sandbox execution (fixed this session)** | PASS — exit 0, 67 ms | stdout `P: 2, P: 3, 5, 7, 11, 13, 17, 19` — real CPython run of model code |
| 3 | JS codegen + execution | PASS — exit 0, 72 ms | full correct fizzbuzz + `FIZZBUZZ TEST OK` |
| 4 | Debugging round-trip | PASS — exit 0, 83 ms | model diagnosed the divide-by-zero, fixed it, sandbox printed `4.0` |
| 5 | Multi-file project (cross-import) | PASS — exit 0, 59 ms | `utils.py` (32 B) + `app.py` (56 B) persisted; `add(2,3)` → `5` |
| 6 | Docs retrieval honesty | PASS | during the 429 window: `giftz.techdocs_degraded` logged, coding continued on model knowledge with **no source claimed**; retrieval succeeded after the window |
| 7 | File persistence | PASS | `CodeFile` rows verified in DB |
| 8 | Sandbox security | PASS (code + tests) | minimal env (no secrets/DATABASE_URL/cookies), 15 s timeout, path guards, 64 KB output cap, explicit-approval flag |

**Fix shipped (RULE 3):** `.py` entries were silently dispatched to the JS runtime (`bun run main.py` — broken). The sandbox runner now dispatches Python entries to the system CPython (`python3`, same restricted env/timeout), the project-run route accepts `.py` files, the UI Run button enables for Python projects, and the health probe measures **both** interpreters. Unit tests added; full regression **1198 pass / 0 fail**.

### LAXII — T2I OPERATIONAL, conversational-edit **RESOLVED → OPERATIONAL**, enhancement OPERATIONAL

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Text-to-image | PASS — 202 → completed | job `cmw81szcq003yo2zvg8zl8oj7`, 1024×1024 JPEG, 100,447 B, 80.6 s, JPEG magic verified, served authed via `/api/laxii/images/<jobId>` |
| 2 | **Conversational edit (the historical HTTP 400)** | **PASS — RESOLVED** | job `cmw81wi1x0045o2zvyfy1tbl5` completed through the real provider path; output is a **real distinct image** (1,759,413 B PNG vs 100,447 B JPEG source) |
| 3 | Deterministic enhancement | PASS — completed | job `cmw81xmxx004co2zvu6g0u659`, 1.71 MB output, engine `deterministic-sharp` |
| 4 | smart-edit / object-removal / reference-guided | HONEST not-configured | Diffusers worker absent; badge shows `not-configured`, never green |

**The 400 investigation, closed with a verdict (RULE 4):** the measured matrix (11 shapes) had rejected every `images` string/flat-array form and the SDK 0.0.18 singular-`image` body with `400 code 1210`. The **one shape that never reached a verdict** was the officially documented `images:[{url}]` form — its 2026-11-07 probe only hit the account 429 throttle. This session ran it live through the real job path and it **completed**. The evidence-driven availability gate flipped `conversational-editing → operational` automatically; the blocker constants and unit tests were re-pinned to the measured truth (a fresh failure would flip it back — the mechanism stays honest).

### JAZMII — submissions/tracking/recovery PROVEN, T2V real-completion evidence on record; today's video endpoint throttled

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | T2V submission | PASS — HTTP 202 | jobs `cmw81xzap004lo2z…`, `cmw82aay50016o21…` accepted |
| 2 | Job tracking + bounded retry | PASS | 429 → `retry_wait` with bounded backoff; **zero hammering**, breaker respected |
| 3 | Worker-restart recovery | PASS (live, unplanned) | a full dev-server restart occurred mid-window; boot recovery re-claimed the job and resumed it — then recorded an **honest `WORKER_LOST`** when the render could not continue (no fake artifact, correct failure class) |
| 4 | Real T2V completion (committed evidence, 2026-11-07) | PASS | job `cmw6mstur0008o277pbrr252m`: ffprobe **10.226 s · 1280×720 · h264 High · 317 frames**, playable MP4 (`docs/reports/ISSUES-1-2-REPAIR-REPORT.md` §3) |
| 5 | MP4 persistence | PASS | `storage/jazmii/<user>/<jobId>.mp4` files verified on disk (`ftyp isom` magic, 1.2 MB+) |
| 6 | Playback/download path | PASS (committed) | server-side download, magic-byte validation, per-user authenticated re-serving via `/api/jazmii/jobs/<id>/media` |
| 7 | **Today's clean T2V completion** | **PASS — completed** | job `cmw82aay50016o214fes70wam` rode the 429 window in bounded `retry_wait`, broke through, and **completed**: ffprobe **5.19 s · 1280×720 · h264 · 161 frames · 4,201,739 B**; authenticated playback HTTP 200 `video/mp4` in 0.67 s; cross-user playback 404 (isolation holds on media too) |

## 4. Performance measurements (today, live)

| Path | Measured |
|------|----------|
| RIISHE chat TTFT/total | 519–808 ms typical; 5.8 s one Chinese case (upstream variance) |
| RIISHE research (retrieval + synthesis) | 21.8 s incl. two official sources |
| GIFTZ chat (codegen) | 1.0–5.9 s streamed |
| GIFTZ sandbox exec (JS or Python) | 47–83 ms |
| LAXII T2I (1024×1024) | 80.6 s end-to-end (queued → artifact) |
| LAXII edit / enhance | completed within the same order (~1–2 min) |
| JAZMII T2V (5 s, speed, 720p) | minutes-class; provider-side duration dominates (historical: 10 s video ≈ 3 min) |

## 5. Commercial launch requirements — verified

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Registration / login | WORKING | live account creation + login (IP-burst limited 10/min) |
| User isolation | PROVEN | user B → user A's image: 404; A's asset: 404; A's jobs: not listed (0 rows); bad session: 401 |
| Usage accounting | EXACT | same-day live runs matched per-product counters (giftz 9 / riishe 5 / laxii images 3) |
| Generation limits | ENFORCED | daily quotas 300/40/6/150 (riishe/laxii/jazmii/giftz) checked in preflight before any submission |
| **No charge for failed generations** | PROVEN | quota counts `success: true` only — jazmii showed 0 used despite throttled jobs; failures recorded with `errorCode` for accounting, not billing |
| Job ownership | ENFORCED | owner checks on run/cancel/media endpoints |
| Secure file access | ENFORCED | auth-gated asset/image/media routes; sandbox minimal env |
| Rate limiting | ENFORCED | per-product burst windows + per-IP login limiter |
| Cost controls | PRESENT | provider request budget guard (opt-in per-product env ceilings) + breaker-fail-fast (throttled account is never hammered) |
| Payment integration | **NOT LIVE — do not advertise** | usage metering, quotas and cost guards exist; there is **no payment processor / subscription billing** wired. Subscription plans must not be sold until a processor is integrated and tested. |

## 6. Exact fixes shipped in this recovery

1. **Python sandbox execution** (`src/lib/sandbox/runner.ts`, `src/app/api/code-giftz/projects/[id]/run/route.ts`, `src/components/bean/code-giftz.tsx`): `.py` dispatch to system CPython, project-run filter, UI Run gating, dual-interpreter health probe; tests added (`tests/unit/sandbox-python.test.ts`).
2. **LAXII conversational-edit resolution** (`src/lib/registry/capabilities.ts`, `tests/unit/capability-health.test.ts`): live verdict recorded; blocker constants + tests re-pinned to measured truth; evidence-driven gate did the flip.
3. No other code changed. No provider, routing, credential, DB-schema or UI redesign changes.

## 7. Deployment requirements (as-built)

- **Runtime:** Bun + Next.js standalone (`bun run build` → `bun run start`), `DATABASE_URL` SQLite (file) — same schema via Prisma.
- **Processes:** web server + background workers (`bun run workers`) must both run; boot recovery is proven (jobs re-claimed after restart).
- **Credential:** platform gateway config at `/etc/.z-ai-config` (never read by BEAN code; SDK-managed).
- **Storage:** `storage/laxii`, `storage/jazmii` volumes for artifacts (user-scoped subdirectories).
- **Optional operator envs:** `BEAN_DAILY_REQUEST_BUDGET_*` (spend guard), `BEAN_LLAMACPP_BASE_URL` + `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` (activates the dormant local lanes when a GGUF `llama-server` is provisioned), `BEAN_SANDBOX_RUNTIME` / `BEAN_SANDBOX_PYTHON` overrides.

## 8. Remaining external blockers (honest list)

1. **Account-wide 429 windows on the single shared gateway** — today the video endpoint class was throttled for extended periods (20/24 historical failures in one window; bounded retries ride it out). Mitigations shipped (breakers, bounded backoff, success-only charging, honest badges). **Real fix requires the operator:** a higher rate tier or a second authorized provider credential (none exists in vault/env — verified).
2. **Local model lanes dormant** — no GGUF weights on disk; RIISHE/GIFTZ independence from the gateway requires operator provisioning of a `llama-server` (designed slot, zero code change).
3. **Diffusers worker (GPU) absent** — smart-edit / object-removal / reference-guided stay `not-configured`, honestly labeled.
4. **No payment processor** — commercial readiness stops at metering/quotas/cost-guards; selling subscriptions requires a real payment integration first.

## 9. Commercial launch readiness verdict

**READY FOR SOFT LAUNCH as a metered free-tier product today**, with these truths enforced by the platform itself:
- All four advertised cores work and are honestly badged: RIISHE chat (+research), CODE GIFTZ codegen/sandbox (JS **and** Python), LAXII generation/edit/enhance, JAZMII T2V/I2V (throttle-window dependent, jobs survive).
- Failures are truthful: failed generations never bill quota, badges never paint green without evidence, every job records its real error class.
- **Before charging money:** integrate + test a payment processor, and secure rate-tier relief or a second authorized provider so the 429 windows stop gating video.

---

*Evidence artifacts referenced above were produced by live, single-attempt probes against the running deployment on 2026-11-08 (HTTP status, job IDs, byte counts and latencies as recorded in the session log). No mocks, fixtures or simulated outputs were counted.*
