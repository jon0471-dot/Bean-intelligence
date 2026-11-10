# BEAN Intelligence

**Brand-owned AI platform · multi-model backend · self-hosted + authorized hosted inference.**

BEAN Intelligence owns its customer-facing products, experience, routing and application
layer. Inference is provided by appropriately licensed backends — an authorized hosted
gateway today, self-hosted GPU workers as a designed-for path. BEAN does **not** claim
upstream foundation models as its own, does not expose upstream model catalogues to
customers, and does **not** fabricate availability, outputs, token counts, costs or
benchmarks.

## The four flagship products (fixed)

| Product | Purpose | Status in this deployment |
| --- | --- | --- |
| **RIISHE** | Conversational AI — chat, reasoning, summarization, writing, multilingual, structured output | ✅ Operational (real inference, SSE streaming) |
| **LAXII** | Image generation studio — prompts → downloadable images, live job status | ✅ Operational (real inference, ~60 s per image, JPEG output) |
| **JAZMII** | Video generation engine — async jobs, previews, export | ⛔ Truthfully unavailable — no licensed video backend deployed; requests are rejected, never simulated |
| **CODE GIFTZ** | Coding AI — generate/explain/review/plan + restricted sandbox execution | ✅ Operational end-to-end (real LLM + real sandbox, explicit-run approval) |

Availability is **measured, not assumed**: the dashboard reflects live backend probes.

## Quick start

```bash
bun install
bun run db:push      # initialize SQLite schema
bun run dev          # http://localhost:3000
```

The first registered account becomes the platform administrator (documented bootstrap
rule — see docs/security/SECURITY.md). Then: sign in → Dashboard → open any product.

## Repository layout

```
src/app/                    UI (single-page app) + /api route handlers
src/lib/registry/           PUBLIC product catalog + PRIVATE backend registry (server-only)
src/lib/router/             private routing layer (auth, quotas, capability checks, fallbacks)
src/lib/adapters/           provider adapters (LLM w/ SSE, image, truthful video stub)
src/lib/jobs/               async job queue (long-running generation)
src/lib/sandbox/            CODE GIFTZ restricted execution sandbox
src/lib/auth/               scrypt credentials, sessions, rate limits, quotas
src/lib/observability/      structured logs, usage metering, audit trail
models/manifests/           verified model/checkpoint manifests + probe evidence
models/licenses/            licensing evidence + review records
docs/architecture/          ARCHITECTURE.md
docs/security/              SECURITY.md (incl. sandbox isolation model + limits)
docs/operations/            OPERATIONS.md (env, runbook, troubleshooting)
docs/api/                   API.md (implemented vs planned endpoints)
docs/models/                MODEL-EVALUATION-REPORT.md, LICENSING-REPORT.md
docs/TEST-REPORT.md         executed tests with real results (PASS/BLOCKED)
tests/unit/                 unit tests
.env.example                variable names only — no secrets
```

## Core guarantees

1. **Brand-owned products, private backend.** Customers pick RIISHE/LAXII/JAZMII/CODE
   GIFTZ — never GPT-x, Claude, Qwen, Flux or any upstream id. Mapping lives server-side
   in `src/lib/registry/backends.ts`; enforced by routing and RBAC, not CSS.
2. **Truthful status only.** Jobs reach `completed` only when real artifacts exist
   (magic-byte checked). Unavailable products say so. Partial streams are labeled.
   Token counts are estimates; cost fields stay `null` when providers report none.
3. **Server-side controls.** Auth, ownership, rate limits, daily quotas, concurrency and
   capability validation all happen in the API layer.
4. **No Ollama dependency.** Adapters target the authorized gateway (today) and
   standard serving runtimes (vLLM-class, documented for future self-hosting).
5. **Sandboxed execution with explicit approval.** Generated code runs only after the
   user presses "Run in sandbox", in an isolated child process with timeout and minimal
   environment. Limitations documented honestly (SECURITY.md §6).

## Documentation index

- Architecture: `docs/architecture/ARCHITECTURE.md`
- API reference: `docs/api/API.md`
- Security & privacy: `docs/security/SECURITY.md`
- Operations & troubleshooting: `docs/operations/OPERATIONS.md`
- Model evaluation (with sources + dates): `docs/models/MODEL-EVALUATION-REPORT.md`
- Licensing review: `docs/models/LICENSING-REPORT.md`
- Test report (real executions, incl. BLOCKED items): `docs/TEST-REPORT.md`

## Known limitations (honest register)

- **JAZMII** requires a licensed GPU deployment path (candidate: Wan2.2, Apache-2.0 —
  verified); until then the product reports unavailable and rejects jobs.
- **LAXII** output is JPEG and takes ~60 s per image (measured gateway behavior).
- **CODE GIFTZ sandbox** is process-level isolation; container hardening is required for
  untrusted multi-tenant scale.
- **Single-node queue**; swap `src/lib/jobs/queue.ts` for a durable queue to scale out.
- Token usage is estimated; provider cost data is not reported and is never invented.
