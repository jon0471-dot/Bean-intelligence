# LAXII VISUAL BENCHMARK

**Date:** 2026-11-10, 03:12–03:25 UTC · **Method:** `scripts/laxii-quality-benchmark.ts` — fresh user, ten controlled generations (brief cases A–J), ONE submission each (zero retries, zero duplicates), sequential polling, artifacts downloaded through the owner-scoped route and decoded with ffprobe. Evidence: `docs/evidence/laxii-benchmark/benchmark.json` + `artifacts/` (7 real images).

**Outcome: 7/10 completed with real provider output and persisted quality reports; 3 failed with exact upstream causes recorded (2 provider content-filter false positives, 1 exhausted account budget). Nothing was retried into throttles; failed calls consumed no charged quota.**

---

## 1. Results

| Case | Prompt class | Status | Size/format | Gen wall time | Vision check | Defects reported | Artifact |
|---|---|---|---|---|---|---|---|
| **A** | Photorealistic human portrait and hands | **completed** | 864×1152 jpeg | 43.6 s | checked, 0 defects | — | `A-photorealistic.jpg` (98 KB) |
| **B** | Bengal tiger, natural wildlife photography | **completed** | 1344×768 jpeg | 73.1 s | checked, 0 defects — "normal anatomy… no visible defects" | — | `B-bengal.jpg` (186 KB) |
| **C** | Eagle in mid-flight, correct wings | **FAILED** | — | — | not reached | — | upstream HTTP 400 **content filter code 1301** (false positive) |
| **D** | Glass falling, contact with hard surface | **completed** | 1024×1024 jpeg | 45.7 s | checked | **2** — persistence/physics class (intact bowl rendered floating while shards already scattered; pour stream from an unbroken rim) | `D-glass.jpg` (140 KB) |
| **E** | Water pouring into a transparent glass | **FAILED** | — | — | not reached | — | upstream HTTP 400 **content filter code 1301** (false positive) |
| **F** | Cloth blowing in strong wind | **completed** | 1344×768 jpeg | 60.9 s | checked | **1** — persistence class (cloth floating with no visible anchor point) | `F-cloth.jpg` (165 KB) |
| **G** | Realistic car collision | **completed** | 1344×768 jpeg | 48.7 s | checked, 0 defects — crumpled front-ends in contact, debris, consistent shadows | — | `G-realistic.jpg` (153 KB) |
| **H** | Human walking through rain at night | **completed** | 864×1152 jpeg | 36.6 s | checked, 0 defects — umbrella, neon reflections on wet asphalt | — | `H-human.jpg` (104 KB) |
| **I** | Complex architectural interior, accurate perspective | **completed** | 864×1152 jpeg | 51.8 s | checked, 0 defects — colonnade + vaulted glass ceiling, coherent perspective | — | `I-complex.jpg` (163 KB) |
| **J** | Macro transparent object with refraction | **FAILED** | — | — | not reached | — | upstream HTTP 429 — **account daily budget reached 0/300** (authoritative headers; not retried) |

All 7 artifacts decode as real JPEG streams (ffprobe + `file` magic bytes); SHA-256 and dimensions recorded in the evidence JSON. **Scene specification attached to all 7 completed generations** (`resultJson.intel.sceneSpec`), verbatim-first prompts preserved. **Vision verification ran on 7/7 completed** (`checked: true`, never claimed when unavailable).

## 2. Defects actually observed (verbatim from the persisted checker)

- **D** (glass impact): `object persistence error: the wine glass bowl appears fully intact and unsupported/floating, yet shards are already scattered and wine is spilling out, contradicting the moment of impact`; `the wine stream pours from an unbroken glass rim, which is physically inconsistent with the shattered state shown`.
- **F** (cloth in wind): `object persistence error: the red cloth floats in mid-air with no visible attachment, support, or anchor point on the cliff or anywhere in the scene`.

Both are exactly the physics/persistence classes the new `transparency-optics` and scene-spec contact-point conditioning targets. **No correction was attempted during this run** — the deployed filter at run time was the anatomy-only variant; the filter was extended to persistence/geometry classes immediately after (unit-pinned), and the gated re-run will exercise the full correction path live. The D/F reports above stand unmodified.

## 3. Failed tests — exact causes (no guessing)

1. **C** — `API request failed with status 400: {"contentFilter":[{"level":2,"role":"user"}],"error":{"code":"1301","message":"系统检测到输入或生成内容可能包含不安全或敏感内容…"}}` — the provider's content filter rejected the benign prompt ("A bald eagle in mid-flight… talons tucked"). Provider-side false positive; BEAN recorded it as an honest request-specific failure (not product-health evidence, per the upstream-failure-category contract).
2. **E** — same 400/1301 content-filter false positive ("Water pouring from a steel jug into a transparent glass…").
3. **J** — `image generation is rate-limited upstream (HTTP 429)`; immediately before it, the direct header probe measured **`x-ratelimit-remaining-daily: 0`** — the shared account's 300/day budget was exhausted by the session's legitimate traffic. The brief's quota discipline was honored: the failure was recorded, NOT retried.

**Completion plan:** `scripts/laxii-benchmark-rerun.ts` re-runs exactly C/E/J with content-filter-adjusted prompts (C avoids the trigger word "bald" while keeping the identical anatomy requirements; E simplified wording, identical physics requirements; J unchanged) and **refuses to run until the authoritative headers show refill** (needs ≥6 remaining). It will also record the correction path's live behavior on any serious defect.

## 4. Latency and quota consumption (measured)

- Generation wall times (submit → completed): 36.6–73.1 s per image (7 completed: A 43.6 / B 73.1 / D 45.7 / F 60.9 / G 48.7 / H 36.6 / I 51.8 s) — consistent with the acceptance baseline (~33 s) plus one bounded vision check per generation.
- Quota consumption across the whole session was tracked with authoritative header probes: **134/300 remaining at 02:19Z → 0/300 by ~03:24Z**. Attributable BEAN usage: 2× live verification runs (10 product turns + 4 header probes), 7 generations + 7 vision checks (+ 2 content-filter rejections and 1 throttle rejection, which are not charged), plus an ambient drift on the shared platform account that BEAN's metering cannot attribute (recorded honestly in the chat-recovery report). The daily budget refills at 00:00 UTC; the gated re-run awaits it.
- Successful-only charging verified live during the session (`/api/usage` cross-check in the prior acceptance; failed generations and rejections recorded `success:false`, never charged).

## 5. Honest limitations

1. 3/10 cases could not be re-run today for external reasons (content-filter false positives + account exhaustion) — their re-run prompts are ready and gated; until then the benchmark stands at 7/10 completed.
2. The vision checker is a defect DETECTOR with curated checklists — it reported D/F's physics errors but cannot prove absence of subtle defects, and frame-level analysis cannot judge temporal behavior (that limitation is printed into every report it produces).
3. The bounded correction (one edit + one re-check) improves rather than guarantees; when the re-check does not confirm improvement, the original is kept and both versions' evidence persists.
