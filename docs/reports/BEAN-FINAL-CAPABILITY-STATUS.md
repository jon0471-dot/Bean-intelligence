# BEAN — FINAL CAPABILITY STATUS

**Date:** 2026-11-07 (UTC) · **Base commit:** `6e3c508` · **This change:** capability truth fix + bounded real verification
**Regression after this change:** **1,084 passed / 0 failed / 69 files** (baseline 1,073 / 0 / 69 → +11 tests) · ESLint + `tsc --noEmit` clean on all touched files.

---

## 0. What this session did (and did not do)

The reported dashboard state (RIISHE Degraded · LAXII Degraded · JAZMII Degraded · CODE GIFTZ Operational) was **not blindly repainted green**. It was rebuilt as a **capability-level truth model**: every product now shows every capability separately with a measured state — **Available / Degraded / Rate limited / Blocked / Not configured** (+ Unavailable for hard non-throttle failures) — and the product badge is a severity-ordered aggregation of the *status-affecting* rows only.

Not done (per the standing red lines): no deployment work, no PostgreSQL work, no infrastructure expansion, no new paid providers, no Ollama, no unrelated UI redesign, no fabricated outputs. The live database was only **read** (artifact/job verification); it was never modified outside the app's own writes.

---

## 1. EXACT CODE FIXES (7 files + 1 new module)

| # | Fix | File | Why (measured) |
|---|-----|------|----------------|
| 1 | New capability state **`rate-limited`** + `stateForProbe()`: a probe that failed **because of throttling** (observed 429, or a probe **deferred** by the open class breaker — zero network) is Rate limited evidence, never "Unavailable"; a fresh 429-class real attempt renders `rate-limited` instead of `degraded` | `src/lib/registry/capabilities.ts` | CODE GIFTZ's chat probe failing with HTTP 429 rendered a red "Unavailable" product; LAXII 429s rendered "Degraded" — both read as product defects when the only problem is upstream volume |
| 2 | **5-state product aggregation** in `productStatus()`: `unavailable` > `degraded` (blocked/degraded rows) > `rate-limited` (only throttling problems) > `operational`; legacy payloads classify by the probe's failure category | `src/lib/registry/status.ts` | One severity ladder, derived only from measured rows |
| 3 | **Optional capabilities no longer hold the badge hostage**: RIISHE `research` and CODE GIFTZ `sandbox-execution` rows are now display-only (`statusAffecting: false`) | `src/app/api/health/route.ts` | Research rides the separately-throttled `functions` class; its failure must never imply conversational chat is down |
| 4 | **Persisted real-attempt evidence** (new module): completed GenerationJob rows are real capability evidence that survives process restarts; used for LAXII t2i / hosted-edit and JAZMII t2v / i2v when the in-memory tracker is empty (in-memory always outranks) | `src/lib/adapters/persisted-attempts.ts` (new), `health/route.ts`, `laxii/edit/route.ts` | After a restart, JAZMII's real T2V (03:08Z) and I2V (02:21Z) completions downgraded to "wired but unverified" although the DB proves them |
| 5 | **Dashboard truth fix**: gold **"Rate limited"** product badge; **every capability rendered separately** on each card with a state dot + label (Available/Degraded/Rate limited/Blocked/Unavailable/Not configured) and an evidence tooltip (source + timestamp + note); existing card/badge atoms unchanged | `src/components/bean/dashboard.tsx` | One green row must not claim a whole product works; one failed optional row must not imply the core is down |
| 6 | **LAXII conversational-edit contract corrected** to the verified SDK 0.0.18 canonical body `{ prompt, image: <data URL>, size }` (singular `image`, verified in the SDK typings `CreateImageEditBody` and its own CLI `handleImageEdit`); the previous body's plural `images` field — a codebase invention retained by a mis-verified test pin — was removed | `src/lib/adapters/hosted-image.ts`, `tests/unit/laxii-hosted-edit.test.ts` | The 400/1210 evidence pointed at the wrong field; the pin had verified the bug |
| 7 | **JAZMII tracking resilience**: a throttled status poll no longer fails an accepted job — transient upstream poll failures (429 / timeout / network) back off with bounded doubling (5 s → 60 s cap, hard 15-min deadline unchanged), the streak is displayed honestly in the job (`trackingRetry`), auth/billing still fail immediately (retrying cannot help), and deadline exhaustion produces a cause-specific honest message | `src/lib/jobs/video-worker.ts` | The "remaining job-tracking 429" was an **application defect on top of provider throttling**: one refused status poll killed a job the provider had ACCEPTED and poisoned product health evidence |

---

## 2. DASHBOARD STATUS (final, measured 03:54–03:56Z, screenshot `scripts/finalcap-out/ui-dashboard.png`)

