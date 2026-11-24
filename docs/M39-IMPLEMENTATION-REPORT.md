# M39 — UNIVERSAL LIVE AI RUNTIME & AUTOMATIC DEVICE COMPUTE — IMPLEMENTATION REPORT

> Branch: `feat/m39-universal-live-ai-runtime` · Implementation date: **2026-11-24** (same-day delivery + same-day independent re-verification)
> Companion docs: `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` (per-capability execution evidence), `docs/ai/DEVICE-COMPUTE-ARCHITECTURE-M39.md` (routing architecture), `docs/ai/LOW-SPEC-ACCEPTANCE-M39.md` (simulated vs hardware evidence separation).
> Rule honored end to end: **no mock responses, no simulated success, no fake availability; unverified output never reports completion; hardware/browser-dependent items are labeled as such, never claimed.**

---

## 1. What M39 delivers

M39 turns every registered AI capability in BEAN into an automatically routed, genuinely executing path across four execution targets — compatible local GPU (WebGPU, only after real capability checks and successful model/operator init), compatible local CPU/WASM, optimized low-resource lanes, and authorized + configured hosted gateways — with **zero new user-facing controls**: no model selector, no GPU/CPU switch, no hardware panel, no settings page. The customer keeps using RIISHE, CODE GIFTZ, LAXII, JAZMII and GANGZII exactly as before; routing, compatibility, consent and fallback decisions happen entirely in the backend/orchestration layer.

It is built ON the existing architecture — one model registry (`src/lib/client-compute/model-registry.ts` + `src/lib/registry/backends.ts`), one scheduler (`src/lib/client-compute/scheduler.ts`), one resource manager, one durable job queue, one Trust Engine. **No duplicate registry, compute manager, inference gateway, RAG system or queue was created.**

### 1.1 Implementation commits (remote-verified on GitHub)

| Commit | Content |
|---|---|
| `2f545e6` | M38 feature branch merged into `feat/m39-universal-live-ai-runtime` (normal non-rewriting merge, per plan) |
| `f9e5016` (m39.1) | Quality-route policy (M38 §B5) wired into AUTOMATIC execution — `resolveQualityRoute` consulted by the scheduler for MODEL-backed tasks only; evidence mirrors the executor's own gates (model gate, backend gate, privacy) so the policy can never approve a lane the executor refuses; `prefer-backend` reorders backend-first with verified local lanes kept as honest fallback after a REAL backend failure; additive `ClientModelEntry.qualityClass` |
| `9496496` (m39.2) | CPU/WASM chat lane — registered `riishe-chat-wasm-qwen2.5-0.5b-gguf` (Qwen2.5-0.5B-Instruct q4_k_m GGUF, 491,400,032 bytes measured, sha256 `74a4da8c…7a9db` pinned, revision `9217f5db`), new `wasm-chat-worker` (wllama 4.0.0 MIT, self-hosted assets, `n_gpu_layers=0` so client-CPU claims are literally true), GPU-class load failures auto-fallback to CPU with recorded degradation, approval-gated bean-managed download with SHA-256 gate |
| `348f696` (m39.3) | Universal execution matrix (`scripts/m39-acceptance/execution-matrix.ts`, 799 lines) driving every registered backend through its REAL production route; CODE GIFTZ delivery parser fix (path directive honored); `audio-probe.ts` GANGZII acceptance |
| `2c9c3e7` (m39.4) | Same-day verified execution evidence — every registered backend driven through its real production path on the live dev server; recorded **26 PASS / 8 honest-unavailable / 0 FAIL**; matrix shape fixes from live findings |
| PRs **#17 / #18 / #19** | Merged into `main` by the repository owner (GitHub), head `eff0d96` |

### 1.2 Corrective pass (this session, same day — commit recorded in §6)

The same-day audit of the merged tree found and fixed one REAL defect that silently disabled M39's headline low-spec delivery, plus one honesty wording defect:

