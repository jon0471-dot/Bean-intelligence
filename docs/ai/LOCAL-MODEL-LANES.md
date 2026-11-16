# LOCAL MODEL LANES — RIISHE + CODE GIFTZ (llama.cpp)

Status: **LIVE on this deployment host** (2026-11-08). The hosted gateway stays
the primary; the local lanes are the automatic fallback when the gateway is
rate-limited — local inference consumes NO hosted-provider quota.

## What actually runs locally

| Lane | Product | Model (Apache-2.0) | Port | Measured RSS | Measured speed |
|---|---|---|---|---|---|
| chat | RIISHE | Qwen3-1.7B Q4_K_M GGUF (bartowski conversion of official Qwen weights) | 127.0.0.1:8081 | ~2.3 GB (mostly file-backed) | ~10–15 tok/s |
| code | CODE GIFTZ | Qwen2.5-Coder-1.5B-Instruct Q4_K_M GGUF (official Qwen release) | 127.0.0.1:8082 | ~1.3 GB | ~10–15 tok/s |

Runtime: llama.cpp `llama-server` b12198 (CPU, AVX2/AVX512, 2 threads,
`-ctk/-ctv q8_0`, `-b 256 -ub 256`). **No Ollama** (policy).

Real-execution evidence (scripts/model-lanes-acceptance.ts, JSONL in
scripts/model-lanes-out/):

- RIISHE streams a real local reply through `/api/riishe/chat` (SSE), the
  conversation persists, and UsageRecord rows attribute
  `bean-chat-local-llamacpp` (the hosted gateway is not consumed).
- Real Tamil generation verified (Tamil-script output, multi-sentence).
- CODE GIFTZ generates Python via `codeTask` and the generated file EXECUTES
  in the real sandbox: exit 0, stdout `BEAN-LOCAL-OK`.

## Architecture

- Adapter: `src/lib/providers/llamacpp.ts` — OpenAI-compatible client,
  own breaker class (`chat-llamacpp`), Qwen3 thinking disabled
  (`chat_template_kwargs.enable_thinking=false`), leading system prompt
  mapped to role `system` (Qwen3 template requirement), 180 s local timeout
  floor (cold 2.5k-token prompt processing exceeds the inherited hosted 90 s
  budget on 2 cores).
- Lane manager (same file): `ensureLaneServer()` adopts a running server or
  spawns one as a DETACHED child; RAM-gated via `detectHardware()` (a spawn
  that would push the host into OOM is refused with the measured reason);
  bounded to 3 spawns/hour/lane; 20 s start deadline.
- Fallback chain: hosted → operator OpenAI-compatible slot (dormant) → local
  llama.cpp. Each candidate is attempted at most once per request; a 429
  never causes duplicate submissions.
- Hardware probe fix: `gpu.ts` now uses `/proc/meminfo` MemAvailable
  (`os.freemem()` reports MemFree = 201 MB here vs 2.1 GB actually
  available — it wrongly refused every spawn).

## Operations

```bash
# App (production standalone; dev server was OOM-killed twice at 2.3/3.1 GB RSS)
scripts/start-prod.sh          # exports all BEAN_LLAMACPP_* vars; port 3000

# Model servers (auto-started on demand by the lane manager; manual start only
# needed for pre-warming):
MALLOC_ARENA_MAX=2 /home/z/bean-models/bin/llama-server \
  -m /home/z/bean-models/Qwen3-1.7B-Q4_K_M.gguf --host 127.0.0.1 --port 8081 \
  --ctx-size 4096 -b 256 -ub 256 -ctk q8_0 -ctv q8_0 --threads 2

# Rebuilds: STOP the model servers first — a resident model server + the
# build worker exceed this 3.9 GB host (measured: postcss worker OOM-killed).
pkill -f llama-server && bun run build && scripts/start-prod.sh
```

Env (also in `.env.local` for dev parity): `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1`
(SSRF opt-in), `BEAN_LLAMACPP_BASE_URL`, `BEAN_LLAMACPP_CODE_BASE_URL`,
`BEAN_LLAMACPP_MODEL_PATH`, `BEAN_LLAMACPP_CODE_MODEL_PATH`, `BEAN_LLAMACPP_BIN`,
`BEAN_LLAMACPP_LOG_DIR`, optional `BEAN_LLAMACPP_DEBUG_PROMPTS=1`.

Weights live OUTSIDE the repo (`/home/z/bean-models/`) — a multi-GB binary
directory inside the project breaks Turbopack's build trace (deterministic
CSS worker panic, measured).

## Measured limits (honest)

- **Multi-turn recall degrades under the full product prompt.** The history
  IS delivered (debug evidence: the request carries prior turns; raw model
  recalls `GOLDEN CANYON` perfectly with a short prompt), but Qwen3-1.7B
  parrots the previous reply under the 10,040-char RIISHE protocol prompt
  (replayed the exact captured request at temperature 0.0 — same result).
  This is a model-capacity limit, not a pipeline defect. Next actions:
  larger local model (needs RAM/GPU), or a condensed local-mode system
  prompt (product decision).
- **Cold-turn latency**: first prompt processing after server start takes
  ~60–120 s on 2 cores (warm turns ~5–40 s). The 180 s local floor covers it.
- This host: 2 vCPU, 3.9 GB RAM, no GPU, ~3 GB free disk.

## What stays hardware-gated (honestly unavailable here)

- **LAXII generative inpainting** (`bean-image-selfhosted-diffusers`): worker
  v0.3.1 ships complete (inpaint/txt2img/upscale/lama via stdio JSON) with a
  strict preflight. Live preflight on this host: `ok=false` — torch/diffusers
  etc. missing, no CUDA, 3.28 GB free disk vs 12 GB required, 0/9 checkpoints.
  Hosted conversational editing + deterministic Sharp preservation remain the
  live LAXII paths.
- **JAZMII self-hosted video** (`bean-video-selfhosted-candidate`, Wan2.2
  TI2V-5B): scaffold prepared (`workers/wan22/` — config + honest preflight).
  Measured preflight fails every gate here (no CUDA, 3.9 GB RAM vs ≥24 GB,
  3.3 GB disk vs ≥30 GB). The hosted video lane remains JAZMII's live backend
  and is not downgraded. Enablement path: operator GPU host (RTX 5060 Ti 16 GB
  class) → preflight pass → real 10 s render acceptance → then enable.
