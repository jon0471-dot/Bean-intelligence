# BEAN Client-First Hybrid Compute Engine — Implementation Report

Milestone: BEAN client-first hybrid compute · Companion docs:
`docs/BEAN-CLIENT-COMPUTE-AUDIT.md`, `docs/BEAN-CLIENT-COMPUTE-ARCHITECTURE.md`,
`docs/BEAN-CLIENT-COMPUTE-SECURITY.md`.

Evidence labels: `LIVE_VERIFIED` (measured in a real browser / real server this
session), `OFFLINE_VERIFIED` (measured by the unit suite), `NOT_TESTED`
(genuinely not measurable in this environment — stated, never claimed), `FAILED`
(attempted and failed), `BLOCKED` (blocked by a hard environment constraint).

---

## 1. Git state and baseline

| Item | Result |
|---|---|
| Repository / branch | `jon0471-dot/Bean-intelligence` · `main` |
| Required starting state | `origin/main == 49b04055f2c41fff0b5160afcd7d4e3059f51afd` |
| Measured before work | local HEAD == `origin/main == 49b0405…` (`git ls-remote`), working tree clean — MATCH |
| Baseline gates (pre-existing) | 1885 pass / 0 fail / 133 files; tsc 0 errors in `src/`+`tests/` (138 pre-existing in `scripts/` + `validation/` fixtures); eslint clean in `src/`+`tests/` |
| Post-work gates | **1971 pass / 0 fail / 141 files** (+86 tests, 8 files, zero regressions); tsc 0 in `src/`+`tests/`; eslint clean in `src/`+`tests/`; production build PASS (standalone artifacts verified) |
| Schema change | additive `ClientComputeReport` table; `prisma migrate diff` reviewed before `db push`; pre-migration backup `backup/db-clientcompute-pre-20261116.db` (integrity ok); post-push row counts unchanged |

Session-start hygiene: the previous milestone's unpushed WIP commit was found on local
`main` (platform auto-commit `ee65874`, M25 refactoring work with 5 FAILED acceptance
steps and no report — genuinely incomplete). Per the documented HANDOFF §0.1 procedure
it was preserved on local branch `backup/m25-wip-auto-commit` (never pushed, never
discarded) and `main` was reset to the verified remote baseline before this task
started. Its state is disclosed in Section 11 of this report.

## 2. What was delivered

- **Phase 0 audit** — `docs/BEAN-CLIENT-COMPUTE-AUDIT.md` (four parallel read-only
  code audits, cross-checked). Decisive findings: BEAN FX and BEAN Folio are ABSENT
  from the repository; GANGZII's surface is runtime-unwired; zero browser-side compute
  existed before this milestone; exact reuse seams identified (auth, rate limits,
  GenerationJob queue, health/capabilities, metering, fallback registry).
- **Shared engine** — `src/lib/client-compute/` (14 modules): typed contracts, real
  capability detection, tier derivation, the 12-step scheduler with honest states,
  WebGPU engine + compatibility registry, bounded CPU/worker engine, model registry
  with the full download policy, resource manager, consent/privacy, output validators,
  sanitized telemetry, singleton wiring.
- **Product adapters** — LAXII (flagship, wired into the existing UI behind explicit
  consent), CODE GIFTZ (advisory local-only analysis), JAZMII (reference pre-check +
  thumbnail), with RIISHE/GANGZII deferred on recorded rationale and FX/Folio absent
  (adapter seam documented).
- **Server additive** — authenticated capability-report endpoint + additive table.
- **Tests** — 7 new unit suites (86 tests) covering detection honesty, tier matrix,
  scheduler contract (consent/local-only/dedupe/timeout/cancel/model/memory/
  concurrency/visibility), CPU engine + kernel serialization parity, model policy,
  privacy, adapters/kernels/validators + JAZMII server-bounds drift check, and the
  report route (auth/rate-limit/payload-minimization/ownership).
- **Real-browser verification** — engine bundle exercised in real Chromium (see §4).
- **Real-app UI E2E** — LAXII consent toggle + on-device preprocessing against the
  real server (see §5).
