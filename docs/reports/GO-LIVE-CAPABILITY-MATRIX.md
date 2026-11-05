# BEAN Intelligence — GO-LIVE CAPABILITY MATRIX (2026-11-05)

Per-product × per-capability truth table at finalization. Every cell is backed by measured evidence
(probe payload, real job rows, breaker telemetry, on-disk artifacts) with its timestamp. Claim levels:
**PASS** (real live evidence), **PARTIAL** (real evidence, incomplete coverage), **BLOCKED** (a measured
external blocker stands), **FAIL** (real evidence of not working). Nothing is inferred from HTTP 200
reachability alone; the live per-capability source is `GET /api/health` → `products[*].capabilities[]`.

Overall product badges at finalization (derived, not asserted): **RIISHE Unavailable · LAXII Degraded ·
JAZMII Degraded · CODE GIFTZ Unavailable** — driven by the measured account-wide provider throttle
(chat-class 429 streak 59, 2026-11-05T01:27:41Z → 06:14:11Z, plus images/video 429s at 04:52).

---

## RIISHE — conversational intelligence (badge: Unavailable)

| Capability | Claim | Evidence (measured) |
| --- | --- | --- |
| Conversational chat (core) | **BLOCKED today** — prior live evidence preserved | Streaming multi-turn conversation with context + persistence verified in the prior delivery (two real streaming turns, refresh-recoverable, user-isolated). This session: chat-class probe 429s continuously (last success 01:27:41Z; streak 59 by 06:14:11Z; typed harness record `riishe-blocked` 05:50:45Z after the full 720 s bounded wait) |
| Current-web research | **BLOCKED today** | functions-class 429s (streak 31, last 06:14:11Z); prior live research evidence preserved |

## CODE GIFTZ — coding intelligence + W6 (badge: Unavailable)

| Capability | Claim | Evidence (measured) |
| --- | --- | --- |
| Coding chat (core) | **BLOCKED today** — prior live evidence preserved | Two real streaming coding responses verified in the prior delivery. This session: same shared-account chat-class throttle (documented harness run `auth giftz` executed — auth recorded, bounded wait expired on the open breaker; typed shared-condition record `riishe-blocked` + streak telemetry stand as the evidence) |
| Sandbox execution | **PASS** | Local sandbox runtime probe healthy (`Sandbox execution: operational` in `/api/health`, 03:38–05:38Z); real task-mode generate→run flow pinned by the harness contract |
| W6 self-verification (local) | **PASS** | Fresh artifact 2026-11-05: ground truth 4/4 executed, order-focus detection 8/8, verifier-report contract 8/8 (`w6-eval-local-1793850167660.json`) |
| W6 self-verification (live) | **BLOCKED today** | Bounded gateway wait expired with zero attempts burned (by-design contract); previous live best **66/67** stands (`W6-ACCEPTANCE-REPORT.md`); 67/67 only claimable from a completed live artifact |

## LAXII — image studio (badge: Degraded)

| Capability | Claim | Evidence (measured) |
| --- | --- | --- |
| Text-to-image (core) | **PASS (prior live evidence)** — currently throttle-affected | Two completed real 1024×1024 JPEG generations 2026-11-04T16:16/16:18 (186,940 B / 131,909 B, JPEG magic verified, artifacts on disk, owner-checked delivery). Last fresh attempt 2026-11-05T01:38:04Z failed with the account 429 (typed record); images-class breaker telemetry carried in `/api/health` |
| Deterministic enhancement | **PASS** | Local Sharp engine executed (not claimed) — probe `operational`, `statusAffecting:false` |
| Conversational editing (hosted) | **BLOCKED** | Measured: 10 request shapes rejected HTTP 400 code 1210 (2026-11-04/05, `scripts/probe-image-edit-out/`); SDK 0.0.18 verified latest-published and its canonical contract (`image` = data URL, verbatim POST to `/images/generations/edit`) measured **429×2** (03:15Z, 04:37Z) — rate-limit layer, no contract verdict possible; public docs describe no edit endpoint. `GET /api/laxii/edit` discloses `available:false` + verbatim blocker. One typed 400/1210 job failure on record (`cmw2bnsrb002mss9frrxua4eb`) |
| Reference-image edit: region-difference check | **BLOCKED** | Cannot run until the editing contract verdict exists (no provider availability this session; no guessing, no retry storms) |
| Identity preservation (consented reference) | **BLOCKED** | Same blocker; fixture `portrait-single.png` staged for the test |
| Local Diffusers worker (smart edit / object removal / reference-guided) | **NOT CONFIGURED** | Registry-gated off (no GPU worker deployed); honest `not-configured` row, no false advertising |

## JAZMII — video engine (badge: Degraded)

| Capability | Claim | Evidence (measured) |
| --- | --- | --- |
| Text-to-video (core) | **PASS (prior live evidence)** — currently throttle-affected | Real completed job `cmw2c0r0d0038ss9f4ypskxjv`: MP4 1,506,330 B, ffprobe `h264 1280x720 5.193s`, provider task id `20261105002927247ac0acb2f54f82` (success, server-side only). Re-verified THIS session: persistence on disk, refresh-restore via jobs list, exact byte match, Range delivery `HTTP 206 bytes 0-1023/1506330`, intruder **404**, no provider ids leaked. Fresh attempts during the throttle end in typed `RATE_LIMITED` failures (visible, recoverable) |
| Image-to-video | **BLOCKED** | Live attempt 2026-11-05T01:28:17Z: submission accepted (`202`, job `cmw2v9oyq000usmviqwtr6ubf`), provider call 429 → typed failure. **Never completed a real run → not advertised** (`blocked`, status-affecting). Adapter path unit-pinned; a completed run flips it operational |
| Progress / cancel / job lifecycle | **PASS** | Bounded worker polling, restart-resume via persisted task id, honest stop-tracking cancellation (provider exposes no cancel API — stated as such) |

---

## Cross-cutting controls

| Control | Claim | Evidence |
| --- | --- | --- |
| Bounded 429 backoff (60 s → 600 s cap, per class) | **PASS** | Streak telemetry: 1 real probe per cooldown window across a 4 h throttle; 832/384 fail-fast skips carried zero network cost |
| Evidence chain cannot fake availability | **PASS** | `a125aec`: failed attempts can never render `available:true` (measured bug fixed + pinned by tests) |
| Capability-level product badge | **PASS** | LAXII/JAZMII Degraded (not Operational) while an advertised capability is blocked; rendered live at 1440/768 px |
| UI model/provider opacity | **PASS** | No provider identities, task ids or endpoints in client payloads (verified by payload inspection this session) |
| No uncontrolled API cost | **PASS** | This session's upstream calls: 1 real probe per breaker window + 2 single edit probes + bounded harness attempts, all into an already-429ing gateway |

## What would change each BLOCKED cell

1. **Provider throttle clears** → run the runbook in `GO-LIVE-FINALIZATION.md` §8; RIISHE/CODE GIFTZ
   fresh live turns and W6 live become runnable immediately (the harness flips BLOCKED records into real
   evidence automatically when the breaker opens).
2. **Provider documents the edit contract** (or a canonical-shape probe passes validation) → implement the
   verified contract (one field), then the region-difference and identity-preservation tests decide
   LAXII editing's final claim.
3. **A real I2V run completes** → JAZMII image-to-video flips to operational with the artifact as proof.