1. **WASM SIMD probe module was malformed (pre-M36-era defect, but it gated the M39 CPU/WASM lane off on EVERY device).** `SIMD_WASM_BYTES` in `src/lib/client-compute/capabilities.ts` encoded `(module (func (result v128) (v128.const i32x4 …)))` with only **12 of the required 16 v128 data bytes** (code body size 15 instead of 20). `WebAssembly.validate()` rejects it in every runtime — measured: node, bun AND a real headless Chrome 158 all returned `simd:false` for the committed bytes. Consequence: `wasmBinaryAvailable()` was always false → the registered CPU/WASM chat lane (`riishe-chat-wasm-qwen2.5-0.5b-gguf`) could never be selected, the on-device toggle never appeared, and the browser ASR / MODNet WASM fallbacks were equally dead. **Fix:** full 16 data bytes, body size 20, code size 22 (43-byte module, validates `true` in node/bun/browser). **Regression tests** (`tests/unit/capabilities-simd-probe.test.ts`, 4 tests) pin: probe reports `simd:true` in a SIMD-capable runtime, an independently built control module validates, and the exact old malformed byte shape is documented as rejected.
2. **Download dialog honesty.** The on-device model consent dialog hardcoded "runs on this device's GPU" even when the DECIDED lane was the CPU/WASM light build. Now the dialog names the decided lane's real runtime ("runs on this device's CPU (WebAssembly light build)") — verified live in the browser (§5). No new UI controls were added; this is a wording correction on the existing dialog.

Verification of the corrective pass: full suite **2797 pass / 0 fail / 5 skip across 212 files** (2793/0/5 before the fix — the 4 new regression tests account for the delta); `npx tsc --noEmit` — zero errors in touched files (155 pre-existing errors unchanged, all in legacy `scripts/`, `validation/` and pre-M30 test files, identical pattern to the M35 baseline); eslint clean on every touched file; `bunx prisma validate` valid; `bun run build` success.

---

## 2. Real execution evidence

### 2.1 Same-day universal execution matrix (implementation session)

`BASE=http://localhost:3000 bun scripts/m39-acceptance/execution-matrix.ts` — fresh account, real bytes, durable queue, real lifecycle, artifacts validated by container magic bytes / content checks / provenance (never status strings). Final same-day run: **26 PASS / 8 honest-unavailable / 0 FAIL** (full per-capability table with artifact sizes in `docs/ai/MODEL-EXECUTION-MATRIX-M39.md`). Highlights: RIISHE grounded QA carrying both planted facts; CODE GIFTZ `fizzbuzz.py` delivered AND executed in the real sandbox with stdout verified; MODNet / big-lama / RIFE SHA-256-pinned ONNX installs with real CPU outputs; hosted image gen/edit real JPEG/PNG; hosted video HTTP 206 (+ one honest 429 account-throttle run recorded verbatim); Kokoro TTS → hosted ASR verbatim round-trip → ffmpeg MP3/mastering chain. Honest unavailability recorded where a lane cannot run here (GPU Diffusers worker not deployed → 503; Wan video never implemented; dormant credential-gated slots; OCR/embeddings/reranking not integrated).

### 2.2 Independent same-day re-verification (this corrective session, live dev server, fresh account)

| Lane | Real evidence produced in this session |
|---|---|
| RIISHE chat (hosted gateway) | Real POST `/api/riishe/chat` turn → genuine answer "The capital of France is Paris." persisted with metadata (1248 ms, honest `UNVERIFIED` state + degradation note) |
| GANGZII local TTS | Kokoro-82M q8 installed through the product's own engine route (92,361,116 bytes, sha256 `fbae9257…1478`, 9.24 s) → real synthesis job: **295,244-byte RIFF/WAVE, 16-bit PCM mono 24 kHz, 6.15 s**, result provenance `engine: local Kokoro-82M (on-device ONNX)` |
| LAXII local matting | MODNet installed through the product's explicit install route (SHA-256 manifest) → real ONNX CPU inference **636 ms**, output **6,502-byte PNG (RGBA)** with a real alpha matte (sampled alpha range 0–255, 24 distinct values) |
| LAXII honesty gate | A subject-less test image was submitted deliberately: the lane **refused** with "no usable subject measured (subject fraction 0) — the matte would remove the whole image" — output validation works and never fabricates a result |