- **Docs** — audit, architecture, security, this report.

## 3. Capability detection — LIVE_VERIFIED

Measured in real Chromium (headless, sandbox environment), machine-readable evidence
at `validation/client-compute/browser/harness-results-desktop.json` and
`harness-results-mobile.json` (390×844 emulation):

| Check | Measured value (desktop run) |
|---|---|
| environment | `browser`, secureContext `true` |
| WebGPU | `supported: true`, `adapterAvailable: false` (API present, no adapter obtainable in this headless build) → tier honestly capped at 2 |
| WebGL | WebGL2 `true` (maxTextureSize 8192), WebGL1 unused |
| WASM | supported `true`, SIMD `false` (measured via real module validation) |
| Workers / OffscreenCanvas | `true` / `true` |
| SharedArrayBuffer | `false` (not cross-origin isolated) |
| hardwareConcurrency / deviceMemory | 2 (reported verbatim, never used as a performance measure) / ~4 GB coarse |
| Storage estimate | quota 10 GiB, usage 0, persisted `false` |
| Browser family | Chromium (display-level only) |
| Derived tier | **2 — "WebGL or limited WebGPU"** with an honest derivation trail (two cited reasons) |

No value was invented; unknowns stayed unknown. The mobile-emulation run produced the
same engine behavior across all 9 checks.

## 4. Engine execution in a real browser — LIVE_VERIFIED

All runs used the actual production engine code bundled from `src/lib/client-compute/`
with REAL browser APIs (real blob-URL Web Workers, real canvas decode/encode, real
localStorage consent, real Cache API surfaces):

| Flow | Result | Evidence |
|---|---|---|
| No-consent refusal | `failed` + "Client-side compute requires your explicit consent…" | harness-results-desktop.json |
| CODE GIFTZ analysis (real worker lane) | `completed`, `CLIENT_CPU_AVAILABLE`, validated; found `unbalanced-delimiters@app.ts:2` + `missing-relative-import@ghost.ts:1`; 38 ms | same |
| LAXII preprocess (decode → worker resize → JPEG encode) | `completed`, validated; **357,324 B PNG → 3,381 B JPEG**, 640×480 → 320×240 (scale 0.5); 28 ms | same |
| LAXII chroma cutout (deterministic port) | `completed`, validated; transparentFraction **0.75** (exact expected coverage), keyHue 120° (green), 1104 border samples; 27 ms | same |
| JAZMII reference pre-check | `completed` with honest verdict `ok:false` — "Both sides must be at least 256px." (160×120 fixture) | same |
| Segmentation honesty | `CLIENT_MODEL_UNSUPPORTED` — "The \"onnxruntime-web\" runtime is not available in this app." | same |
| Page errors during all runs | none (`agent-browser errors` empty) | e2e-log.txt |

`NOT_TESTED` (honestly not measurable here): **real-GPU WebGPU execution** — the
headless Chromium build exposes no GPU adapter, so no GPU kernel path was (or could
be) exercised on real hardware; the GPU engine's logic (device lifecycle, loss/OOM
mapping, enforced timeouts, buffer cleanup) is covered by unit tests with structural
fakes and explicitly labeled as logic tests. **No GPU execution success is claimed.**

## 5. Real-app UI E2E (LAXII flagship integration) — LIVE_VERIFIED

`scripts/clientcompute-ui-e2e.sh` against the real dev server + real database:

1. Real registration/login via the actual auth API (session cookie, value withheld).
2. Real shell navigation into the LAXII workspace.
3. Consent toggle found in the composer (`switch "Process large images on this device
   before upload"`), clicked → `aria-checked: true`, honest explanatory note rendered.
4. A **12,598,423-byte (12.0 MB) PNG** uploaded through the real file input →
   **processed on device → 3.5 MB (fit ≤2048 px)** — the scheduler → worker → canvas
   pipeline running inside the real app.
5. Server side received the PROCESSED file only: `ImageAsset` row
   `mime=image/jpeg, 2048×2048, 3,672,151 bytes` (stored file byte-identical) — the
   12 MB original never left the device, and the server re-validated decode + geometry.
