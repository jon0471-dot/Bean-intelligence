# CODE GIFTZ — Unified AI Model API (Gateway) Reference

Version: 1.0 (work order: Self-Verification Engine + Unified AI Model API & Secure Key Management)
Base path: `/api/v1`

**Machine-readable contract:** [`docs/api/openapi.yaml`](./openapi.yaml) (OpenAPI
3.1) describes this same implemented `/api/v1` surface — endpoints, auth
requirements, schemas, error responses and rate-limit headers. This document
remains the narrative reference; the YAML is the integratable contract. Both
describe only IMPLEMENTED endpoints.

This is the single internal call surface for every configured AI model. It is
also the documented integration interface for future BEAN-family products
(they call this gateway with their own application API keys — provider
credentials are never shared, never exposed, and never required by callers).

---

## 1. Authentication — two independent credential concepts

| | A. Provider API credentials | B. Application API keys |
|---|---|---|
| Authenticates | BEAN → upstream AI provider | caller → BEAN gateway |
| Managed by | administrators, server-side, AES-256-GCM encrypted in the DB | administrators, via `/api/v1/keys` |
| Stored as | `v1:<iv>.<tag>.<ciphertext>` envelope (master key in `BEAN_CREDENTIALS_MASTER_KEY` env) | SHA-256 hash only |
| Ever returned? | never (only masked hint + status) | exactly once, at creation or rotation |
| Visible to callers of `/api/v1`? | **no — never** | the caller's own key, before storage |

Two principals may call the gateway:

1. **Session** (browser cookie) — product UI, signed-in users.
2. **Application API key** — `Authorization: Bearer bgk_…` header. Bearer wins
   when present (machine clients send no cookies).

A request with neither principal gets `401 UNAUTHENTICATED`.

### Application API keys

- Generated with a CSPRNG (32 bytes → 256 bits), prefixed `bgk_`.
- The complete key is shown **exactly once** (creation or rotation response).
  Only its SHA-256 hash is stored; verification compares hashes in constant
  time; lookups are narrowed by a display prefix (`bgk_xxxx`).
- Each key carries: name, permission scopes, per-key rate limit (req/min),
  optional expiry (`expiresAt`), status (`active | revoked`), usage counters.
- Scopes: `chat:completions`, `models:read`, `providers:read`, `usage:read`,
  and `*` (admin wildcard). Scope checks run per endpoint (`assertScope`).
- Keys never grant credential management — only admin **sessions** manage
  providers, credentials and keys.

### Rate limits & quotas (gateway callers)

- `30 requests/min` per principal (sliding window) — `429 RATE_LIMITED`.
- `500 requests/day` per principal (durable) — `429 QUOTA_EXCEEDED`.
- Per-key limit (default 60/min, configurable 1–600) is enforced **before**
  any backend work.

### Rate-limit response headers (truthful, on 429s)

Applicable `429` responses carry rate-limit headers derived from the REAL
limiter, quota or breaker state — a value that is not known is OMITTED, never
fabricated:

- `Retry-After` — integer seconds from the known retry delay: the sliding
  window's slot expiry (per-principal and per-key limits), the time until the
  daily quota's next local-midnight reset, or the REMAINING upstream circuit
  breaker window after an observed provider 429 (when a provider supplies its
  own retry hint, that hint is honored instead). Always a non-negative integer.