### 2.3 Live browser acceptance (this session — what IS verified, and what is environment-limited)

Verified live in a real (headless Chrome 158) browser against the running app, after the §1.2 fix:

- The AI Device panel now measures and reports **"WebAssembly: supported + SIMD"**; browser ML runtime: available; browser vision runtime: available (previously "unavailable" due to the malformed probe).
- The RIISHE **On-device toggle appears** — it renders only when the measured capability supports the lane (it did not exist before the fix).
- The device-compute **consent gate** works (one-time consent, existing UI, honest explainer text incl. "no shared/distributed compute path").
- The **download consent dialog** shows the real artifact size (468.6 MB), the license (Apache-2.0), and the decided lane's honest runtime wording (CPU/WASM light build) before any download.
- The **real download starts** through the SHA-256-gated bean-managed path and progresses (24% → 62% observed live).

**Environment limit (recorded honestly, twice, deterministic):** in this ~4 GB sandbox the browser tab is killed by the environment's memory ceiling at ~62% of the 491 MB in-browser download while the dev server runs in the same 4 GB. The full in-browser WASM chat turn therefore could not complete IN THIS SANDBOX; nothing about it is faked here. The lane's runtime protocol, context adaptation, cancellation, heap release, SHA-256 refusal and approval gate are covered by `tests/unit/wasm-chat-lane.test.ts` (16 tests) — explicitly unit-level contracts, not a substitute for a real browser run. The same-day implementation-session browser acceptance of the CPU/WASM lane is recorded in `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` §3; reproducing it requires a browser environment with normal memory headroom (the commands are in the matrix doc).

---

## 3. Privacy, security and resource protection (verified facts)

- Per-visitor isolation: a visitor's device executes only that visitor's own requested work; no background mining, no hidden compute sharing, no cross-user execution path exists in the codebase (consent explainer states it and the scheduler enforces consent + pagehide release).
- Download consent + integrity: every bean-managed model download requires explicit approval with the real size shown BEFORE approval, then a pinned SHA-256 gate; runtime-managed caches are refused by `requestDownload` instead of faking a checksum gate. Verified live (§2.3).
- No Ollama, no hidden paid API fallback, no hardcoded provider keys (secret scan of the branch diff clean; dormant credential slots skip honestly).
- Budgets: policy memory budgets per resource class (light 64 / medium 256 / heavy 1024 MB; conservative 32 / 96 / 384 MB), one heavy model at a time, device-task concurrency cap (2 normal / 1 conservative), per-task time budget, context length adapted to budget in the wasm chat lane; tasks never start while the tab is hidden; workers exit() and release heap when jobs finish; `releaseAll` on page hide.
- Provider identities, model IDs and internal routing stay out of the customer UI (M36-D identity hygiene re-verified; UI identity hygiene test green in the full suite).

## 4. Honest capability status after M39 (summary)

- **Operational (real output validated):** RIISHE chat/grounded-QA/vision/documents/tools; CODE GIFTZ generation + delivery + real sandbox execution; LAXII hosted gen/edit, sharp enhancement, MODNet matting, big-lama edit; JAZMII hosted video + local motion/RIFE; GANGZII local Kokoro TTS + hosted TTS/ASR round-trip + ffmpeg convert/production. Full table: `docs/ai/MODEL-EXECUTION-MATRIX-M39.md`.
- **Honest unavailability (never faked):** GPU Diffusers image worker (not deployed → 503); Wan self-hosted video (never implemented); scanned-image OCR, retrieval embeddings/reranking (not integrated — verbs reserved, no backend); credential-gated dormant lanes (OpenAI-compatible, Anthropic adapter, llama.cpp loopback — wire-protocol tested, dormant without operator credentials).
- **Hardware/browser-dependent (labeled, never claimed):** WebGPU chat lane (WebLLM) — requires a real WebGPU adapter + successful init; this sandbox has none ("WebGPU: API present, no adapter"). Full GPU-lane acceptance (RTX 5060 Ti, owner hardware) remains a pending hardware-dependent item — unit tests cover the GPU path with fake workers and honest-state contracts only.

