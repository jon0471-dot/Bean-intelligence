# M40 — MODEL EXECUTION MATRIX (registry ↔ real execution reconciliation)

> Branch: `feat/m40-real-hardware-capability-completion` · Evidence dates: **2026-11-25** (same-day runs, M40 window)
> Companion docs: `docs/M40-IMPLEMENTATION-REPORT.md`, `docs/ai/MISSING-CAPABILITIES-M40.md`, `docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md`, `docs/ai/LOW-SPEC-ACCEPTANCE-M40.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` (the M39 base this builds on).
> Machine-readable evidence: `scripts/m40-acceptance/out/execution-matrix-m40.json` (M40 lanes + re-run M39 base, both from the live dev server), `scripts/m40-acceptance/out/product-e2e-m40.json` (five-product E2E), `scripts/m40-acceptance/out/laxii-lane-repro/` (pixel-level false-alarm proof).
> Outcome vocabulary (unchanged from M39): **ok:true** = real inference produced a validated, task-specific output · **ok:null** = honest unavailability, exact reason recorded · **ok:false** = the lane was expected to work here and genuinely failed.
> Lifecycle vocabulary is NOT interchangeable (M40 rule): a backend is **registered** ≠ **compatible** ≠ **downloaded/integrity-verified** ≠ **initialized** ≠ **execution-tested with a validated output**. The matrix below states, per row, which of these the evidence actually proves.

## 1. What M40 changed in the audit

M39 recorded three capabilities as honest nulls because no execution path existed:
scanned-image OCR (`documents.ocr-scanned`), embeddings (`retrieval.embeddings`),
reranking (`retrieval.reranking`). M40 implemented all three as REAL execution
lanes (commit `37504b7`, m40.1), reconciled the router adapter map against the
capability records (commit `32c0aac`, m40.2), and re-ran the full 32-lane M39
base matrix PLUS the new lanes against the live production server this window
(commits `ab7209e`, m40.5):

- **M40 lanes: 12 steps / 0 FAIL / 0 unexpected-unavailable** — every step either a real validated output or a code-derived registry fact.
- **M39 base re-run: 14 PASS / 15 honest-unavailable / 3 FAIL** — and each of the three "FAIL" rows was proven NOT an application failure (see §3): one upstream ASR 429 and two validator size-floor false alarms, proven at pixel level by `probe-laxii-lanes.ts` (real 96×96 PNGs, valid structure, genuine per-channel variance).

## 2. The M40 lanes (execution-tested THIS window, real CPU inference)

| Capability | Backend | Runtime / weights | Validation applied | Verdict (measured) |
|---|---|---|---|---|
| REAL OCR inference (module) | `bean-documents-ocr-local` | tesseract.js 6 WASM CPU over pinned `eng.traineddata` (4,113,088 B, SHA-256-pinned) | all 3 planted fragments found verbatim; confidence 95.0 ≥ floor 40; 9 words | **PASS — 629 ms cold incl. worker spawn** |
| REAL OCR in the product route | same, via `POST /api/riishe/documents` | same | document STORED `ready` with OCR text recorded in the note (see `riishe.image-ocr-route` in `product-e2e-m40.json`: 318 chars, vision-flag independence honored) | **PASS — the m40.5-bounded worker spawn cannot hang the route** |
| REAL text embeddings | `bean-embeddings-local-minilm` | all-MiniLM-L6-v2 int8 ONNX (22,972,370 B) CPU, dependency-free WordPiece tokenizer | 384-dim vectors, ‖v‖=1.0000, cos(paraphrase)=0.9654 > cos(unrelated)=−0.0227 | **PASS — 136 ms** |
| REAL cross-encoder reranking | `bean-rerank-local-ms-marco-minilm` | MS-MARCO MiniLM cross-encoder int8 ONNX (23,143,499 B) CPU | scores [0.9998, 0.0000, 0.0002], ordering relevant→irrelevant, pair cap 8 pinned by unit tests | **PASS — 140 ms** |
| Registry reconciliation (adapter-binding drift) | all three lanes + router adapter map | `reconcileRegistries(REAL ADAPTERS)` | **zero `missing-adapter-binding` drift**; 5 entries of a DOCUMENTED other kind (`backend-missing-engine-entry`, cost/hardware metadata — listed in `docs/ai/MISSING-CAPABILITIES-M40.md` §4) | **PASS** |
| Lifecycle rows (code-derived) | the three backends | — | stage=`compatible`, blockedBy=`credential-configured`; execution-tested/output-validated claimed ONLY by the measured rows above | **PASS (no lifecycle-state inflation)** |

## 3. The re-run M39 base (every other registered capability, this window)

Full 32-lane base run carried inside `execution-matrix-m40.json` (`base.steps`).
Verdicts that CHANGED meaning vs the M39 doc are annotated.

### PASS this window (14) — real outputs, validated

RIISHE document-understanding (125-char extraction, status ready) · RIISHE vision-image-analysis (real description persisted) · LAXII asset-upload + mask-upload · LAXII background-removal-local (**MODNet ONNX CPU, matte validated**) · LAXII image-generation (hosted artifact served) · JAZMII video-motion-local (**local RIFE lane, provenance `local-motion-rife`, artifact served HTTP 206** — also re-verified in the product E2E the same day) · GANGZII engine-install (Kokoro-82M q8, sha256) · GANGZII speech-synthesis-local (**RIFF-validated WAV**, re-verified in the product E2E) · GANGZII audio-conversion (local ffmpeg) · GANGZII audio-production · auth · local-model installs (MODNet/LaMa/RIFE integrity-verified).