- `X-RateLimit-Limit` — the window limit that rejected the call (30/min
  principal window, the key's own per-min limit, or 500/day quota).
- `X-RateLimit-Remaining` — units actually left in the current window (0 on a
  rejected request).
- `X-RateLimit-Reset` — epoch SECONDS of the real reset moment: the
  sliding-window slot expiry or the next local midnight for the daily quota.
  Emitted only when a genuine reset timestamp can be calculated.

Successful responses do not carry rate-limit headers (the contract limits the
headers to rejections, so success behavior is unchanged). Which case produced
a 429 is always visible in the error `code` and message — the headers only add
the truthful timing metadata.

---

## 2. Endpoints

| Method | Path | Auth | Scope (API keys) |
|---|---|---|---|
| POST | `/api/v1/chat/completions` | session or key | `chat:completions` |
| GET | `/api/v1/models` | session or key | `models:read` |
| GET | `/api/v1/providers` | session or key | `providers:read` |
| GET | `/api/v1/health` | public | — |
| GET | `/api/v1/usage` | session or key | `usage:read` |
| POST | `/api/v1/keys` | **admin session** | — |
| GET | `/api/v1/keys` | **admin session** | — |
| DELETE | `/api/v1/keys/:id` | **admin session** (owner) | — |
| POST | `/api/v1/keys/:id/rotate` | **admin session** (owner) | — |

All responses use the BEAN envelope: success `{ "ok": true, …data }`, failure
`{ "ok": false, "error": "…", "code": "<STABLE_CODE>" }` with a matching HTTP
status.

### 2.1 POST /api/v1/chat/completions

Request (OpenAI-style names accepted for interoperability):

```json
{
  "model": "bean-chat-hosted",
  "messages": [
    { "role": "system", "content": "You are BEAN." },
    { "role": "user", "content": "Explain event-loop ordering." }
  ],
  "system": "optional convenience system instruction (prepended once)",
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 4000,
  "providerModel": "gpt-4o-mini"
}
```

Schema rules: `model` required; 1–48 messages; each message ≤64,000 chars;
`temperature` 0–2 (clamped server-side); `max_tokens`/`maxTokens` 1–32,000;
`providerModel` only meaningful for external OpenAI-compatible models.

**JSON response** (`stream` false/absent):

```json
{
  "ok": true,
  "content": "…",
  "model": "bean-chat-hosted",
  "provider": "bean-hosted",
  "finishReason": "stop",
  "usage": { "tokensIn": 148, "tokensOut": 980, "exact": false },
  "durationMs": 4120
}
```

`usage.exact` is `true` only when the provider reported real counts (external
path); the hosted path reports labeled estimates.

**SSE response** (`"stream": true`), `content-type: text/event-stream`:

```
data: {"delta":"…"}            (repeated)
: keepalive                    (every 15s during silent stretches)
data: {"done":true,"model":"…","provider":"…","durationMs":…}   (exactly one terminal frame)
```

Failure mid-stream: exactly one typed error frame
`data: {"error":"…","code":"RATE_LIMITED","partial":true}` — `partial:true`
means deltas were already delivered (never a fake completion).

### 2.2 GET /api/v1/models

Public-safe catalogue: id, display name, provider, capabilities, streaming
support, availability (`available | unavailable | awaiting-credentials |
disabled`), configuration status, context limits, pricing. **No endpoint
URLs, no credential material.** Includes `credentialEncryption:
"configured" | "not-configured"`.

**Registered models** (gateway id ⇄ internal backend id — the gateway id is
the stable public identifier; the backend id is the internal adapter
resolution key and appears only in admin/operator surfaces):

| Gateway model id (public) | Backend id (internal) | Capabilities | Status |
|---|---|---|---|
| `bean-chat-hosted` | `bean-llm-hosted-primary` | chat, streaming | availability = latest MEASURED health probe |
| `bean-code-hosted` | `bean-code-llm-hosted-primary` | chat, streaming | availability = latest MEASURED health probe |
| `bean-image-hosted` | `bean-image-hosted-primary` | image-generation | availability = latest MEASURED health probe |
| `bean-image-enhance-local` | `bean-image-local-sharp` | image-enhancement | available (in-process deterministic engine) |
| `bean-image-edit-local` | `bean-image-selfhosted-diffusers` | image-editing | **disabled** — local Diffusers GPU worker has not passed its hardware preflight; never advertised as operational |
| `bean-external-openai-compatible` | `bean-external-openai-compatible` | chat, streaming | **awaiting-credentials** until an administrator configures an encrypted credential |

Chat-capable models (`bean-chat-hosted`, `bean-code-hosted`, and the external
family once credentialed) are the only ids `/api/v1/chat/completions`
accepts; requesting any other model is a typed error, never a fallback.

### 2.3 GET /api/v1/providers

Registered providers with health (measured probes, TTL-cached), credential
state (present/absent — never the secret), and model counts.

### 2.4 GET /api/v1/health

Liveness of the gateway itself plus upstream availability summary. This is
the endpoint deployment monitoring should poll (it reports the honest
`riishe.available` state used by the evaluation harness).

### 2.5 GET /api/v1/usage

Rollups for the calling principal (last 30 days): per-product request
counts, token sums (in/out), duration, error counts, 20 most recent calls.
Admin sessions additionally get gateway-wide aggregates. Cost is `null`
unless a provider reports it (none do today — the field is never invented).

### 2.6 Key management (admin session only)

**POST /api/v1/keys** — create:

```json
{ "name": "BEAN integration", "permissions": ["chat:completions", "models:read"],
  "rateLimitPerMin": 60, "expiresAt": null }
```

Response — the ONLY place the raw key appears:

```json
{ "ok": true, "key": "bgk_9x2f…", "id": "…", "prefix": "bgk_9x2f",
  "name": "BEAN integration", "permissions": ["chat:completions","models:read"],
  "rateLimitPerMin": 60, "expiresAt": null }
```

**GET /api/v1/keys** — list (metadata only: prefix + hash fingerprint, no
secret). **DELETE /api/v1/keys/:id** — revoke (stops working immediately;
revoking an already-revoked key → `400 VALIDATION_ERROR`).
**POST /api/v1/keys/:id/rotate** — mint a new key under the same metadata;
the old hash dies at once; the new raw key is returned exactly once. Rotation
of another admin's key → `404 NOT_FOUND` (ownership enforced). Rotating a
revoked key → `400 VALIDATION_ERROR`.

### 2.7 Verification controls (admin)

`GET/POST /api/admin/verification` — read/tune the self-verification engine
at runtime (see §4). All changes are audit-logged; every value is clamped to
structural hard caps.

---

## 3. Error codes (stable contract)

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No/invalid session and no/invalid Bearer key |
| `FORBIDDEN` | 403 | Key lacks the scope, or the key has expired |
| `RATE_LIMITED` | 429 | Caller limit reached **or upstream 429 observed** (upstream cooling). Carries truthful `Retry-After` / `X-RateLimit-*` headers when the real values are known |
| `QUOTA_EXCEEDED` | 429 | Daily gateway quota exhausted. Carries the same truthful headers (`Reset` = next local midnight) when known |
| `VALIDATION_ERROR` | 400 | Malformed request / invalid key operation (e.g. revoking an already-revoked key) |
| `CAPABILITY_UNSUPPORTED` | 422 | Model cannot serve chat, or output truncated at provider cap |
| `PRODUCT_UNAVAILABLE` | 503 | Model disabled, or external provider has no credential yet |
| `BACKEND_TIMEOUT` | 504 | Provider stopped responding before completion |
| `BACKEND_FAILURE` | 502 | Upstream auth/billing/network failure (wording says retrying will not help when true) |

Error text never contains provider credentials, key material, or prompts.

---

## 4. Self-verification engine (operator controls)

Pipeline per turn: draft → independent verifier call (configurable model,
may be a different provider) → corrective revision when blocking issues are
found → re-verification → final answer with an honest status
(`verified | corrected | corrected-unverified | unverified`). The loop is
structurally bounded: worst case per turn = 1 draft + `maxAttempts` verifier
calls + `maxAttempts−1` revisions; `regenerationLimit: 0` selects
verify-only mode. When correctness cannot be established the best available
answer ships with an explicit uncertainty status — never a claimed
verification. Only the status and counters are user-visible; verifier
reasoning stays internal.

Controls (`BEAN_VERIFY_*` env defaults, runtime-overridable via
`/api/admin/verification`, all clamped to hard caps):

| Control | Env | Default | Hard cap |
|---|---|---|---|
| Master switch | `BEAN_VERIFY_ENABLED` | `false` | — |
| Verifier model | `BEAN_VERIFY_MODEL` | `bean-code-hosted` | registry ids |
| Verification passes | `BEAN_VERIFY_MAX_ATTEMPTS` | 2 | 3 |
| Verifier call timeout | `BEAN_VERIFY_TIMEOUT_MS` | 60000 | 120000 |
| Confidence threshold | `BEAN_VERIFY_MIN_CONFIDENCE` | 0.6 | 0–1 |
| Regenerations | `BEAN_VERIFY_REGENERATIONS` | 1 | 1 |
| Verifier input budget | `BEAN_VERIFY_MAX_INPUT_CHARS` | 30000 | 60000 |

---

## 5. Provider credential storage (server-side)

- AES-256-GCM (node:crypto), versioned envelope `v1:<iv>.<tag>.<ct>`
  (base64url), fresh 96-bit IV per encryption; tampering fails closed.
- Master key: `BEAN_CREDENTIALS_MASTER_KEY` (32 bytes, hex or base64) —
  environment-only, never hardcoded, never logged. Missing key → credential
  features disabled with a typed error (no plaintext fallback).
- Encrypted-at-rest credentials live in the `ProviderCredential` table; the
  plaintext exists only in memory during an upstream call, only inside the
  `Authorization` header.
- Rotation: `POST /api/admin/gateway` (action `rotate-master-key`) re-encrypts
  every envelope under the current env key; failures are reported, not hidden.
- Credential lifecycle: create / replace / revoke — admin session only,
  every action audit-logged; dashboards show masked hints + status only.

---

## 6. Integration guide (for future BEAN-family products)

1. An administrator creates an application key scoped to the product's needs
   (minimum: `chat:completions`, plus `models:read` for catalogue UIs).
2. The product stores the key once (creation response) and sends
   `Authorization: Bearer <key>` on every call.
3. Respect `429 RATE_LIMITED` (retry later) and `429 QUOTA_EXCEEDED` (wait
   for the daily reset); do not retry `BACKEND_FAILURE` wording that says an
   operator/account action is required.
4. Stream with `stream:true` and treat `data: {"done":true}` / a single error
   frame as terminal; keepalive comments are noise to be ignored.
5. The key authenticates the product only. Provider credentials, model
   routing and health handling stay entirely inside BEAN.

## 7. cURL examples

```bash
# JSON completion (application key)
curl -s https://<host>/api/v1/chat/completions \
  -H "Authorization: Bearer $BEAN_KEY" -H "content-type: application/json" \
  -d '{"model":"bean-chat-hosted","messages":[{"role":"user","content":"hi"}]}'

# SSE stream
curl -N https://<host>/api/v1/chat/completions \
  -H "Authorization: Bearer $BEAN_KEY" -H "content-type: application/json" \
  -d '{"model":"bean-chat-hosted","messages":[{"role":"user","content":"hi"}],"stream":true}'

# Model catalogue
curl -s https://<host>/api/v1/models -H "Authorization: Bearer $BEAN_KEY"
```
