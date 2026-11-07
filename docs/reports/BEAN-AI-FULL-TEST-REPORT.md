# BEAN — FOUR AI PRODUCTS: FULL FUNCTIONAL TEST REPORT

**Date:** 2026-11-07 · **Repo HEAD at start:** `520853d` (main, clean tree) · **Server:** dev (`next dev`, :3000)
**Scope:** functional testing and operational recovery of RIISHE / LAXII / JAZMII / CODE GIFTZ per the test brief — no deployment, no PostgreSQL, no infrastructure work.
**Evidence:** `scripts/fulltest-out/evidence.jsonl` (69 recorded events), artifacts in `scripts/fulltest-out/`, per-product acceptance reports alongside this file.

---

## 1. FINAL RESULT MATRIX

| Product | Real test (evidence) | Generated output | Persistence | Final status |
|---|---|---|---|---|
| RIISHE | Live streaming completion, 38 SSE frames / 946 ms; context recall "GOLDEN CANYON"; reasoning answer "9"; rewrite; summary; **Tamil response** | Conversation `cmw5rqg39002ir9vimlw709vb` (10 persisted messages) | **Verified** (detail reload + codename intact) | **OPERATIONAL** (intermittent account-level 429s surface as typed, retryable errors) |
| LAXII | Real provider T2I ×3 (172 KB / 75 KB / 72 KB / 62 KB JPEGs, magic-byte verified); deterministic enhancement; brush-mask preservation edit | `laxii-t2i-cmw5rkvkm000sr9vixa4sb7w5.jpg` + enhanced + preserved outputs | **Verified** (owner-checked job detail, 2/2 jobs reload) | **OPERATIONAL for T2I + enhancement + preservation editing**; conversational editing BLOCKED (provider contract), smart-edit NOT_CONFIGURED (honest 503) |
| JAZMII | **Real T2V completed**: 1,537,913 bytes, h264 1280×720, 5.19 s (ffprobe) · **Real I2V completed from the real LAXII image**: 3,585,301 bytes, h264 768×768, 5.13 s | `jazmii-t2v-cmw5sj5r20067r9vi3o23jz3o.mp4`, `jazmii-cmw5s0xdo005ir9vijf0xtte6.mp4` | **Verified** (bytes-exact re-download, Range 206, job row stable) | **OPERATIONAL** (T2V + I2V both have real completed runs); cancel = honest stop-tracking; 429s recorded verbatim |
| CODE GIFTZ | Real streaming codegen (311 frames, 1,418 chars); debugging task; explanation + multi-file context turn; **sandbox execution exit 0 with output verified** | `isPalindrome.js` executed: `level: true`, `hello: false`, `Panama: true` · `greet.js` → `GIFTZ-SUITE-OK` (51–56 ms) | **Verified** (project + task + files reload) | **OPERATIONAL** (chat model + local sandbox both real) |

Classification discipline used throughout: **real** = a real provider round-trip produced the artifact; **deterministic** = a real local engine executed (Sharp, sandbox) — never presented as AI; **simulated** = infrastructure-only checks. Evidence tally: **29 real, 18 deterministic, 5 blocked** events.

## 2. EXECUTION ORDER AND RATE-LIMIT BEHAVIOR

Tests ran in the brief's order (RIISHE → LAXII → JAZMII → CODE GIFTZ), breaker-gated: every provider submission first waits for its endpoint-class breaker to close, then makes **one** bounded attempt — no retry storms were generated at any point. The shared account showed a bursty throttle today: calls cluster into successes, then a 429 window opens (no Retry-After, generic `Too many requests` body). Each 429 was recorded verbatim and testing moved to an independent capability per the brief. Two RIISHE items (summary, multilingual) succeeded in a later window; JAZMII's T2V succeeded on its third bounded window.

The provider **accepted** both image-class and video-class work repeatedly; the 429s observed were account-level bursts, not capability rejections (the I2V job rendered to 37 % progress through one throttle window before a second window failed it; the retry completed).

## 3. EXACT CODE FIXES (all confirmed defects found during testing)

