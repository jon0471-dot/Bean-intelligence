# BEAN Intelligence — API Reference

Base URL: the deployment origin. All responses use the BEAN envelope:

```json
{ "ok": true,  "...payload": "..." }
{ "ok": false, "error": { "code": "STABLE_CODE", "message": "customer-safe text" } }
```

Error codes: `UNAUTHENTICATED 401 · FORBIDDEN 403 · NOT_FOUND 404 · VALIDATION_ERROR 400
· RATE_LIMITED 429 · QUOTA_EXCEEDED 429 · CONCURRENCY_LIMIT 429 · PRODUCT_UNAVAILABLE 503
· NO_BACKEND 503 · BACKEND_TIMEOUT 504 · BACKEND_FAILURE 502 · CAPABILITY_UNSUPPORTED 422
· SANDBOX_DENIED 403 · INTERNAL_ERROR 500`.

Auth: session cookie `bean_session` (httpOnly). Endpoints marked 🔒 require it; 🛡️
require the admin role. The `/api/v1` gateway additionally accepts application
API keys (`Authorization: Bearer bgk_…`) where noted below.

---

## Implemented endpoints

### Auth & account
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email, password, name?}`. First account → admin. |
| POST | `/api/auth/login` | Rate-limited 10/min/IP; uniform error (no enumeration). |
| POST | `/api/auth/logout` | Destroys server-side session. |
| GET | `/api/auth/session` | Current user or `null`. |
| PATCH | `/api/account/settings` 🔒 | Rename and/or change password (requires current password). |
| DELETE | `/api/account/settings` 🔒 | `{password}` — deletes account + cascades data. |

### Discovery & health
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/products` | Public catalog: BEAN products, availability, LAXII sizes. No upstream metadata. |
| GET | `/api/health` | Live probes per product (measured, not assumed). |

### RIISHE (conversational)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/riishe/chat` 🔒 | `{message, conversationId?}` → JSON. Add `?stream=1` for SSE: `data: {delta}` frames then `data: {done}`. Partial streams carry `partial:true`/error frame — never presented as complete. |
| GET | `/api/riishe/chat` 🔒 | Conversation list. |
| GET | `/api/riishe/conversations/:id` 🔒 | Full history (owner-only). |
| DELETE | `/api/riishe/conversations/:id` 🔒 | Delete (owner-only). |

### LAXII (image generation)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/laxii/generate` 🔒 | `{prompt(≤4000), size∈7 allowed}` → `202 {job}` (async). |
| GET | `/api/laxii/generate` 🔒 | Job history (statuses: queued/running/completed/failed — as-is). |
| GET | `/api/laxii/jobs/:id` 🔒 | Poll one job (owner-only). |
| GET | `/api/laxii/images/:id` 🔒 | Authenticated JPEG delivery (owner + completed check per request). |

### JAZMII (video generation)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/jazmii/generate` 🔒 | Currently **rejected with `rejected:true, code:"NO_BACKEND"`** and a truthful message; the request is recorded as an `unsupported` job. |
| GET | `/api/jazmii/generate` 🔒 | Availability statement + history. |
| GET | `/api/jazmii/jobs/:id` 🔒 | Poll one job. |

### CODE GIFTZ (coding AI)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/code-giftz/tasks` 🔒 | `{mode: generate\|explain\|review\|plan, prompt, language?, codeContext?}` → completed task with `files[]` (generate mode). |
| GET | `/api/code-giftz/tasks` 🔒 | Task history. |
| GET | `/api/code-giftz/tasks/:id` 🔒 | One task (owner-only). |
| POST | `/api/code-giftz/run` 🔒 | `{taskId, approval:true}` — explicit approval REQUIRED. Returns real `stdout/stderr/exitCode/timedOut/durationMs`. |

