# M40 — RTX 5060 Ti ACCEPTANCE (real hardware protocol + harness)

> Branch: `feat/m40-real-hardware-capability-completion` · Date: 2026-11-25
> Companion docs: `docs/M40-IMPLEMENTATION-REPORT.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M40.md`, `docs/ai/LOW-SPEC-ACCEPTANCE-M40.md`, `docs/ai/DEVICE-COMPUTE-ARCHITECTURE-M39.md`.
> Governing rule (M40 brief): **"A GPU capability probe, WebGPU round-trip benchmark or simulated device profile is NOT proof of actual model inference."** · **"If the environment cannot reach the real RTX hardware, do not report the RTX GPU acceptance as passed — implement the acceptance harness and provide the exact local commands/steps to complete the test on my Windows PC."**

## 1. Honest environment statement

The M40 execution sandbox is a 4 GB CPU-only Linux container: **no discrete GPU, no
WebGPU-capable adapter, no access to the owner's Windows machine** (Ryzen 7 +
RTX 5060 Ti 16 GB + 32 GB RAM + current Chrome). Therefore:

- **No RTX GPU inference claim is made from this sandbox. Zero.**
- What this milestone delivers instead is the complete, executable acceptance
  harness for the real hardware, wired to the REAL production execution paths
  (not a benchmark page), plus the exact commands to run it on the owner's PC.
- The harness was smoke-built in this sandbox (bundle compiles, static server
  maps the exact origin paths the production worker expects); the GPU-gated
  checks execute only on real hardware.

## 2. What is being accepted (the real execution path)

The acceptance drives the REAL client-compute segmentation lane — the exact
modules the LAXII product imports (`src/lib/client-compute/index.ts` →
`adapters/laxii.ts` `image.segmentation` → `inference/ort-segmentation.ts` →
`public/workers/segmentation-worker.js`):

- the pinned MODNet artifact (`laxii-bgremoval-modnet`, 6,632,188 bytes,
  SHA-256 `92e49898…fee3a`, fetched through the production `requestDownload`
  consent + checksum gate — never a side-channel download);
- onnxruntime-web with the self-hosted **jsep (WebGPU) wasm build**
  (`public/ort/ort-wasm-simd-threaded.jsep.*`), WebGPU execution provider
  attempted first, honest WASM/SIMD fallback;
- the worker reports **verbatim which execution provider actually served each
  matte** (`provider: 'webgpu' | 'wasm'`) — the harness accepts nothing else as
  GPU proof.

## 3. The ten-point checklist → harness checks

Harness file: `validation/m40-rtx/harness-entry.ts` (+ `harness.html`,
`build.mjs`, served by `scripts/m40-acceptance/rtx-harness-server.mjs`).

| # | Brief requirement | Harness check | PASS criterion |
|---|---|---|---|
| 1 | Real GPU adapter available | `navigator.gpu.requestAdapter()`; adapter info recorded verbatim (vendor / architecture / device / description) | adapter present AND vendor/description contains NVIDIA AND the 5060 string — a different GPU is recorded as such, never silently accepted |
| 2 | Device vs required operators | real `GPUDevice` opened; features + `maxBufferSize`/`maxComputeWorkgroupStorageSize` recorded; **the true operator proof is the successful jsep compile of the whole MODNet graph at session init** (asserted by #3/#4 — a standalone matmul round-trip is explicitly NOT treated as inference proof) | device opens; init succeeds on the WebGPU EP |
| 3 | Model initialization + weight integrity | `cc.registry.requestDownload('laxii-bgremoval-modnet', { approval: true })` through the production gate, then real worker session init | `ok:true` from the checksum-gated download; session init completes |
| 4 | REAL inference executed ON GPU | first matte over the real acceptance fixture (`scripts/m262/fixtures/portrait.jpg` or user-supplied file) | worker-reported `provider === 'webgpu'` on a completed run |
| 5 | Correct, verified output | dims match input, alpha coverage inside a plausible band (>3% and <90%), mask variance non-degenerate (a real silhouette, not a flat fill) | all three validations true |
| 6 | GPU memory + execution time | per-run wall time + in-worker `durationMs`; adapter limits recorded. **WebGPU exposes no VRAM counter — the JS heap delta is recorded as an honestly-labeled proxy, never presented as VRAM usage** | measurements recorded |
| 7 | GPU device loss + recovery | `destroy()` on the captured REAL `GPUDevice` the runtime opened → next matte must recover; `device.lost` events captured | follow-up matte succeeds; recovery-to-`webgpu` = full pass, honest fall-through to `wasm` is recorded as a partial result (never hidden) |
| 8 | Automatic CPU/WASM fallback | `navigator.gpu.requestAdapter` made unavailable (the same code path a driver reset exercises) → next matte must produce a **validated** output with `provider === 'wasm'` | validated CPU matte through the same production lane |
| 9 | Repeated requests, no leak | 10 sequential mattes with `window.gc()` between runs; heap delta bounded (<30 MB); every run on GPU | all succeed on `webgpu`, heap bounded |
| 10 | Worker cancel + cleanup + health | `AbortController.abort()` mid-flight → honest rejection; immediate follow-up matte succeeds | cancel observed (or honestly "too fast to cancel"), worker healthy after |

Additional honesty rules encoded in the harness:

- The worker caches its ONNX session, so after #8 the provider may stick to
  `wasm`; this **stickiness is recorded** ("provider-stickiness-after-fallback"),
  never presented as GPU recovery.
- `ok:null` states exist for every check (e.g. no input image, no captured
  device, run too fast to cancel) — unavailability is explicit, never fabricated.
- The engine's own tier detection runs first and is recorded (`tier`,
  `tierReasons`) — the harness does not feed it any simulated profile.

