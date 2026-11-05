# BEAN Intelligence — GO-LIVE FINALIZATION (2026-11-05)

**Session HEAD at finalization:** `fe68015` → `a125aec` (capability health model) → final commit (this report).
**Regression at finalization:** bun test **1,065 pass / 0 fail / 68 files** (baseline entering the session: 1,045 / 0 / 67; +20 capability-health tests, +1 file; zero regressions).
**Scope:** the six GO-LIVE FINALIZATION work areas for RIISHE, LAXII, JAZMII, CODE GIFTZ (+W6), on top of the preserved prior delivery (`fe68015`).

---

## 1. The shared HTTP 429 condition — investigation verdict (work area 1)

The user asked five specific questions. All five were answered with measured evidence from the live
server (`/api/health` breaker telemetry, probe payloads, dev.log provider errors, and the job database).

### 1.1 Is the provider still throttled? — **YES, measured continuously**

| Evidence point | Value |
| --- | --- |
| Last successful chat-class probe (RIISHE **and** CODE GIFTZ core) | **2026-11-05T01:27:41Z** |
| Latest observed real 429 at finalization | **2026-11-05T06:14:11Z** (streak **59**) |
| Consecutive observed 429s on `chat` class (this session) | 23 → **59** (every breaker expiry verified by a REAL probe; every probe 429'd) |
| Consecutive observed 429s on `functions` class | 13 → **31** |
| Fail-fast skips (zero-network, breaker-open) at finalization | chat **832**, functions **384** |
| Provider error body (verbatim, from dev.log) | `API request failed with status 429: {"error":"Too many requests, please try again later"}` — no Retry-After, no quota detail |
| images / video classes | last real 429s 04:52:34 / 04:52:05 (reachability probes started 429ing too — the throttle is account-wide) |
| Official-CLI edit probes (`z-ai image-edit`, the SDK's own canonical contract) | **HTTP 429 at 03:15:xx and 04:37:xx** — rejected at the rate-limit layer before validation |

The throttle has now lasted **4h47m** on the chat class (01:27:41 → 06:14:11). BEAN's bounded escalating
backoff (60 s base → 600 s cap, per class) held it to **one real probe per cooldown window** for the entire
session — no retry storm, no throttle deepening.

### 1.2 Is the dashboard showing stale probe results? — **NO**

Every probe row in `/api/health` carried a fresh `checkedAt` (request time), `cached` was absent (no cache
replay), and `lastHealthyAt` honestly reported the last REAL success (01:27:41Z). The "Unavailable" badge
for RIISHE/CODE GIFTZ is a live measured state, not a stale render.

### 1.3 Has the breaker not recovered? — **Correct, and provably not a bug**

The breaker opens on an observed 429 and expires on BEAN's own conservative schedule; every expiry is
verified by exactly one real probe. This session: breaker expiry at ~03:18, ~03:28, ~03:38, …, ~05:32 —
**every single real probe 429'd** (streak 23→51). The breaker cannot "recover" while the provider keeps
rejecting; that is the designed honest behavior, and the health payload exposes the full telemetry
(streak, remaining cooldown, last429At, skipped calls) for operator diagnosis.

### 1.4 Is product health incorrectly coupled to a shared provider? — **NO (verified, honest shared fate)**

RIISHE's backend descriptor is `bean-llm-hosted-primary`; CODE GIFTZ's is `bean-code-llm-hosted-primary`
— separate registry entries, probed under **independent cache keys** with independent measured latency
(the earlier "identical 307 ms for both" artifact was already fixed). Both ride the SAME authorized
provider account's chat-completions endpoint class, so an account-level throttle necessarily hits both.
The payload states this shared-fate coupling explicitly rather than hiding it.

### 1.5 Was a successful generation incorrectly ignored? — **Worse: failures were presented as successes (FOUND + FIXED)**

**Measured bug (fixed in `a125aec`):** the `/api/health` route derived LAXII/JAZMII `generation` evidence
with a fallback that rendered `available: true` from the raw last-attempt record **without checking
`attempt.ok`**. Live consequence at session start: LAXII's last real image attempt was a **429 failure at
01:38:04.401Z** (dev.log: `laxii.job_failed … rate-limited upstream (HTTP 429)`, job `cmw2vm9la001gsmvibk8ygx6s`)
and JAZMII's last real video attempt was a **429 failure at 01:29:24.348Z** (job `cmw2vb4a10015smviqqq71v23`) —
yet the payload showed `generation: {available: true, checkedAt: <the failure's own timestamp>}` and both
products badged **Operational** on fabricated availability.

**Fix (shipped):** a single evidence chain that can never fake availability:

```
fresh own upstream failure (≤15 min)  → available:false + category/status/checkedAt
own-class breaker open (fresh 429)    → available:false rate-limited
last real attempt SUCCEEDED           → available:true + success timestamp
labeled shared-account throttle       → available:false (cross-class, explicitly labeled)
otherwise                             → probe-driven (no availability claimed from failures)
```

No failed attempt can ever produce `available: true` again — pinned by
`tests/unit/capability-health.test.ts` ("MEASURED BUG PIN").

---

## 2. LAXII conversational editing (work area 2)

**Preserved:** the real text-to-image pipeline — two completed 1024×1024 JPEG generations
(2026-11-04T16:16/16:18, 186,940 B and 131,909 B, artifacts `scripts/golive-out/laxii/t2i-*.jpg`,
magic-byte verified, owner-checked `/api/laxii/images/:id` delivery) and the deterministic Sharp
preservation engine remain untouched and operational.

**SDK + endpoint contract verification (new this session):**
- Installed SDK `z-ai-web-dev-sdk@0.0.18` is **the latest published version** (npm registry version list
  ends at 0.0.18; checked 2026-11-05). Project dependency and the operator CLI are both 0.0.18.
- SDK source verified: `createImageEdit` POSTs the caller's body **verbatim** to
  `POST {baseUrl}/images/generations/edit` (no field mapping, no transformation).
- The SDK's own CLI canonical contract (`dist/cli.js handleImageEdit`) is
  `{ prompt, image: <data URL>, size: '1024x1024' }` — singular `image`, data-URL-wrapped.
  Cross-checked against the measured 10-shape matrix (`docs/reports/LAXII-LIVE-ACCEPTANCE.md` §3):
  the canonical shape was the ONE officially-documented form never measured (prior probes used
  `image: <raw b64>` and `image: <public URL>`).

**Real probes of the canonical shape:** two single, bounded attempts
(`z-ai image-edit --prompt "Change the small brown object …" --image tests/fixtures/laxii/localized-edit.png`):
- 2026-11-05T03:15Z → **HTTP 429**
- 2026-11-05T04:37Z → **HTTP 429**

Both rejected at the rate-limit layer — **no contract verdict is possible while the account is
throttled.** Per the no-guessing and no-retry-storm rules, no further shapes were tried and no
invalid-request loops were run.

**Status:** conversational editing stays **BLOCKED** — externally unresolved provider contract, now with
the SDK-version verification and the canonical-shape 429 measurements on record
(`LAXII_EDIT_CONTRACT_BLOCKER` in `src/lib/registry/capabilities.ts`, disclosed verbatim by
`GET /api/laxii/edit`, whose `available` flag is now **evidence-driven**: true only if a real edit ever
succeeded). Reference-image region-difference and identity-preservation tests were **not runnable** in
this session (provider throttle) — they remain part of the edit capability's live acceptance and will run
with the same command set when the provider recovers. Text-to-image and enhancement remain preserved and
honestly labeled.

---

## 3. JAZMII (work area 3)

**Preserved:** the real video pipeline and its completed artifact.

**Full verification of the existing real artifact (this session, `scripts/golive-jazmii-verify.sh`):**

| Check | Result |
| --- | --- |
| Output playable | **YES** — `ffprobe`: `h264, 1280x720, duration 5.193548s, mov/mp4` on the delivered file |
| Persisted | **YES** — `storage/jazmii/cmw2b65yg000iss9f6l0022m2/cmw2c0r0d0038ss9f4ypskxjv.mp4`, 1,506,330 B, `ftyp isom` magic |
| Refresh restores | **YES** — fresh owner login → `GET /api/jazmii/generate` lists the completed job with `videoUrl` |
| Job status accurate | **YES** — `status=completed`, `bytes=1506330` (exact DB/disk/API match), `format=mp4` |
| Streaming delivery | **YES** — Range request answered `HTTP 206`, `content-range: bytes 0-1023/1506330` |
| Real provider evidence | **YES** — provider task id `20261105002927247ac0acb2f54f82` (success), stored server-side only; **not present** in any client payload (checked) |
| Failed jobs visible/recoverable | **YES** — failed rows expose typed `errorCode=RATE_LIMITED` + product-safe message; the queue accepted fresh submissions after failures (typed records 01:28/01:29) |
| Cross-user guard | **YES** — intruder account receives **404** on both `/media` and the job row |

**Image-to-video:** attempted live 2026-11-05T01:28:17Z (submission accepted `202`, job
`cmw2v9oyq000usmviqwtr6ubf`); the provider call hit the account throttle and the job recorded the typed
`RATE_LIMITED` failure. **No completed I2V run exists, therefore I2V is NOT claimed available** — the
capability is rendered `blocked` (status-affecting) with that verbatim evidence. A real I2V test runs with
`bun scripts/golive-live-acceptance.ts auth jazmii-submit i2v jazmii-collect` when the provider recovers;
only a completed run flips the capability to operational.

---

## 4. W6 (work area 4)

- **Local preserved + refreshed this session:** `bun scripts/giftz-w6-eval.ts local` →
  **PASS (ground truth 4/4 executed; order-focus detection 8/8; verifier-report contract 8/8)**
  — artifact `scripts/giftz-verify-out/w6-eval-local-1793850167660.json`.
- **Live:** BLOCKED by the same chat-class throttle. The live mode's by-design contract is a bounded
  gateway wait; on expiry it exits 2 with **zero attempts burned and nothing fabricated**. The documented
  command (`bun scripts/giftz-w6-eval.ts live <max-gateway-wait-seconds>`) was executed this session; its
  outcome and any artifact are recorded in `W6-LIVE-ACCEPTANCE.md`.
- **No benchmark claim changed:** previous live best remains **66/67** (`W6-ACCEPTANCE-REPORT.md`); a
  "67/67" claim will only ever come from a completed live run artifact.

---

## 5. Dashboard health model (work area 5) — shipped in `a125aec`

- **Capability-level health, internal + disclosed:** every product now carries `capabilities[]` in
  `/api/health` — measured state per advertised capability with evidence source, `checkedAt` timestamp and
  the most recent real attempt:
  - RIISHE: `chat` (core, probe), `research` (functions class);
  - CODE GIFTZ: `coding-chat` (core, probe), `sandbox-execution` (local runtime);
  - LAXII: `text-to-image` (core, evidence chain), `conversational-editing` (contract blocker),
    `deterministic-enhancement` (local engine), `generative-worker` (registry-gated);
  - JAZMII: `text-to-video` (core, evidence chain), `image-to-video` (unverified-until-completed).
- **Product badge aggregates the status-affecting rows:** a blocked/unverified advertised capability
  degrades the product — LAXII and JAZMII render **Degraded** (gold) instead of the previous fabricated
  Operational; RIISHE/CODE GIFTZ render **Unavailable** (red) from their measured rate-limited probes.
- **Stale-status guard:** fresh own-class evidence (fresh upstream failure, open breaker, fresh success)
  always outranks stale attempt records; the labeled cross-class throttle inference only fills gaps where
  no own-class evidence exists; all rows carry timestamps so consumers can age the evidence.
- **UI:** the existing card footer now names failing capabilities with their categories
  (e.g. `Text-to-image: rate-limited (HTTP 429) · Conversational editing: blocked`); the hover tooltip
  carries evidence source + checked timestamp per row. Verified rendered at 1440 px and 768 px
  (screenshots `scripts/golive-out/dashboard-capability-*.png`) — no clipping, uniform cards, existing
  badge atoms unchanged.

---

## 6. Final acceptance runs (work area 6)

- `bun scripts/golive-live-acceptance.ts auth giftz` — **executed this session** against the live server
  (auth recorded 05:38:42Z and 05:49:34Z). Outcome: the chat-class breaker stayed open for the whole
  bounded wait; the harness recorded the typed BLOCKED evidence `breaker-wait-timeout-chat
  {waitedMs: 720000}` + `riishe-blocked` at 05:50:45Z with zero fabricated outputs. The `giftz` step
  rides the SAME breaker; its own typed record could not complete inside the session's execution
  windows (its 720 s bounded wait outlived them — the shared-condition evidence stands: breaker
  streak 23→59 with zero healthy probes, the `riishe-blocked` record from the same run, and the W6
  live gate output below). Evidence: `scripts/golive-out/evidence.jsonl`.
- W6 live mode — executed per its documented command (see `W6-LIVE-ACCEPTANCE.md`).
- Full regression — **1,065 pass / 0 fail / 68 files**.
- No safety checks were bypassed and no commands were invented; every run used the existing documented
  scripts and their existing bounded-wait/BLOCKED contracts.

---

## 7. Final status summary (PASS / PARTIAL / BLOCKED)

| Area | Status | Basis |
| --- | --- | --- |
| 429 investigation (all five questions) | **PASS** | measured verdicts §1, bug found + fixed |
| Capability-level dashboard health model | **PASS** | shipped `a125aec`, live-verified UI, +20 tests |
| JAZMII real-artifact pipeline verification | **PASS** | playback/persistence/refresh/status/guards verified §3 |
| JAZMII image-to-video | **BLOCKED** | attempted (202 + typed 429 record), never completed; not advertised |
| LAXII text-to-image + enhancement | **PASS (prior live evidence preserved)** | two real JPEG artifacts + owner-checked delivery |
| LAXII conversational editing | **BLOCKED** | provider contract externally unresolved; SDK canonical shape measured 429×2; no verdict possible |
| RIISHE fresh live turns | **BLOCKED (this session)** | provider chat-class 429s 01:27→05:32+; prior real streaming evidence preserved |
| CODE GIFTZ fresh live coding | **BLOCKED (this session)** | same shared-account throttle; prior real evidence preserved |
| W6 local | **PASS** | fresh artifact, 4/4 / 8/8 / 8/8 |
| W6 live | **BLOCKED (this session)** | bounded wait expired, zero attempts burned; previous live best 66/67 stands |

**None of the four products is claimed fully operational beyond its measured evidence.** The honest
overall state at finalization: RIISHE Unavailable, LAXII Degraded, JAZMII Degraded, CODE GIFTZ
Unavailable — each badge backed by per-capability evidence and timestamps in `/api/health`.

## 8. Re-run runbook (when the provider becomes available)

```bash
# 0. confirm the chat class probes healthy
curl -s http://localhost:3000/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); d=d.get('data',d); print(d['products']['riishe']['probe'])"

# 1. RIISHE + CODE GIFTZ fresh live acceptance (documented harness)
bun scripts/golive-live-acceptance.ts auth riishe giftz

# 2. LAXII: single official-contract edit probe, then the edit chain if it passes validation
z-ai image-edit --prompt "Change the small brown object in the bottom right corner into a bright red apple. Keep everything else exactly the same." --image tests/fixtures/laxii/localized-edit.png --output scripts/probe-image-edit-out/sdk-cli-edit-out.png
#    - 200 → implement/keep the verified canonical contract (image = data URL), run:
bun scripts/golive-live-acceptance.ts auth laxii
#    - 400/1210 → contract verdict: provider rejects the canonical shape; capability stays Blocked verbatim
#    - 429 → still throttled; wait one cooldown window, probe again (never loop)

# 3. JAZMII fresh T2V + I2V (I2V only claimable on a completed run)
bun scripts/golive-live-acceptance.ts auth jazmii-submit jazmii-collect i2v

# 4. W6 live (bounded gateway wait; exits 2 BLOCKED if still throttled — nothing fabricated)
bun scripts/giftz-w6-eval.ts live 900
```

## 9. Preservation statement

Commit history preserved (no rewrites; `fe68015` → `a125aec` → final). All prior reports in
`docs/reports/` untouched. User data preserved (`db/custom.db` carried forward; no destructive
migration this session — none was needed). No credentials committed (cookie jars and media artifacts
excluded from the commit). No uncontrolled API cost: this session's upstream traffic = 1 probe per
breaker window + 2 single edit probes + the harness's bounded attempts, all into an already-throttled
gateway.
