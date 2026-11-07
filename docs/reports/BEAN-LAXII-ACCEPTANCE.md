# BEAN — LAXII ACCEPTANCE (FULL FUNCTIONAL TEST)

**Date:** 2026-11-07 · **Users:** `fulltest-20261107020818@bean-e2e.test` (deep harness) + browser suite runs · **Evidence:** `scripts/fulltest-out/evidence.jsonl` (`laxii-*`, `preserve-fix-*`), artifacts `scripts/fulltest-out/laxii-*.jpg`, screenshots `ui-laxii-suite*.png`

| # | Item | Result | Classification |
|---|---|---|---|
| 1 | Text-to-image generation | **REAL provider image**: job `cmw5rkvkm000sr9vixa4sb7w5`, 1024×1024 JPEG, 172,553 bytes, magic-byte verified (`laxii-t2i-…jpg`). Three more real generations later in the session (75 KB / 72 KB / 62 KB — the last via the in-product suite) | REAL |
| 2 | Image upload | Generated image re-uploaded as an owned `original` asset: 201, geometry measured server-side (1024×1024) | DETERMINISTIC |
| 3 | Image enhancement | Local preservation engine (Sharp) executed: 1,528,262-byte output, `generativeUsed: false` | DETERMINISTIC |
| 4 | Preservation-first editing (brush mask) | **First run EXPOSED A REAL DEFECT** (see below). After the fix: strict-preserve with the same real brush mask → **exactPreserved 90.82 %, blended 2.92 %, changed 7.75 %**, change confined to the painted stroke, `generativeUsed: false` | DETERMINISTIC (explicitly NOT AI) |
| 5 | Brush-mask AI editing (smart-edit) | Honest refusal: **503 PROVIDER_UNAVAILABLE** — the local Diffusers worker is registry-gated off (no GPU); the user's image is untouched, nothing fake is queued | BLOCKED (not-configured) |
| 6 | Conversational editing | Real hosted attempt: submission accepted, job failed with the provider's verbatim error `400 {"error":{"code":"1210","message":"API 调用参数有误，请检查文档。"}}` — the externally-unresolved images.edit contract | BLOCKED (provider contract) |
| 7 | Generated image preview | Media GET 200, JPEG magic verified | DETERMINISTIC |
| 8 | Download / export | Bytes-exact download (172,553 = job bytes) | DETERMINISTIC |
| 9 | Artifact persistence | Owner-checked job detail reloads: 2/2 jobs intact after refresh; assets reloadable | DETERMINISTIC |

## The preservation defect (Rule 4 in action)

The brief warned: *"Do not claim that preservation editing works merely because a deterministic image-processing pipeline passes."* The first strict-preserve run **completed** with a plausible-looking 1.5 MB output — but its preservation report read `exactPreservedPct: 0, editablePct: 100, changedPct: 97.51 %`: the brush mask had been **ignored**.

Root cause (`src/lib/laxii/preservation.ts` `buildMask`): sharp's raw decoder expands grayscale masks to 3 channels, and the coverage lookup answered `ch === 3 → 255` ("RGB has no alpha = fully opaque"). Any grayscale/RGB mask therefore marked **every pixel editable**. (The in-UI canvas masks are RGBA and hit the alpha-byte branch — which is why the defect never surfaced there.)

Fix: 3-channel masks now use **luminance** as coverage. Verified twice:
- unit: hand-built grayscale PNG (color type 0) → alpha 1 inside the painted rect, 0 outside (`tests/unit/laxii-preservation.test.ts`);
- end-to-end through the live API with the original real mask asset: **90.82 % bit-exact preserved / 7.75 % changed** (the stroke area ≈ 7.8 %), feather band 2.92 %, no generative model involved.

## Health-probe timeout question (from the brief)

Today's evidence shows the probe is **not** misconfigured: LAXII's health probe measured 29–43 ms (gateway reachability + client config; the payload explicitly states it does not run a generation). The earlier 5,002 ms timeout episode did not reproduce; no timeout was changed, and the probe/generation-timeout separation the brief asked to protect is intact (generation jobs carry their own bounded waits, e.g. the 240 s poll in the harness).

## In-product test workflow (Rule 8)

LAXII workspace → "LAXII test suite" card: text-to-image (REAL), deterministic enhancement chained from the generated image (DETERMINISTIC), job/asset persistence (DETERMINISTIC). In-browser run: **3/3 passed** (`ui-laxii-suite-final3.png`).

## Verdict

**OPERATIONAL for text-to-image, enhancement and preservation-first brush-mask editing** (all real, preservation now proven by measurement). **Conversational editing is BLOCKED by the provider's 400/1210 contract** — externally unresolved; fixing it requires provider clarification or an alternative authorized provider (user approval required for any new paid provider). **Smart-edit/object-removal remain NOT_CONFIGURED** (GPU-less environment; honest 503).