6. Consent persisted in `localStorage` under `bean.clientCompute.consent.v1` (v1,
   granted, localOnly false).
7. Zero page errors during the entire flow.
8. Visual check of the screenshot: existing BEAN design intact, no unrelated UI
   changed (`validation/client-compute/ui-e2e/laxii-after-upload.png`).

## 6. Performance measurements (Phase 15) — LIVE_VERIFIED where measured

Measured on this sandbox's hardware (headless Chromium; CPU lane; single warm run —
labeled as indicative, not a benchmark suite):

| Measurement | Value |
|---|---|
| Code analysis (3 files, worker lane) | 38 ms end-to-end |
| Preprocess (640×480 PNG decode + 0.5× resize + JPEG encode) | 28 ms; 357 KB → 3.4 KB (−99.1 %) |
| Chroma cutout (160×120) | 27 ms |
| Preprocess E2E in-app (2048×2048, 12.0 MB → 3.5 MB) | within the upload interaction window (~12 s incl. server round-trip; device stage dominant) |
| Bounded CPU benchmark | opt-in, strictly time-boxed (≤60 ms budget), never run automatically |

Honest gaps: **client GPU vs client CPU / backend comparisons were NOT_TESTED** — no
WebGPU adapter exists in this environment and no GPU kernel ships yet. The scheduler's
choice-by-measured-feasibility is therefore currently driven by capability gates, not
by benchmark winners. No claim is made that client execution is faster than backend;
the measured benefit demonstrated here is upload-byte reduction (−99.1 % for the
preprocessed fixture) and zero-round-trip advisory analysis.

## 7. Security verification — LIVE_VERIFIED / OFFLINE_VERIFIED

- Route security (unit, OFFLINE_VERIFIED): 401 envelope, zod VALIDATION_ERROR on
  malformed tier, 429 with truthful Retry-After on the 11th report, per-user
  isolation on POST/GET, audit action recorded.
- Payload minimization (OFFLINE_VERIFIED): injected `userAgent`, `gpuVendor`,
  `promptText` fields never reach the stored row.
- Local-only enforcement (OFFLINE_VERIFIED + LIVE_VERIFIED): backend never called for
  local-only kinds or in user local-only mode (scheduler tests + real-browser local-only run).
- Consent enforcement (LIVE_VERIFIED): real-browser run refused device tasks without
  consent with the honest reason.
- Model policy (OFFLINE_VERIFIED): refusal without pinned checksum / approval /
  runtime / quota; checksum-mismatch install refusal; verified install + deletion.
- Schema change (OFFLINE_VERIFIED): additive-only diff reviewed; integrity check ok
  pre/post; row counts unchanged.
- Full push-delta secret scan: performed before commit (see §9).

## 8. Regression preservation (Phase 14 / spec preservation rules)

- Full suite before: 1885/0 (133 files) → after: **1971/0 (141 files)** — no existing
  test modified or weakened.
- Existing LAXII upload flow: byte-for-byte unchanged behavior when the toggle is off
  (small/`<4 MB` files and non-consenting users follow the original path).
- Unchanged by design: RIISHE, JAZMII server pipelines, CODE GIFTZ chat/sandbox/
  versions/export, GANGZII (still unwired — unrelated repair deliberately not done),
  auth/portal/gateway, 168-component kit + GSAP/Vanta engines, health route.
- No Ollama, no paid APIs, no duplicate gateway/queue/storage/sandbox infrastructure.

## 9. Push-delta review and scan results

- Diff scope: 1 modified product file (`laxii.tsx` — additive consent toggle +
  preprocessing hook), 1 additive route, 1 additive schema model, engine modules,
  tests, docs, evidence, one E2E script.
- Secret scan of the delta: token/password/key patterns — zero hits; no `.env`,
  DB files, session material, user media, model weights, build outputs or caches
  staged (the harness `bundle.js` build artifact and the E2E `cookies.txt` were
  explicitly removed from the tree before commit).