1. **Brush-mask preservation defect (critical, LAXII)** — `src/lib/laxii/preservation.ts` `buildMask()`: sharp's raw decoder expands grayscale masks to 3 channels, and the coverage lookup treated every 3-channel pixel as **fully editable** (`ch === 3 ? 255`). A real strict-preserve edit with a brush mask therefore changed **97.51 %** of the image (exactPreserved **0 %**) instead of only the painted region. Fixed to use mask **luminance** for 3-channel masks. Re-verified end-to-end: exactPreserved **90.82 %**, blended (feather) 2.92 %, changed **7.75 %** — confined to the stroke, `generativeUsed: false`. Regression test added (`tests/unit/laxii-preservation.test.ts`, hand-built grayscale PNG fixture).
2. **Generated-image chaining defect (LAXII)** — `src/app/api/laxii/jobs/[id]/route.ts`: every completed hosted generation registers a real owned `ImageAsset` (assetUrl in resultJson), but the job detail API only ever returned `imageUrl = /api/laxii/images/<jobId>`, so the UI's "Use as source" regex (`/api/laxii/assets/<id>`) silently never matched for hosted generations. The route now prefers the stored asset URL; chaining works for every completed generation (verified: the in-app suite enhanced an image generated minutes earlier).
3. **Test-suite panel state bleed (new Rule-8 UI)** — `src/components/bean/shell.tsx`: the per-product suite panel kept the previous product's run when switching workspaces (JAZMII results showed under LAXII). Fixed with `key={view}` remounting; verified in-browser.
4. **New: per-product functional test workflow (Rule 8)** — `src/lib/diagnostics/suites.ts` + `src/app/api/diagnostics/route.ts` + `src/components/bean/product-test-suite.tsx`, mounted in the existing shell for all four products. Each suite shows test name, running state, real/deterministic/simulated classification, result, error, artifact link, timestamp; provider rows are **blocked without any network call** while their endpoint-class breaker is open. In-browser results: RIISHE 3/3, LAXII 3/3, CODE GIFTZ 3/3, JAZMII 2/4 (tracking row honestly blocked by a real 429 mid-window; deep harness separately completed both T2V and I2V).

## 4. REGRESSION BASELINE

- Brief reported "1,100 passed / 0 failed / 70 files"; the **actual measured baseline at HEAD `520853d` is 1,065 / 0 / 68** (matches the commit message). After this session: **1,073 passed / 0 failed / 69 files** (+7 diagnostics tests, +1 mask regression test). ESLint and `tsc --noEmit` clean on all touched source files.

## 5. PROVIDER LIMITATIONS AND BLOCKED CAPABILITIES

- **Account-level 429 bursts (external, ongoing):** generic throttle body, no Retry-After; breaker cools 60 s → 600 s (sliding). Chat-class probes were 429ing as late as 02:34 UTC; image/video classes recovered in bursts. No bypass was attempted; no retry storms were generated.
- **LAXII conversational editing — BLOCKED (provider contract):** the hosted edit endpoint rejects every measured request shape with `400 {"error":{"code":"1210","message":"API 调用参数有误，请检查文档。"}}` (recorded verbatim again this session at 02:09:11). Not fixable client-side; needs the provider to clarify the images.edit contract or an alternative authorized provider (user approval required for any new paid provider).
- **LAXII smart-edit / object-removal / reference-guided — NOT_CONFIGURED:** local Diffusers worker is registry-gated off (no GPU in this environment); the route refuses truthfully with 503 and the user's image is untouched. Recorded as blocked, not broken.
- **JAZMII mid-flight cancel semantics:** provider exposes no cancel API; DELETE stops tracking honestly. Observed: a cancel accepted at time T, followed by the poller recording the provider's real failure (RATE_LIMITED) — the job ends `failed`, which is truthful (the provider job did fail); documented, not masked.

## 6. USER APPROVAL REQUIRED

- **None required for anything executed in this session.** All provider calls were bounded single attempts through the existing authorized account; no new paid provider was activated; no infrastructure was purchased.
- Optional future decisions (not started): (a) approve investigating an alternative authorized image-edit provider to unblock conversational editing; (b) approve provisioning GPU for the local Diffusers worker to enable smart-edit/object-removal.

## 7. DELIVERABLES

- `docs/reports/BEAN-AI-FULL-TEST-REPORT.md` (this file)
- `docs/reports/BEAN-RIISHE-ACCEPTANCE.md`, `BEAN-LAXII-ACCEPTANCE.md`, `BEAN-JAZMII-ACCEPTANCE.md`, `BEAN-CODE-GIFTZ-ACCEPTANCE.md`
- Code: fixes above + the Rule-8 test workflow (suite endpoint, server runner, UI panel)
- Evidence: `scripts/fulltest-out/` (evidence.jsonl, 2 MP4s, 4 JPEGs, GIF/suite screenshots), unit tests, breaker-aware harness `scripts/fulltest/four-product-full-test.ts`