## 4. Exact commands to complete the acceptance on the Windows PC

### 4.1 The one-command runner (M40.9 — the primary path)

```bat
git fetch origin && git checkout feat/m40-real-hardware-capability-completion && git pull --ff-only origin feat/m40-real-hardware-capability-completion
powershell -ExecutionPolicy Bypass -File scripts\m40-acceptance\run-rtx-acceptance.ps1
```

One command does the whole acceptance:

1. **safe sync** — fetch + fast-forward ONLY (aborts if the tree is dirty; never
   `reset --hard`, never discards local work);
2. **deps** — `bun install` / `npm install` when `node_modules` is absent;
3. **builds** — `npm run build` (workers + ORT assets) and the harness bundle
   (`validation/m40-rtx/build.mjs`);
4. **serves** the harness at `http://localhost:8787/harness` (localhost only)
   and launches the installed **Chrome with `--js-flags=--expose-gc`**
   (needed for check #9);
5. **captures the evidence automatically** — the harness now POSTs its finished
   results to the server (`POST /evidence`), which schema-gates and saves them
   to `validation\m40-rtx\results-<utcstamp>.json` (the manual download button
   remains as a fallback; switches `-SkipSync`, `-SkipBuild`,
   `-TimeoutMinutes N`);
6. **validates and verdicts** —
   `node scripts\m40-acceptance\validate-rtx-evidence.mjs <file>` re-checks the
   evidence against `validation/m40-rtx/evidence-schema.json` and prints the
   acceptance verdict (full acceptance = 10/10 `ok:true`, with the single
   allowed nuance of #7 recorded as an honest partial; the validator
   structurally CANNOT pass a partial run — its verdict rules were self-tested
   against a full run, a partial run and a missing-point run before shipping).

The evidence JSON is the acceptance record: verbatim adapter info, providers,
timings, heap deltas, device-lost events and per-check verdicts. It contains
browser-side measurements only — no secrets and no local file paths — so it
can be committed as-is. Commit it on the feature branch and the RTX acceptance
is reported as executed on real hardware.

### 4.2 Manual equivalent (unchanged, still supported)

```bat
:: 1. sync the branch (fast-forward only)
git fetch origin
git checkout feat/m40-real-hardware-capability-completion
git pull --ff-only origin feat/m40-real-hardware-capability-completion

:: 2. install dependencies (once) and build the production artifacts
bun install        (or: npm install)
npm run build      (builds public\workers\*.js + copies public\ort\*)

:: 3. start the harness static server (mapped origin paths; nothing else exposed)
node scripts\m40-acceptance\rtx-harness-server.mjs
::    → "M40 RTX harness server on http://localhost:8787/harness"

:: 4. open in current Chrome with GC exposed (needed for check #9)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --js-flags="--expose-gc" "http://localhost:8787/harness"
```

Then: wait for `DONE: N PASS / …` in the page — the evidence now auto-saves to
`validation\m40-rtx\results-<utcstamp>.json` (or click **Download evidence
JSON** for a manual copy). The evidence file is the acceptance record; commit
it on the feature branch.

A check counts as PASSED only as written in §3. Ten of ten `ok:true` (with the
one explicitly-allowed nuance: #7 recorded as partial with a validated wasm
recovery) is the full RTX 5060 Ti acceptance.

## 5. What this sandbox verified about the harness itself (no GPU claims)

Measured 2026-11-25 on the sandbox host (headless Chromium via the repo's
browser-automation CLI against `scripts/m40-acceptance/rtx-harness-server.mjs`):

- All four server routes serve HTTP 200: `/harness`, `/bundle.js`,
  `/ort/ort-wasm-simd-threaded.jsep.mjs`, `/workers/segmentation-worker.js`.
- `validation/m40-rtx/bundle.js` compiles from the REAL production modules
  (esbuild, chrome120 target, ~150 KB) — the imports the harness uses are the
  modules the app ships.
- The page **boots and executes for real**: the client-compute engine
  initializes, consent records, and with no WebGPU adapter present the harness
  recorded exactly one check — `1 gpu-adapter ok:false "no WebGPU adapter —
  the GPU acceptance cannot run on this machine"` — then finished cleanly
  (`DONE: 0 PASS / 1 FAIL / 0 honest-unavailable` in the console; no page
  errors). This is the honest refusal path working end-to-end, NOT a GPU
  result.
- The production integrity gate also proved itself in the first smoke pass
  (before the no-adapter early-stop was added): the MODNet download was
  **refused by the registry gate** with `REFUSED_RUNTIME_UNAVAILABLE — The
  "onnxruntime-web" runtime is not available in this app` — consent + runtime
  gating work; the download cannot proceed where the runtime cannot.
- One harness defect was found by this smoke and fixed: without an adapter
  the entry continued past its `finish()` (which binds the download button),
  double-binding the button and throwing a null-deref at point 2. The entry
  now records the honest refusal and stops.
- The harness server maps `/ort/*` → `public/ort/*` (jsep wasm present) and
  `/workers/*` → `public/workers/*` (built worker bundles present after
  `npm run build`).
- The CPU-side half of the lane (the WASM fallback in #8) is exercised on real
  CPU hardware in the LOW-SPEC acceptance (`docs/ai/LOW-SPEC-ACCEPTANCE-M40.md`)
  using the same production modules — the GPU-gated points remain exclusively
  real-hardware checks.

### 5.1 M40.9 re-verification: the full evidence pipeline measured end-to-end (still no GPU claims)

Re-measured 2026-11-25 (M40.9 window) on the same CPU-only sandbox host:

- The harness entry now **auto-reports** its finished evidence to the harness
  server (`POST /evidence`); the server schema-gates the payload and saves it
  to `validation/m40-rtx/results-<utcstamp>.json`.
- Measured with the REAL page in headless Chromium: all five routes 200
  (`/harness`, `/bundle.js`, `/workers/segmentation-worker.js`,
  `/ort/ort-wasm-simd-threaded.jsep.mjs`, `/portrait.jpg`); the page boots,
  records the honest refusal (`1 gpu-adapter ok:false "no WebGPU adapter — the
  GPU acceptance cannot run on this machine"`), finishes cleanly and the
  console shows `evidence auto-report: HTTP 200 {"saved":…,"checks":1}` — the
  evidence file landed on disk without any manual click. A malformed POST body
  is refused 422 by the shape gate.
- `scripts/m40-acceptance/validate-rtx-evidence.mjs` validated that real file
  (`SCHEMA VALID` → verdict NOT-accepted with every missing point named) and
  was self-tested against a synthetic 10/10 run (accepted, including the #7
  honest-partial nuance) and a synthetic missing-point run (rejected) — the
  verdict rules cannot inflate a partial run.
- The honest refusal evidence file from this smoke is committed as the
  pipeline's measured record; **it is a pipeline proof, not a GPU result** —
  the RTX 5060 Ti pass remains exclusively the owner's §4.1 run.

## 6. Recorded honest limitations

- The sandbox cannot execute checks #1–#8 GPU-gated halves; nothing here is
  evidence of RTX inference.
- `adapter.info` availability differs by Chrome version; the harness tries the
  modern property then `requestAdapterInfo()` and records whichever exists.
- True in-the-wild device loss (driver reset) cannot be forced from JS; #7 uses
  `GPUDevice.destroy()`, which fires the same `device.lost` contract the runtime
  must handle. This is stated in the evidence rather than glossed over.
- The 5060-string check makes the harness RTX-5060-Ti-specific by design; on
  any other GPU the harness reports the real adapter and marks check #1 failed
  as "adapter present but not RTX 5060 Ti".
