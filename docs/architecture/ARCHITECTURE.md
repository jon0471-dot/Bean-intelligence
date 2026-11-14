# BEAN Intelligence — Architecture

**Version:** 1.0.0 · **Date:** 2026-10-24

## 1. Product identity separation (core principle)

```
Customer → RIISHE / LAXII / JAZMII / CODE GIFTZ   (BEAN product identity, public)
                ↓
        BEAN API (auth, quotas, validation)
                ↓
        PRIVATE ROUTER (src/lib/router)          (server-only)
                ↓
        Private backend registry (src/lib/registry/backends.ts)
                ↓
   Authorized hosted inference  |  (future) self-hosted GPU workers
                ↓
        Normalized BEAN response → Customer
```

Customers select **BEAN products**, never upstream models. The upstream mapping lives in
one private, server-only module. The customer-facing bundle (`/api/products`,
`src/lib/registry/products.ts`) contains no provider names, model ids or endpoints.
Enforcement is server-side (routing + RBAC), not CSS hiding.

## 2. Module map (requested monorepo → implemented layout)

The deployment target is a single-port Next.js 16 application, so the requested monorepo
is realized as clearly separated modules inside one repo (spec §7 allows adaptation with
preserved separation of responsibilities):

| Requested | Implemented as |
| --- | --- |
| `apps/web` | `src/app/page.tsx` + `src/components/bean/*` (SPA, all customer views) |
| `services/api` | `src/app/api/**` route handlers (auth, products, usage, health, admin) |
| `services/riishe` | `src/app/api/riishe/*` + `src/lib/adapters/hosted-llm.ts` |
| `services/laxii` | `src/app/api/laxii/*` + `src/lib/adapters/hosted-image.ts` + `src/lib/jobs/queue.ts` |
| `services/jazmii` | `src/app/api/jazmii/*` + truthful-adapter architecture (`src/lib/adapters/video-adapter.ts`) |
| `services/code-giftz` | `src/app/api/code-giftz/*` + `src/lib/sandbox/runner.ts` |
| `packages/product-registry` | `src/lib/registry/products.ts` (public) + `backends.ts` (private) |
| `packages/api-contracts` | `src/lib/api/*` (zod schemas, error codes, envelopes) |
| `packages/authentication` | `src/lib/auth/*` (scrypt, sessions, rate limits, quotas) |
| `packages/observability` | `src/lib/observability/*` (structured logs, metering, audit) |
| `infrastructure/` | `docs/operations/OPERATIONS.md` + deployment notes (single-node now) |
| `models/manifests` | `models/manifests/*.json` (verified manifests + probe evidence) |
| `models/licenses` | `models/licenses/` + `docs/models/LICENSING-REPORT.md` |
| `tests/` | `tests/unit/*.test.ts` + browser E2E (see docs/TEST-REPORT.md) |

## 3. Routing rules (implemented in `src/lib/router/router.ts`)

1. Resolve requested BEAN product + task.
2. Check availability (registry `enabled` flags).
3. Enforce sliding-window rate limits + durable daily quotas (DB-backed).
4. Acquire concurrency slots (per-user and total, in-flight).
5. Select the enabled backend; fallback only via explicit `fallbacks` lists.
6. Validate the request against the backend's real limits (e.g. prompt caps, sizes).
7. Execute with timeouts (`withTimeout`); normalize responses into BEAN envelopes.
8. Record actual usage; `costMicros` stays null when the provider reports none.
9. On failure: truthful error codes — never fabricated success, never fake fallbacks.
10. `NO_BACKEND` / `PRODUCT_UNAVAILABLE` returned when nothing suitable exists (JAZMII today).

## 4. Async job pipeline (LAXII; JAZMII-ready)

- `POST /api/laxii/generate` → validates → creates `GenerationJob` (status `queued`) →
  `202` with job id.
- `src/lib/jobs/queue.ts` worker picks up the job, marks `running`, calls the adapter,
  stores the artifact under `storage/laxii/<userId>/<jobId>.jpg`, marks `completed` ONLY
  when real bytes exist (JPEG magic verified) — otherwise `failed` with a safe message.
- Polling: `GET /api/laxii/jobs/:id` and history `GET /api/laxii/generate`.
- Delivery: `GET /api/laxii/images/:id` re-checks ownership on every byte served.
- Scaling note: in-process queue today; swap for a durable queue (DB/Redis) without API
  changes when going multi-node.

## 5. Data model (Prisma/SQLite)

`User` (scrypt hash, role) · `Session` (opaque tokens, httpOnly cookie) ·
`Conversation`/`Message` (RIISHE history) · `GenerationJob` (products' async jobs,
truthful statuses) · `UsageRecord` (metering; cost null when unreported) ·
`AuditLog` (sensitive actions).

## 6. Truthfulness guarantees

- A product is marked Operational in the UI only if its backend is enabled AND its
  health probe passes (`/api/health` performs live probes).
- JAZMII requests are recorded as `unsupported` — visible in history — never as
  queued/running/completed.
- Token counts are stored as clearly-labeled estimates; cost figures are never invented.
- Partial SSE streams are labeled "Incomplete" in the UI.
- Sandbox output is shown verbatim, pass or fail.

## 6a. Shared research gateway (Agent Reach + Obscura — additive, 2026-11-14)

One server-only research gateway, two products consume it:

- `src/lib/research/reach/` — the Agent Reach adapter (typed envelope, allowlisted
  commands, per-user rate limiting, audit, health probes), the source capability
  registry (`available / requires_configuration / requires_login / experimental /
  unavailable / disabled` — measured, never assumed from source presence), the
  deterministic invocation planner (≤3 per research turn, channel-relevance gated),
  the URL-safety/SSRF guard and the prompt-injection scanner for retrieved content.
- `src/lib/research/browser/obscura.ts` — the OPTIONAL JavaScript-rendering backend
  (CLI mode; text/links/HTML extraction, screenshots). Every operation honestly
  reports unavailability; the gateway keeps working without it.
- RIISHE: the reach lane merges into the existing research pipeline AFTER the
  gateway search volley (same ranking, per-source provenance stamped post-rank);
  page reads gain an Agent Reach → Obscura fallback BETWEEN the gateway reader and
  the direct fetch. Evidence framing, citation auditing and the SSE contract are
  unchanged (additive metadata only).
- CODE GIFTZ: `src/lib/intel/techdocs-reach.ts` enriches the existing bounded
  tech-docs lane with allowlisted GitHub reads/searches when the request references
  repositories; artifacts persist additively in `CodeMessage.metaJson.research`.
  The sandbox approval gate and task modes are untouched.

Agent Reach is a retrieval toolkit, NOT a model or provider: model selection,
inference, fallbacks and verification remain entirely with the BEAN model gateway.

## 7. Deployment modes

- **Mode A (self-hosted inference):** planned path documented in the model evaluation
  report (vLLM for LLM tiers; diffusers/worker for Wan2.2). Requires GPU infrastructure;
  nothing is claimed as deployed.
- **Mode B (authorized hosted inference):** active for LLM + image tasks via provider
  adapters. Credentials stay server-side (platform runtime-managed); no secret ever
  reaches the browser bundle.
- Mixed operation is the design default: the router treats each backend independently.