### Usage & admin
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/usage` 🔒 | Per-product rollup, quotas, recent activity. Tokens are estimates; cost always "not reported". |
| GET | `/api/admin/overview` 🛡️ | Private backend registry (provider, model identity, license, limits, probes), stats, audit trail. |

### BEAN Gateway API (`/api/v1`) — unified AI model gateway

Full narrative reference: [`docs/api/GATEWAY-API.md`](./GATEWAY-API.md).
Machine-readable contract (OpenAPI 3.1, implemented endpoints only):
[`docs/api/openapi.yaml`](./openapi.yaml).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | public | Gateway liveness + measured probes per model class. |
| GET | `/api/v1/models` | session or key (`models:read`) | Unified model catalogue (public-safe projection). |
| GET | `/api/v1/providers` | session or key (`providers:read`) | Provider overview with measured health. |
| GET | `/api/v1/usage` | session or key (`usage:read`) | 30-day usage rollups; admin sessions get gateway-wide aggregates. Cost always `null` (never invented). |
| POST | `/api/v1/chat/completions` | session or key (`chat:completions`) | JSON or SSE (`stream:true`). OpenAI-style field names accepted. |
| POST | `/api/v1/keys` | 🛡️ admin session only | Create key — complete key shown EXACTLY once. |
| GET | `/api/v1/keys` | 🛡️ admin session only | Key list (fingerprint + metadata only, no secrets). |
| DELETE | `/api/v1/keys/:id` | 🛡️ admin session (owner) | Revoke — immediate and permanent. |
| POST | `/api/v1/keys/:id/rotate` | 🛡️ admin session (owner) | Rotate — old key dies, new key shown exactly once. |

Rate limiting: 30 req/min per principal (sliding window), 500 req/day per
principal (durable daily quota), plus each key's own per-min limit. Applicable
`429` responses carry truthful rate-limit headers — `Retry-After` (integer
seconds), `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`
(epoch seconds) — derived from the real limiter, quota or breaker state; any
value that is not known is omitted, never fabricated. See
[`GATEWAY-API.md` §Rate-limit response headers](./GATEWAY-API.md).

### Developer portal (`/api/portal`) — Phase 1 self-service

Session-authenticated (any signed-in user), single-owner Projects with
project-scoped API keys. Ownership is enforced on every operation
(cross-user access → 404; API-key principals → 403; signed-out → 401).

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/portal/projects` 🔒 | Create an owned project. |
| GET | `/api/portal/projects` 🔒 | List the caller's own projects. |
| GET | `/api/portal/projects/:id` 🔒 | Read an owned project. |
| PATCH | `/api/portal/projects/:id` 🔒 | Rename / archive / reactivate. |
| POST | `/api/portal/projects/:id/keys` 🔒 | Create a project-scoped key (portal scope subset; complete key shown EXACTLY once). |
| GET | `/api/portal/projects/:id/keys` 🔒 | Key metadata for the project (fingerprints only). |
| DELETE | `/api/portal/projects/:id/keys/:keyId` 🔒 | Revoke an owned project key. |
| POST | `/api/portal/projects/:id/keys/:keyId/rotate` 🔒 | Rotate — binding preserved, new key shown once. |
| GET | `/api/portal/projects/:id/usage` 🔒 | Real per-key usage + request-log aggregates. |
| GET | `/api/portal/projects/:id/logs` 🔒 | Real gateway request records + portal activity. |

Scope identifiers: `chat:completions`, `models:read`, `usage:read` (live v1
scopes) plus the registered product scopes `images:generate`, `videos:generate`,
`code:generate`, `files:read` — real grants enforced by the gateway's central
scope gate; the product endpoints that consume them are future phases.

---

## Planned endpoints (NOT implemented — listed for contract stability)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/jazmii/generate` (active form) | Will return `202 {job}` once a licensed video worker is deployed; same job schema as LAXII. |
| DELETE | `/api/laxii/jobs/:id` | Cancel queued jobs (cancel-while-queued exists internally; public cancel lands with the video worker). |
| GET | `/api/admin/usage` | Cross-user cost/usage analytics for operators. |
| GET | `/api/admin/backends/:id` | Per-backend detail + probe history. |

Do not integrate against planned endpoints; they do not exist and this document is the
authoritative implemented/planned split.
