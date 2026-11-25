# M40 — LOW-SPEC ACCEPTANCE (real constrained host, measured)

> Branch: `feat/m40-real-hardware-capability-completion` · Date: 2026-11-25
> Companion docs: `docs/ai/LOW-SPEC-ACCEPTANCE-M39.md` (the M39 baseline this builds on), `docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M40.md`, `docs/M40-IMPLEMENTATION-REPORT.md`.
> Governing rules honored: **"test representative low-resource profiles… clearly distinguish simulated profiles from measurements on physical low-end devices"** · **"a weak local model never silently replaces a stronger authorized route"** (M39 quality-routing policy, unchanged).

## 1. Evidence classes in this document (kept strictly separate)

| Class | What it is | Where it appears |
|---|---|---|
| **Real constrained-host measurement** | The three M40 retrieval/OCR lanes executed by REAL CPU inference on the physical sandbox host (2 vCPU Intel Xeon, 4,041 MB RAM, **no GPU**) — a genuinely resource-constrained machine, **not** a simulated device profile | §3 below, `scripts/m40-acceptance/out/low-spec-probe.json` |
| **Policy/lane contract tests** | Unit/integration proof that tiers, budgets, fallback and cancellation behave (reproducible anywhere) | M39 doc §2, unchanged in M40; 112 client-compute routing/device/lane tests still green in the M40 full-suite run |
| **Browser-side WASM lane** | The same production modules the browser workers run, exercised on real CPU hardware (this host) via the RTX harness smoke + the M39 matrix; the in-browser low-spec device pass remains **pending owner hardware acceptance** (M39 §4 statement unchanged) | §5 |

No evidence class is presented as another. In particular: **this sandbox is not
a physical low-end end-user laptop**, and nothing here claims to be one. What
it IS: a real 4 GB-class CPU-only machine on which the product's low-resource
execution path ran real inference and produced validated outputs.

## 2. Host facts (verbatim from the probe run)

```json
{ "cpus": 2, "cpuModel": "Intel(R) Xeon(R) Processor", "totalMemMb": 4041.57,
  "freeMemMbStart": 3413.15, "gpu": "none (physical fact of this host — WebGPU absent)",
  "platform": "linux x64 5.10.134-013.15.kangaroo.al8.x86_64",
  "classification": "real constrained host (4 GB class, CPU-only) — not a simulated profile" }
```

## 3. Measured lanes (REAL inference, `scripts/m40-acceptance/low-spec-probe.ts`)

Each lane: explicit `unloadAllLocalModels()` first → cold run (includes model
session load) → 3 steady-state runs → explicit unload → RSS observed. All
artifacts are the SHA-256-pinned ones the product installs (`storage/models/`,
installed through the admin-gated route; the probe loads them via the REAL
manager — no side-channel file access).

| Lane | Validation (task-specific) | Cold (incl. load) | Steady runs | RSS load → after unload |
|---|---|---|---|---|
| **OCR** (`ocr-eng-traineddata`, tesseract.js over pinned `eng.traineddata`, 4,113,088 B) | planted fragment found verbatim, confidence **94.0** ≥ floor, 6 words | **622 ms** | **107 / 96 / 84 ms** | 140.0 → 143.8 MB |
| **Embeddings** (`minilm-l6-embeddings`, all-MiniLM-L6-v2 int8 ONNX, 22,972,370 B) | 384-dim, 8 texts, cos(paraphrase) **0.9654** > cos(unrelated) **−0.0227** | **179 ms** | **69 / 59 / 73 ms** | 246.8 → 226.4 MB |
| **Reranking** (`ms-marco-minilm-rerank`, cross-encoder int8 ONNX, 23,143,499 B) | 8 candidate pairs, relevant passage ranked **top-1**, scores [1.000, 0.011, 0.006 …] all in [0,1] | **142 ms** | **63 / 66 / 72 ms** | 264.5 → 230.6 MB |

Reading: on a 2-vCPU / 4 GB machine the three lanes are all sub-second cold
and ~60–110 ms steady — the low-resource execution path is genuinely usable,
not nominal.

## 4. Memory-aware load/unload + idle reaper (measured live, production knob)

With `BEAN_LOCAL_MODEL_IDLE_UNLOAD_MS=4000` (the production env knob, default
5 min):

- RSS before load 230.6 MB → with the embeddings session loaded 237.1 MB →
  after one idle tick beyond the 4 s window **212.7 MB** (`reapedObserved:
  true`) — the ORT session is disposed and memory returns below baseline.
- A **fresh inference after the reaper ran** succeeded (384-dim output) —
  unload does not poison the lane; the next request transparently reloads.
- Explicit `unloadAllLocalModels()` after each measured lane also shows RSS
  returning toward baseline (table above).

## 5. The browser-side CPU/WASM lane (what is and is not claimed)

- The **same production modules** the browser worker bundles
  (`public/workers/segmentation-worker.js` etc.) execute were exercised on
  this host's CPU via the RTX harness smoke (`docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md`
  §5) and the M39 matrix lanes — real WASM/ONNX CPU inference with validated
  outputs.
- The **in-browser pass on a physical low-spec end-user device** (old laptop /
  constrained mobile) is NOT claimed here. It becomes claimable exactly two
  ways: the owner's Windows PC acceptance (harness commands in the RTX doc §4)
  and/or a future physical-device pass. Until then the browser-side lane on
  such devices is reported as **hardware-dependent — pending owner hardware
  acceptance**, and the automatic policy (M38 §B5 quality routing) keeps such
  devices on honest routes — weak local models never silently replace
  stronger authorized ones.
- The chat CPU/WASM lane itself (wllama + Qwen2.5-0.5B GGUF, `n_gpu_layers=0`,
  budget-adapted context, interruptible, heap-releasing) was verified in M39
  and is unchanged in M40; its contract tests remain green.

## 6. Resource-exhaustion & cleanup behaviors (unchanged contracts, verified green)

- Bounded worker concurrency (2 normal / 1 conservative), memory-feasibility
  gate refusing workloads above the tier budget with an honest message,
  hidden-tab start refusal, abort-signal cancellation, pagehide release,
  worker `exit()` cleanup — all pinned by the M39 test battery (112 tests),
  re-verified green in the M40 full-suite run (`docs/M40-IMPLEMENTATION-REPORT.md`).
- New in M40 and measured here: the local-model idle reaper (§4) bounds
  long-lived session memory on the server side — the same honesty contract on
  the serving path.

## 7. Known observations recorded honestly

- After the probe writes its evidence file the **CLI process** does not exit
  until killed: onnxruntime-node/tesseract native threads keep the bun event
  loop alive after `main()` resolves (the production reaper interval is
  already `unref`ed — `src/lib/media/local-models.ts`; this is a CLI-runner
  ergonomics observation only). The evidence file is fully written before the
  hang; server behavior is unaffected (servers are long-lived by design).
- WebGPU is absent on this host by physical fact — every GPU-dependent check
  reports honest unavailability; no GPU number anywhere in this document is
  invented (there are none).

## 8. Reproduce

```bash
# models must be installed through the product's admin-gated install route
bun scripts/m40-acceptance/low-spec-probe.ts
# → scripts/m40-acceptance/out/low-spec-probe.json (host facts + 3 lanes + reaper)
```