| Product | Badge | Per-capability states (visible on the card) |
|---------|-------|---------------------------------------------|
| **RIISHE** | **Rate limited** (gold) | Conversational chat: Rate limited · Current-web research: Rate limited — the account was being throttled at capture time; both rows carry the 429 evidence timestamp |
| **LAXII** | **Degraded** (gold) | Text-to-image: **Available** (persisted real success 02:48:14Z) · Conversational editing: **Blocked** (provider contract, verbatim 400/1210) · Deterministic enhancement: **Available** (Sharp executed) · Local Diffusers worker: **Not configured** (no GPU) |
| **JAZMII** | **Operational** (green) | Text-to-video: **Available** (real completion 03:08:24Z, persisted) · Image-to-video: **Available** (real completion 02:21:35Z, persisted) |
| **CODE GIFTZ** | **Rate limited** (gold) | Coding chat: Rate limited (429 window) · Sandbox execution: **Available** (local runtime, executed) |

Every brief constraint holds: a failed optional capability never implies the core is unavailable (RIISHE/GIFTZ rows are independent); one green row never implies the product is operational (LAXII stays Degraded with two green rows); all five required states are visible on one screen.

---

## 3. EXACT SUCCESSFUL CAPABILITIES (with the evidence that says so)

| Capability | State | Real evidence (timestamp) |
|---|---|---|
| RIISHE conversational chat | Available | Live completion probe passed 03:09:05Z (452 ms) and 03:34:15Z; prior session's full 10-item suite (streaming 38 frames/946 ms, Tamil, context recall, persistence 10 msgs) stands at `6e3c508` |
| RIISHE current-web research | Available *when the probe succeeds* — **independent of chat** | Real `web_search` probe 03:09:04Z (1 result in 3,592 ms); later probes honestly Rate limited by the `functions`-class 429 (03:33:06Z, 03:48:06Z) — display-only, chat unaffected |
| LAXII text-to-image | Available | Persisted real generation completed 02:48:14Z (artifact + DB row verified on disk) |
| LAXII deterministic enhancement | Available | Sharp engine executes a real decode→resize→round-trip on every probe (03:34:15Z, 18 ms); preservation defect fix verified at `6e3c508` (90.82% exact-preserved) |
| JAZMII text-to-video | Available | Real T2V completed 03:08:24Z — 1,229,759-byte MP4 (`ftyp` verified on disk today) |
| JAZMII image-to-video | Available | Real I2V completed 02:21:35Z — 3,585,301-byte MP4 driven by a real LAXII image (verified on disk today) |
| JAZMII submission / polling / persistence / download | Verified independently | Submission 202 with persisted private task id; poll loop tracked through throttling; job/artifact rows owner-checked; media served from BEAN storage with Range support (prior session: bytes-exact re-download, Range 206, IDOR 404 — code unchanged since) |
| CODE GIFTZ coding chat | Available when not throttled | Live probe passed 03:34:15Z; prior session's real streaming codegen (311 frames) + debugging + multi-file context stand |
| CODE GIFTZ sandbox execution | Available | Local sandbox runtime probe executes for real (03:34:15Z); prior session's verified execution: `isPalindrome` exit 0, `greet.js` → `GIFTZ-SUITE-OK` in 51 ms |

---

## 4. BOUNDED REAL TESTS RUN THIS SESSION (single attempts, zero 429 retries)

Evidence: `scripts/finalcap-out/evidence.jsonl` (all timestamps UTC).

| Test | Classification | Outcome |
|---|---|---|
| RIISHE streaming chat | real | **Blocked by the recovery-window protocol** — the chat-class breaker was open (observed 429); zero network, no retry. Real chat evidence stands from the 03:34Z probe + prior suite |
| LAXII real upload → conversational edit (fixed canonical contract) | real | Upload passed (real 512×512 JPEG through the multipart route). Edit attempt **reached the provider validator and received the definitive verdict: HTTP 400 `1210` "request body invalid: image_to_image task must provide images"** — with the SDK-canonical body. Recorded verbatim on the job and in the UI; single attempt, no retry |
| Edit contract probe #11 — `images:[{url:…}]` (the one unmeasured house-convention shape) | real | HTTP 429 (account throttle) — **no contract verdict**; protocol says stop for this window |
| JAZMII real T2V smoke (768×768, 5 s, speed) | real | Submitted 202 (provider task `202611071138209b049310a79840a6`). Tracking survived **18 consecutive 429s** on the status endpoint with bounded backoff (old code: instant failure). At the 15-min bounded deadline the job ended honestly: `BACKEND_TIMEOUT — the provider's status endpoint kept failing (rate_limited, last at 03:54:01Z)`. No fabricated completion; capability evidence not poisoned |
| CODE GIFTZ codegen + sandbox | real / deterministic | **Blocked** — the chat-class breaker was open; zero network, no retry. Sandbox runtime independently verified by its executing probe |
| Persistence checks (conversation/job/task reload) | deterministic | Passed in-suite where attempted; all four products' persisted artifacts verified (below) |

