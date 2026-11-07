# BEAN — Background AI Execution Architecture

> Status: implemented and running. Last verified: 2026-11-07 (regression 1102/0/70; live engine acceptance in `scripts/ai-engine/out/`).

One BEAN backend. Four independent AI products (RIISHE · LAXII · JAZMII · CODE GIFTZ). Every job can continue after the user leaves the page; every result is persisted and retrievable. Model routing is internal — there is **no model-selection UI** anywhere in BEAN.

## 1. Why

Before this engine, asynchronous product work (LAXII/JAZMII) was executed **fire-and-forget inside whichever HTTP process received the submit request** (`enqueueJob` → inline `await`). Consequences:

- a server restart killed in-flight jobs (only JAZMII had partial re-attach logic);
- chat/coding had **no** background mode at all — closing the browser lost the turn;
- there was no unified job API, event log, cancel semantics or worker isolation.

The engine replaces the execution substrate while **preserving every product interface byte-for-byte** (route paths, request/response shapes, status vocabulary — see §7).

## 2. Components

```
┌────────────── product surfaces (UNCHANGED) ───────────────┐
│ /api/riishe/chat  /api/code-giftz/chat  (live SSE, kept)  │
│ /api/laxii/generate|enhance|edit   /api/jazmii/generate   │
│ /api/ai/jobs  (NEW universal background submission)       │
└──────────────────────┬────────────────────────────────────┘
                       │ GenerationJob rows (durable, SQLite)
┌──────────────────────▼────────────────────────────────────┐
│  AI ENGINE (src/lib/ai-engine/)                           │
│  queue.ts    CAS claims · leases · heartbeats · recovery  │
│  events.ts   append-only per-job event log (JobEvent)     │
│  handlers.ts task → real processor (shared product cores) │
│  runner.ts   worker pools (embedded + standalone)         │
│  gpu.ts      CUDA/VRAM/RAM/disk detection + VRAM budget   │
│  model-registry.ts  capability/hardware/cost declarations │
│  config.ts   env-tunable, clamped knobs                   │
└──────┬───────────────────────────┬────────────────────────┘
       │                           │
 EMBEDDED POOLS              STANDALONE WORKERS
 (Next.js server process,    (scripts/ai-workers/worker.ts
  started by instrumentation) one process per product; CAS
  BEAN_ENGINE_EMBEDDED=0      claims make both shapes coexist
  disables)                   safely — first claim wins)
```

### A. Job API (Phase 3A)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ai/jobs` | POST | Submit a background job (chat / coding-task today; LAXII & JAZMII keep their own submit routes). Returns a **persistent job id immediately** (HTTP 202). |
| `/api/ai/jobs` | GET | Owner-scoped job history across all four products. |
| `/api/ai/jobs/[id]` | GET | Status + result + event count (IDOR-safe, owner-checked). |
| `/api/ai/jobs/[id]/events` | GET | **SSE**: replay the event log from any `?since=` cursor, then tail live. Terminal frame closes the stream. |
| `/api/ai/jobs/[id]/cancel` | POST | Queued → CANCELLED immediately; running → cooperative signal (worker unwinds at the next checkpoint). |

Security: session auth, owner checks on every read, per-user active-job caps, duplicate-submission guard (payload hash while active → 409), provider/model identities never exposed.

### B. Persistent job queue (Phase 3B)

**Redis + BullMQ was evaluated and not adopted**: the runtime has no Redis service and BEAN must not purchase infrastructure; the application database **is** the existing infrastructure. SQLite transactions give exactly-once claims via conditional updates (`updateMany` CAS), and queue state is durable rows, not process memory. The lease/takeover protocol provides what BullMQ's stalled-job checker provides. Swap points are documented (`src/lib/jobs/queue.ts`) if a multi-node deployment ever justifies Redis.

Claim protocol (crash-safe):

1. Worker CAS-claims a claimable row (`queued` or due `retry_wait`): status → `starting`, `workerId`/`leaseUntil`/`attempts` stamped atomically.
2. Worker heartbeats (lease extended) while the handler runs.
3. Worker death → lease expires → **recovery** re-queues the job (`RETRY_WAIT`, up to `maxAttempts`) or fails it honestly (`WORKER_LOST`).

Jobs survive application restarts because both the queue state and the event log are database rows; recovery runs at every pool start and every 60s.

### C. Independent workers (Phase 3C)

Four pools with independent concurrency (`BEAN_ENGINE_CONCURRENCY_<PRODUCT>`): RIISHE chat, LAXII image, JAZMII video, CODE GIFTZ coding. Each handler reuses the product's REAL core:

- `chat` → `orchestrateTurn` (same orchestrator as live RIISHE: understand → retrieve → tool loop → solve → verify → respond), assistant message persisted identically; memory commands run the **shared** `memory-actions` core.
- `coding-task` → `runGiftzTurnCore` (shared with the live route: controlled continuation, self-verification, file-fence extraction with real diffs, same persistence).
- `image-generation` / `image-enhancement` / `image-editing` → the existing LAXII processors, unchanged.
- `video-generation` → the existing JAZMII processor (submit → 429-safe bounded polling → server-side download + magic-byte validation → storage).