## 5. Live preview

The real application (existing project configuration: `bun run dev`, port 3000) was launched from the merged tree + corrective fixes and kept available for interactive use in the preview panel. Verified in the live session: dashboard product cards with measured availability states; RIISHE chat (real gateway turn + on-device lane UI); LAXII edit lane (real MODNet matte + honest refusal); GANGZII narration engine (real install + synthesis); AI Device panel (measured probes, consent, honest runtime states). No new user-facing settings, toggles, model selectors, GPU/CPU switches, hardware modes or configuration panels were introduced anywhere.

## 6. Definition of Done

| Item | Status |
|---|---|
| Implemented | m39.1–m39.4 + corrective SIMD/dialog fix (§1) |
| Tested | Full suite **2797 pass / 0 fail / 5 skip** (212 files); 85-test targeted run over the touched lanes; new SIMD regression tests |
| Type-checked | `tsc --noEmit` — zero errors in touched files; pre-existing legacy baseline unchanged |
| Lint | eslint clean on all touched files |
| Prisma | `bunx prisma validate` valid |
| Build | `bun run build` success (pre-existing warnings only) |
| Security | Secret/security scan clean; no new env access; no hardcoded keys |
| Committed + pushed + remote-verified | Feature branch only; SHAs recorded in §1.1 and §1.2; remote SHA verified via `git ls-remote` after push (exact values in §8) |
| Merged into main | PRs #17/#18/#19 merged by the repository owner (authorized via GitHub merge); the corrective commit rides the feature branch |
| Live preview | Running from the real project configuration, verified in-browser (§5) |

## 7. Publication record (remote-verified)

- Corrective commit: **`e856d571e60181fc98d0ea81b40eee6dbabe9092`** (`feat(m39.5)` — SIMD probe root-cause fix + 4 regression tests + honest lane dialog + this report + phase plan + coverage addendum + worklog). Parent: `eff0d9692572df5477ad295228c823efa462d531`.
- Pushed as a normal fast-forward (`2c9c3e7..e856d57`); `git ls-remote origin feat/m39-universal-live-ai-runtime` returned exactly `e856d571e60181fc98d0ea81b40eee6dbabe9092`; GitHub commit page HTTP 200.
- `main` was NOT touched by this session — it holds the owner-authorized PR merges at `eff0d9692572df5477ad295228c823efa462d531`.

## 8. Remaining limitations (honest)

1. Real-GPU acceptance pass (WebGPU chat lane, WebGPU matting/ASR backends, GPU-failure→CPU fallback on hardware) — **pending owner hardware** (RTX 5060 Ti not reachable from this environment). Everything hardware-independent about the GPU path (capability checks, honest states, automatic fallback contracts) is test-verified.
2. In-browser WASM chat full turn — memory-limited in THIS sandbox (§2.3); reproducible on adequately provisioned browsers with the documented commands; unit-level contracts green.
3. OCR (scanned images), embeddings, reranking — not integrated (honest registry states; verbs reserved).
4. Credential-gated lanes (OpenAI-compatible, Anthropic, llama.cpp loopback) — dormant without operator-configured credentials, by design.
5. The 4 GB sandbox must run the test suite WITHOUT the dev server concurrently (one same-day OOM of the dev server recorded during implementation; sequential re-runs green) — an environment constraint, mirrored by the product's own visitor-device budget policies.