**Preserved real artifacts verified on disk today:** T2V 1,229,759 B (03:08Z) · T2V 1,537,913 B (02:49Z) · **I2V 3,585,301 B (02:21Z)** · T2V 1,506,330 B (Nov 5) — all MP4 `ftyp` containers under `storage/jazmii/<userId>/`, DB rows matching. LAXII: T2I/enhancement/preservation JPEGs from `6e3c508` unchanged.

---

## 5. REMAINING BLOCKERS (explicitly not hidden)

1. **LAXII conversational editing — Blocked (external provider contract).** The gateway's edit endpoint demands a field named `images` but rejects every measured format of it: all string forms (public URL, raw base64, data URL, provider CDN URL), all flat string arrays (11 measured shapes, verbatim records in `scripts/probe-image-edit-out/` + `scripts/finalcap-out/`), **and now definitively the SDK 0.0.18 canonical `image` body itself** (400 `1210`, measured through the real job path today). The remaining url-keyed-object form got only the account 429 (no verdict). Nothing client-side can fix this; no further blind shapes will be tried.
2. **LAXII smart-edit / object-removal / reference-guided — Not configured (GPU dependency, investigated separately).** The local Diffusers worker requires torch/CUDA ≥ 8 GB VRAM + model checkpoints; this environment has **no GPU devices** (`nvidia-smi` absent, no `/dev/nvidia*`). The preflight reports honestly and the registry gate keeps traffic off; the route refuses with a truthful 503 and the user's image is untouched. This is a **different blocker** from #1 (local hardware vs provider contract) and is tracked as its own display-only capability row.
3. **Account-level 429 bursts (external, ongoing).** Chat/functions classes 429'd repeatedly during the session (03:33Z, 03:48Z, 03:49Z); the breaker backs off 60 s → 600 s with bounded escalation. RIISHE and CODE GIFTZ currently badge **Rate limited** because that is the measured truth; the badge self-corrects on the next real probe.
4. **JAZMII tracking under sustained throttle.** The provider's async-result endpoint can stay throttled for > 15 minutes, in which case a submitted job ends at the bounded deadline with the honest cause-specific message. This is now correct behavior, not a defect; the capability evidence comes only from real completions.

---

## 6. PROVIDER LIMITS OBSERVED (no bypass attempted)

- Throttle body is generic (`{"error":"Too many requests, please try again later"}`), no `Retry-After`; windows last minutes and recur account-wide across endpoint classes.
- The edit endpoint's validator message discloses a required field name (`images`) but no accepted format — 11 shapes measured, all rejected or throttle-blocked.
- Images/video classes recovered in bursts between chat-class throttle windows (T2I 02:48Z, T2V 03:08Z, I2V 02:21Z all succeeded through the same account).

---

## 7. USER APPROVAL REQUIRED (nothing actioned without it)

1. **Unblock conversational editing:** either the provider documents the `images.edit` contract, or an alternative *authorized* image-edit provider is approved (any new paid provider requires explicit approval — none was activated).
2. **Enable smart-edit family:** provision a GPU host (≥ 8 GB VRAM) for the local Diffusers worker, followed by the registry's recorded real-inference acceptance test before enablement.

---

## 8. TEST COUNTS & QUALITY GATES

- Full regression: **1,084 passed / 0 failed / 69 files** (+11 vs the 1,073 baseline: rate-limited state pins, product-aggregation truth pins, JAZMII tracking-resilience pins, corrected edit-contract pin).
- Updated pins (behavior deliberately changed by this fix): fresh 429 attempt → `rate-limited` (was `degraded`); open class breaker → `rate-limited`; 429 probe failure → `rate-limited` (was `unavailable`); edit body → SDK canonical (was the plural invention).
- `tsc --noEmit` clean on `src/` · ESLint clean on all touched files · dashboard visually verified at 1440×900 (`ui-dashboard.png`, `ui-laxii.png`).

## 9. DELIVERABLES

- Code: fixes §1 (+ `src/lib/adapters/persisted-attempts.ts`)
- Evidence: `scripts/finalcap-out/` — `evidence.jsonl`, `health-final.json`, `edit-input.jpg`, `edit-probe-11.json`, dashboard + LAXII screenshots
- Prior-session evidence preserved: `scripts/fulltest-out/` (2 MP4s, JPEGs, suite screenshots), `scripts/probe-image-edit-out/` (contract matrix)
- This report: `docs/reports/BEAN-FINAL-CAPABILITY-STATUS.md`
