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
require the admin role.

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