### Honest nulls this window (15) — with exact reasons

| Lane | Why unavailable (verbatim reason class) | Class |
|---|---|---|
| riishe.text-generation | "chat completion not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago); call skipped to avoid worsening the throttle" — the app's circuit breaker refusing to hammer a throttled upstream | EXTERNAL quota (upstream 429 persisted the whole M40 window) |
| riishe.document-grounded-qa | same breaker | EXTERNAL |
| code-giftz.code-generation | same breaker | EXTERNAL |
| laxii.image-generation | job submission wait timeout under the same throttle | EXTERNAL |
| laxii.image-editing-hosted | wait timeout (upstream) | EXTERNAL |
| gangzii.speech-synthesis-hosted / gangzii.audio-transcription | upstream 429 "Too many requests" | EXTERNAL |
| riishe.chat.openai-compatible | dormant without operator-configured credentials (honest registry state) | CREDENTIAL (dormant by config) |
| riishe.chat.anthropic | provider row not exposed; dormant without credentials | CREDENTIAL |
| riishe.chat.llamacpp-loopback | local llama.cpp server not running on this host (loopback honest) | LOCAL-SERVICE |
| laxii.smart-edit-generative | GPU Diffusers worker not deployed here — HTTP 503, "nothing queued, nothing faked" | NOT-DEPLOYED |
| jazmii.video-generation-hosted | poll window elapsed under upstream 429; job stays tracked | EXTERNAL |
| jazmii.video-generation-wan | Wan 2.2 self-hosted worker **never implemented** (registry enabled:false) | NOT-IMPLEMENTED |
| documents.ocr-scanned / retrieval.embeddings / retrieval.reranking (M39 bean-supporting-* rows) | **SUPERSEDED** — these three capabilities are now the REAL M40 lanes in §2; the old placeholder backends are retired rows | M40 COMPLETED |

### The three base-run FAIL rows — resolved, none is an application failure

1. `bean-audio-asr-hosted-primary` — upstream 429 (external; recorded honestly).
2. `bean-image-local-sharp` "output 493 bytes (PNG)" — **false alarm**: the M39 validator's byte-size floor is fixture-calibrated for 1024² inputs; on the matrix's 96×96 fixture a fully valid enhanced PNG is ~0.5 KB. Pixel-level proof: `out/laxii-lane-repro/probe-enhance-output.png` (valid PNG, 96×96×3, per-channel stdev 39–71).
3. `bean-image-local-edit` (LaMa) "output 492 bytes" — same false alarm, same proof (`probe-lama-output.png`, masked region inpainted, channel means shifted vs enhance).

The product E2E (`product-e2e-m40.json`) subsequently enhanced a **256×256** fixture through the SAME route and validated the output STRUCTURALLY (sharp decode: `png 256x256`, 1,899 B) — the validator byte-floor false-alarm class cannot recur in M40 evidence.

## 4. Hosted-LLM evidence chain (honest dating)

- **Last verified hosted-LLM inference: the M39 same-day runs (2026-11-24)** — `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` §2 records **26 PASS / 8 honest-unavailable / 0 FAIL** including RIISHE text-generation ("The capital of France is Paris." fetched from the persisted conversation) and CODE GIFTZ sandbox-execution (FizzBuzz sequence verified in stdout). Earlier repo evidence: `evals/code-giftz/results/benchmark-regression-1793769506668.json` (2026-11-04, 66/67 checks) and `evals/riishe/results/results-1793540327249.json` (2026-11-01).
- **During the M40 window (2026-11-25)** the upstream gateway returned sustained 429s (measured from ~05:21 through ≥15:30 UTC; the embedded engine's own retry ledger shows 38 minutes of cumulative throttle waits on one JAZMII job). Every hosted-LLM lane in this window is therefore an honest null — **the runtime refused to fake, queue-hide, or worsen the throttle, exactly the M40 contract.**

## 5. Browser-side client-compute rows

Registry facts + hardware acceptance status are owned by `docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md` (RTX 5060 Ti ten-point harness, exact Windows-PC commands) and `docs/ai/LOW-SPEC-ACCEPTANCE-M40.md` §5 (what the sandbox may and may not claim). Nothing is duplicated or re-claimed here: **the in-browser GPU pass remains pending owner hardware acceptance and is not claimed by this matrix.**

## 6. Reproduce

```bash
BASE=http://localhost:3000 bun --preload ./scripts/m40-acceptance/extend-fetch-timeout.ts \
  scripts/m40-acceptance/execution-matrix.ts     # M40 lanes + M39 base re-run
BASE=http://localhost:3000 bun --preload ./scripts/m40-acceptance/extend-fetch-timeout.ts \
  scripts/m40-acceptance/product-e2e.ts          # five-product E2E (budgeted, --merge/--only)
bun scripts/m40-acceptance/low-spec-probe.ts     # constrained-host CPU lanes (§ LOW-SPEC doc)
```
