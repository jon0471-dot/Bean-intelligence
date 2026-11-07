# BEAN — Worker Operations

> Runbook for the background AI execution workers. Everything here is live: the embedded engine starts with the server; standalone workers are optional.

## 1. Embedded engine (default)

Started automatically by `src/instrumentation.ts` when the Next.js server boots:

```
engine.pool_started product=riishe      kind=embedded concurrency=2
engine.pool_started product=laxii       kind=embedded concurrency=2
engine.pool_started product=jazmii      kind=embedded concurrency=2
engine.pool_started product=code-giftz  kind=embedded concurrency=2
engine.embedded_started
```

Disable with `BEAN_ENGINE_EMBEDDED=0` (e.g. when running dedicated workers).

On every boot each pool runs `recoverStaleJobs()`: jobs whose lease expired while active (crashed worker / killed server) are re-queued (`RETRY_WAIT`) or failed honestly (`WORKER_LOST`) when the attempt budget is exhausted. Recovery also re-runs every 60s.

## 2. Standalone workers (optional, per product)

```bash
bun run worker -- --product riishe        # one product
bun run workers                           # all four pools in one process
bun run worker -- --product laxii --concurrency 1
```

Standalone workers can run **beside** the embedded engine: claims are CAS'd in SQLite, first claim wins, leases recover crashes. For a dedicated GPU host: set `DATABASE_URL`, run `bun run worker -- --product laxii` there — the worker needs no HTTP port (LAXII's Python worker is spawned as a child with stdin/stdout JSON-lines).

Graceful stop: SIGINT/SIGTERM — in-flight jobs finish, then the process exits.

## 3. Free-local llama.cpp lane (RIISHE / CODE GIFTZ)

1. Install llama.cpp (release binary or source build) — https://github.com/ggml-org/llama.cpp — **not Ollama**.
2. Pick an open-weight GGUF and respect its license (Qwen3 = Apache-2.0; Dolphin 2.9.2 = tongyi-qianwen; verify the card). Example: `llama-server -m Qwen3-4B-Q4_K_M.gguf --port 8081 --host 127.0.0.1` (add `-ngl N` for CUDA offload).
3. Configure BEAN (server env):
   - `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` (SSRF-guard opt-in for loopback)
   - `BEAN_LLAMACPP_BASE_URL=http://127.0.0.1:8081/v1`
   - optional: `BEAN_LLAMACPP_MODEL=<id>`, `BEAN_LLAMACPP_API_KEY=<key>` (llama-server usually needs none)
4. Restart BEAN. The registry entry `bean-chat-local-llamacpp` becomes enabled; health verifies a REAL completion before it serves. It joins the chat/coding fallback chain (attempted only on upstream-class failures of the primary, never silently).

## 4. Local Diffusers worker (LAXII masked editing / generation)

Deployed on the GPU host per `workers/laxii-diffusers/README.md`:

```bash
python worker/local/download_models.py --accept-licenses   # prints licenses, records SHA-256
python worker/worker.py --models-dir ./models              # JSON-lines on stdin/stdout
python worker/local/run_acceptance.py                      # real inference acceptance
```

- Node side spawns it on demand (`LAXII_WORKER_PYTHON`, `LAXII_WORKER_MODELS_DIR`).
- Preflight gates: CUDA present, ≥6 GB free VRAM, licenses accepted, checksums verified.
- Idle unload: `LAXII_WORKER_IDLE_UNLOAD_MS` (default 600000) — busy-lock-guarded, never mid-generation.
- Enablement rule: flip `bean-image-selfhosted-diffusers` to enabled **only** after a recorded ACCEPTED acceptance run in `worklog.md`.

## 5. Job lifecycle operations

| Task | How |
|---|---|
| Watch queue | `GET /api/admin/overview` → `engine.activeQueue` (admin), or query `GenerationJob` |
| Submit background job | `POST /api/ai/jobs {"product":"riishe"|"code-giftz","message":"…"}` |
| Watch a job | `GET /api/ai/jobs/[id]/events` (SSE, `?since=<seq>` to resume) |
| Cancel | `POST /api/ai/jobs/[id]/cancel` |
| Restart safely | Just restart the server — jobs survive (durable rows + leases). Verify recovery lines `engine.recovery {requeued, failed, cancelled}` in the log. |
| Tune | `BEAN_ENGINE_LEASE_MS` (default 120s), `BEAN_ENGINE_HEARTBEAT_MS` (lease/4), `BEAN_ENGINE_MAX_ATTEMPTS` (2), `BEAN_ENGINE_POLL_MS` (1.5s), `BEAN_ENGINE_CONCURRENCY_*`, `BEAN_ENGINE_PER_USER_ACTIVE` (3), `BEAN_ENGINE_EVENT_RETENTION_HOURS` (72) |

## 6. Incident notes

- **A 429 from a provider is terminal for that job.** Do not add retries for throttled accounts; the breaker + honest failure is the contract. Fallbacks (credential-gated) may serve instead.
- **WORKER_LOST** in `errorClass` means a lease expired mid-run; attempt budget then decides requeue vs. honest failure.
- **Event log pruning**: events of terminal jobs are deleted after 72h (results persist in the job row; raise `BEAN_ENGINE_EVENT_RETENTION_HOURS` if longer replay is needed).