- Commit message: `feat(bean): add shared client-first hybrid compute engine`.
- Push: fast-forward only; `git ls-remote origin refs/heads/main` verified == local
  HEAD immediately after push (the verified SHA is this commit's own hash).

## 10. Known limitations (honest)

1. **GPU lane is plumbed but empty by design** — no BEAN kernel has a compatibility
   entry yet, and no real-GPU execution was measured (headless environment). The
   compatibility registry keeps this honest: the GPU target is unreachable until
   entries + kernels land on supported hardware.
2. **No ML runtime dependency exists** — client segmentation remains a model-gated
   honest state (`CLIENT_MODEL_UNSUPPORTED` / `CLIENT_MODEL_NOT_INSTALLED`), with the
   download policy refusing everything until an operator pins a verified checksum and
   the upstream license is cleared (`verify-before-distribute`).
3. **Worker kernels must be self-contained** — the serialization contract is tested
   for shipped kernels; future kernels need the same discipline.
4. **RIISHE / GANGZII / BEAN FX / BEAN Folio have no adapters** — deferred on recorded
   rationale (no measured benefit / unwired surface / product absent). The adapter
   seam is the attachment point.
5. **Blob workers + CSP** — a future strict CSP must allow blob workers for the app's
   own origin (recorded in the security doc; the preview iframe CSP is unaffected).
6. **E2E evidence was captured against the sandbox dev server** — the LAXII E2E used a
   throwaway test account through the real API; its session cookie was never committed.
7. **Performance comparisons are indicative, not a benchmark suite** — single warm
   runs on sandbox hardware; the spec's cross-device matrix (supported-GPU desktop /
   no-WebGPU desktop / low-memory / real mobile) requires real hardware this
   environment does not have and is recorded as NOT_TESTED rather than extrapolated.

## 11. Prior-milestone state disclosure (M25)

The immediately preceding task (CODE GIFTZ M25 — intelligent multi-file refactoring)
was found INCOMPLETE at session start: its platform auto-commit `ee65874` contained the
implementation + 5 test files + a validation harness whose live report recorded
**5 FAILED acceptance steps** (55/61 checks: service-module scoping, missing UI
refactor card, append-only history check, a broken generated import cascading into the
export build + browser steps) and no delivery report. That work is preserved on local
branch `backup/m25-wip-auto-commit` (never pushed). It was deliberately NOT included
in this milestone's changeset and NOT published as-is — publishing an unverified
milestone behind a `feat` message would have violated the honesty rules. Completing
M25 (fixing the four defect areas, regenerating the live evidence, writing
`docs/M25-REFACTORING-REPORT.md`, then its own commit) remains the outstanding debt
from that task.

## 12. Definition-of-done scorecard (spec FINAL ACCEPTANCE CRITERIA)

| # | Criterion | Status |
|---|---|---|
| 1 | Detect real browser capabilities | DONE — LIVE_VERIFIED in Chromium |
| 2 | Run supported workloads on visitor hardware | DONE — 3 kinds execute for real (worker lane) |
| 3 | Use GPU when supported and beneficial | PLUMBED, NOT CLAIMED — registry-gated; no kernel + no real GPU here (NOT_TESTED) |
| 4 | CPU/WASM fallback workloads | DONE — bounded worker pool, honest degradation |
| 5 | Existing backend execution when required | DONE — backend delegate seam + honest states |
| 6 | Preserve existing server functionality | DONE — full suite green, no pipeline touched |
| 7 | Respect explicit user consent | DONE — gate + real UI toggle, LIVE_VERIFIED |
| 8 | Keep private tasks local when local-only | DONE — enforced and tested |
| 9 | Prevent unauthorized resource use | DONE — admission/concurrency/memory/pagehide gates |
| 10 | Release GPU/CPU/worker resources safely | DONE — per-task buffer cleanup, releaseAll, pagehide |
| 11 | Report honest capability and task states | DONE — 11-state contract, no invented values |
| 12 | Preserve all six products and their features | DONE for the four wired products; FX/Folio ABSENT (documented); GANGZII untouched (pre-existing state) |