Concurrency/resource limits: per-pool concurrency, per-user active caps, per-user+product rate limits and daily quotas at submission, operator request budgets (`BEAN_DAILY_REQUEST_BUDGET_*`) also enforced in workers.

### D. Job states (Phase 3D)

`QUEUED → STARTING → RUNNING → STREAMING? → FINALIZING → COMPLETED`, plus `FAILED`, `CANCELLED`, `RETRY_WAIT`. Extended states are normalized to the legacy vocabulary (`queued|running|completed|failed`) **at the product API boundaries**, so existing product UIs needed zero status-handling changes. A `rate_limited` failure is terminal **by protocol** — a throttled account is never re-hit automatically.

### E. Progress & events (Phase 3E)

Every job has an append-only `JobEvent` log (`delta | reset | stage | progress | research | tool | notice | error | artifact`). Chat/coding stream partial text into it; LAXII/JAZMII stream progress. The SSE endpoint replays from any cursor — a client can connect late, disconnect, or never connect; results persist regardless. Event retention is pruned after 72h for terminal jobs (results live in the job row).

### F. Persistent results (Phase 3F)

Persisted per job: job id, user id, product id, capability, **internal** provider/model identifiers (admin-only), timestamps, status, error classification (`errorClass`: rate_limited/auth/billing/timeout/network/worker_lost/permanent/budget/cancelled), usage (tokens/images/duration; cost stays `null` when the provider reports none), artifact locations (`storage/<product>/<userId>/…`, always served through owner-checked routes).

Schema changes were **additive only** (engine columns on `GenerationJob` + new `JobEvent` table; DB backed up first: `db/custom.db.backup-20261107-engine.db`). No destructive operations.

## 3. Model routing (Phase 4)

`src/lib/ai-engine/model-registry.ts` declares, per model/adapter: product compatibility, supported capabilities, input/output formats, context/resolution limits, max duration, hardware requirements, cost class, availability. The router:

1. selects a compatible authorized backend (existing private registry `src/lib/registry/backends.ts`);
2. checks its circuit breaker + operator budget;
3. selects an eligible local worker **only** when the hardware gate fits (measured, not assumed);
4. queues the request; 5. executes in the background worker; 6. persists the result; 7. the frontend subscribes (or just reads history later).

Hard invariants: never silently substitute an incompatible model; never send a video task to an image-only model; never send masked editing to a model without editing support; never run a local model whose hardware does not fit. Chat fallback chain (each credential-gated, audit-logged): hosted gateway → operator OpenAI-compatible slot → free-local llama.cpp.

## 4. GPU resource scheduler (Phase 5)

`src/lib/ai-engine/gpu.ts` measures reality: `nvidia-smi` probes (GPU name, total/free VRAM), CPU count, RAM, free disk (60s cache). A VRAM reservation map prevents simultaneous GPU jobs from exhausting the card; the LAXII Diffusers worker loads models on demand, keeps ONE pipeline resident, and (new) **auto-unloads after `LAXII_WORKER_IDLE_UNLOAD_MS` (default 10 min)** guarded by a busy-lock so it never unloads mid-generation.

This deployment host: **no CUDA GPU** (measured) → every local GPU model is honestly `unavailable` here. The operator PC (Ryzen 7, RTX 5060 Ti 16 GB, 32 GB RAM): Wan 2.2 **TI2V-5B** is feasible (fp16 peak ≈ 11 GB, measured community figures; official card: "runs on consumer-grade graphics cards like the 4090") but has **no worker implementation and no acceptance run** — it stays disabled until both exist. Wan A14B variants do not fit 16 GB at fp16. GLM-class hosted chat needs no tenant GPU. See `docs/ai/GPU-RESOURCE-PLAN.md`.

## 5. Free-first policy (Phase 2)

Every integration is classified (`docs/ai/FREE-AND-PAID-PROVIDER-MATRIX.md`): `free-local` / `free-hosted` / `limited-free` / `paid-api` / `unavailable`. Rules honored: no invented free APIs; an open-source repo ≠ free hosted compute; no ChatGPT/Claude cookie extraction or browser automation; no rate-limit bypass; no purchases without approval; no Ollama.

## 6. Testing (Phase 8)

- **Unit** (`tests/unit/ai-engine-queue.test.ts`, +17 cases): CAS claims, leases, retry policy (429 never retried), cancel settlement, recovery takeover, event log monotonicity, dedupe, status normalization. Full regression: **1102 pass / 0 fail / 70 files**.
- **Live** (`scripts/ai-engine/acceptance.ts`): real submissions through the engine; throttled steps are recorded honestly as unavailable (never retried into fake successes).
- **Background persistence**: submit → leave/refresh → restart server → recovery + workers resume → artifact retrievable. Leases/recovery are unit-tested; the live restart flow is documented in `docs/ai/WORKER-OPERATIONS.md`.

## 7. Preserved interfaces (strict rules honored)

- Product routes, request/response shapes and status vocabulary: unchanged (extended states normalize at the boundary).
- Working providers: unchanged (z-ai gateway still primary everywhere).
- No Ollama; no fake responses; no fabricated artifacts; no uncontrolled spending; no rate-limit bypass; no destructive DB operations; no Git history rewriting.
- Capabilities are marked operational **only with real acceptance evidence** (`docs/ai/REAL-MODEL-ACCEPTANCE.md`).
