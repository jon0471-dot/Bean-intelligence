# M40 — MISSING CAPABILITIES: CLOSED, AND WHAT REMAINS (honest ledger)

> Branch: `feat/m40-real-hardware-capability-completion` · Date: 2026-11-25
> Companion docs: `docs/M40-IMPLEMENTATION-REPORT.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M40.md`, `docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md`, `docs/ai/LOW-SPEC-ACCEPTANCE-M40.md`.
> Governing rule: **operational counts move ONLY when a real inference path produced a validated output** — documentation alone never upgrades a capability; and every remaining gap is stated with its exact reason instead of being papered over.

## 1. The three M39-declared missing capabilities — all now REAL

M39 ended with an honest null for each of these (its matrix rows
`documents.ocr-scanned`, `retrieval.embeddings`, `retrieval.reranking`: "no
backend/adapter registered yet"). M40 closed all three with real, pinned,
Apache-2.0 execution paths built INTO the existing infrastructure — no new
registry, no new queue, no duplicate vector store:

| Capability | What was built (m40.1 `37504b7` + m40.5 `ab7209e`) | Real-inference evidence (this window) |
|---|---|---|
| **OCR** | `bean-documents-ocr-local`: tesseract.js 6 (WASM CPU) over `tessdata_fast` eng traineddata, 4,113,088 B SHA-256-pinned through the EXISTING local-model manager; admin-gated install; honest no-usable-text + confidence-floor refusals; wired into the RIISHE documents route beside the vision lane; m40.5 hardening: bundler-proof worker-script resolver + bounded spawn (a worker that cannot start is an honest `OcrUnavailableError`, never a hung route) | matrix: 3 planted fragments verbatim, confidence 95.0, 629 ms; product route: stored `ready` with OCR note (E2E `riishe.image-ocr-route` PASS, 318 chars, while the vision lane was independently rate-limited — the independence contract held in production) |
| **Embeddings** | `bean-embeddings-local-minilm`: all-MiniLM-L6-v2 int8 ONNX (22,972,370 B) + pinned vocab, 384-dim mean-pool L2-normalized, dependency-free BERT WordPiece tokenizer, CPU execution | matrix: 384-dim, ‖v‖=1.0000, cos(paraphrase)=0.9654 > cos(unrelated)=−0.0227 (136 ms); low-spec probe: cold 179 ms, steady 59–73 ms on a 2-vCPU/4 GB host |
| **Reranking** | `bean-rerank-local-ms-marco-minilm`: MS-MARCO MiniLM cross-encoder int8 ONNX (23,143,499 B), sigmoid pair scores, 8-pair cap | matrix: scores [0.9998, 0.0000, 0.0002], relevant first (140 ms); low-spec probe: relevant-top-1 with scores [1.000, 0.011, …] |
| **Retrieval integration** | RIISHE `search_document` tool: chunk → embed → cosine → rerank over attached documents; bounded conversation-scoped cache (max 8 docs / 400 chunks); honest fallback to `read_document` paging when lanes are unavailable — **no vector database, no duplicate memory store** | real module-lane inference above + unit battery; admission into the orchestrator tool set is unconditional-with-honest-unavailable (never a silent downgrade) |

Registry honesty for the three: capability-record verbs (`ocr/document-parsing/embeddings/reranking`), engine-catalog entries, three model manifests, install-route enum + companion-artifact integrity (a model is never "ready" unless EVERY pinned artifact verifies), and `reconcileRegistries(REAL router adapters)` shows **zero adapter-binding drift** (m40.2 `32c0aac`, re-verified this window).

## 2. Other capabilities audited in M40 — outcomes

The audit walked every registered backend (M39 32-lane base re-run + the M40
rows + the registry reconciliation). Outcomes beyond §1:

- **No other missing inference path was found**: every other enabled backend
  has a real execution path and produced either a validated output this window
  (see matrix §3 PASS list) or an honest null whose reason is environmental,
  not a code gap (§3 below).
- **Two measured defects were found by the audit and FIXED in M40** (they were
  silently degrading real capabilities):
  1. the tesseract worker path broke in bundled server contexts (the OCR lane
     could hang forever) — fixed in m40.5 with the runtime resolver + bounded
     spawn, proven by the matrix going 10/2 → 12/0 between the pre-fix and
     post-fix runs (`execution-matrix-m40.run1-preclean.json` vs `…-m40.json`);
  2. the documents route 422'd VALID images as "corrupted" when the vision
     service rate-limited — fixed in m40.5 (vision failure = stored document
     with an honest limitation note; the local OCR lane's real output is still
     delivered), pinned by 4 composition tests including a customer-safe
     no-internal-names assertion.
- **No documentation-only upgrades**: every operational claim in
  `capability-records` remains tied to the same evidence the matrix cites; the
  three new lanes carry code-derived lifecycle `compatible` (with
  `credential-configured` as the only gate) and their `execution-tested /
  output-validated` status comes ONLY from the measured runs cited above.

## 3. Capabilities still NOT claimable — exact reasons (unchanged contracts)

| Capability | Reason it cannot be claimed today | What would make it claimable |
|---|---|---|
| RIISHE/GIFTZ hosted-LLM lanes during the M40 window | upstream gateway sustained 429 all window (external quota); the app's breaker skipped calls "to avoid worsening the throttle". Last verified hosted inference: M39 same-day runs, 2026-11-24 (26 PASS incl. RIISHE chat + GIFTZ sandbox — `MODEL-EXECUTION-MATRIX-M39.md` §2) | a future window when the upstream quota resets — the lanes re-run as-is |
| `laxii.smart-edit-generative` | GPU Diffusers worker not deployed on this host (HTTP 503, nothing faked) | deploy a ≥8 GB-class GPU worker (operator action) |
| `jazmii.video-generation-wan` | the Wan 2.2 self-hosted worker was **never implemented** (registry `enabled:false`) — the honest registry state, unchanged | implementation decision (out of M40 scope; no fake route exists) |
| `riishe.chat.openai-compatible` / `riishe.chat.anthropic` | dormant without operator-configured credentials (honest registry state) | operator configures credentials |
| `riishe.chat.llamacpp-loopback` | the local llama.cpp server is not running on this host | start the local GGUF server |
| in-browser WebGPU lanes on REAL end-user hardware | sandbox has no WebGPU adapter (physical fact); the RTX acceptance harness + exact Windows-PC commands are ready — **pending owner hardware acceptance** | run `validation/m40-rtx` on the RTX 5060 Ti PC per `RTX-5060-TI-ACCEPTANCE-M40.md` §4 |
| in-browser CPU/WASM lanes on a physical low-spec device | this host is CPU-only 4 GB (real constrained-host measurements EXIST — `LOW-SPEC-ACCEPTANCE-M40.md` §3); a physical old-laptop pass is a separate evidence class and is not claimed | a physical low-end device pass |

## 4. Registry drift that REMAINS documented (non-blocking, metadata-only)

`reconcileRegistries` reports **zero missing-adapter-binding drift**. Five
entries of a different, documented kind remain — all
`backend-missing-engine-entry` ("enabled backend has no engine-catalog entry —
cost/hardware metadata incomplete"):

`bean-image-local-segmentation` · `bean-image-local-edit` ·
`bean-video-local-motion` · `bean-audio-tts-hosted-primary` ·
`bean-audio-asr-hosted-primary`

These backends are fully executable (three of them produced validated outputs
this window — MODNet matte, LaMa inpaint, RIFE video); the missing entries are
cost/hardware metadata in the engine catalog only. They are recorded here so
the ledger is complete; closing them is a metadata task, not an execution gap,
and is deliberately not dressed up as one.
