# BEAN Provider Security Review

**Date:** 2026-11-04 · **Scope:** §7 of the four-product task — credentials, exposure, authz, failure honesty. Method: source review of every credential/secret path plus live verification of public responses.

## 1. Credential lifecycle (verified in source)

- **At rest:** provider credentials live only in `ProviderCredential` rows as AES-256-GCM envelopes (`v1:<iv>.<tag>.<ct>`, `src/lib/security/crypto.ts`); master key `BEAN_CREDENTIALS_MASTER_KEY` read from env **only**, never persisted, fail-closed when absent (external-provider features report `credentialEncryptionStatus()` disabled rather than degrading to plaintext).
- **In use:** decryption happens per request inside `decryptProviderCredential` (`src/lib/security/provider-credentials.ts`) with a **SSRF re-check on every read** (`url-guard.ts`), and the key is placed solely into the `Authorization: Bearer` header of the outbound call (`providers/openai-compatible.ts:88-89`).
- **On error:** upstream error strings are redacted (`Bearer <redacted>`); typed error codes replace raw payloads before anything reaches a client.
- **In UI:** the admin gateway surface shows `maskedHint` only (`sk-…ab12`); raw keys are shown exactly once at creation (API keys) and stored only as SHA-256 (`keyHash @unique` + `timingSafeEqual` comparison). Admin routes require a session admin; **API keys can never manage credentials/keys** (`requireAdminPrincipal`).

## 2. What the browser ever sees (verified live this session)

- `/api/health` (unauthenticated): statuses, failure **categories** (e.g. `rate-limited`), HTTP status numbers, latencies, generic detail strings. No provider names, no model IDs, no endpoints, no secrets, no stack traces.
- `/api/products`: names, taglines, descriptions, sizes — no model identity (by registry contract, `products.ts` is the client-safe surface).
- Product UI: zero provider/model mentions (grep-verified across `src/components`); admin surface's "Provider: Z.ai authorized hosted inference gateway / Model identity: …not disclosed to tenant" is the only identity disclosure, admin-gated.
- Gateway request logs store no prompts; the logger's contract (never prompts/credentials) holds in the changed files (eslint + review).

## 3. Authz & abuse boundaries

- Sessions: opaque 32-byte tokens, httpOnly, SameSite=None+Secure (iframe embed) with Origin-based CSRF compensation (`middleware.ts` + `lib/api/origin.ts`); passwords scrypt N=16384.
- Ownership: every conversation/project/job/artifact route re-checks `userId` (404-on-foreign-ID); re-verified live this session for GIFTZ conversations, RIISHE conversations, LAXII artifacts (intruder session).
- Rate limiting & quotas: per-product per-minute limits + daily quotas enforced **server-side** in `preflight()` (UI displays, never enforces); gateway keys additionally 30/min + 500/day.
- 429 handling: per-class breaker (60s, sliding) → zero-network probe deferral → typed user-facing RATE_LIMITED; bounded backoff; no uncontrolled retry loops (`maxAttempts:1` on hosted backends).
- Sandbox: minimal env (PATH/HOME/NODE_ENV only — no DATABASE_URL, no cookies, no secrets), 15s SIGKILL, 64KB output caps, path traversal guard; documented limitation: process-level isolation, not a VM; network not restricted inside the sandbox (flagged, unchanged).

## 4. Findings & dispositions this session

| # | Finding | Disposition |
|---|---|---|
| S-1 | Upstream account-wide 429 throttling (chat + image classes) — real rejections captured verbatim | Honest typed failure surfaces (existing design); no retry storms; BLOCKED acceptance recorded |
| S-2 | `/api/health` unauthenticated exposes failure categories/latencies | Accepted risk (no secrets; operationally necessary for the public dashboard); **recommendation:** admin-gated detailed variant |
| S-3 | No idempotency keys on gateway/job submission | Flagged (duplicate submissions re-spend quota; rate limits bound it); out of this task's scope, documented in architecture audit §6 |
| S-4 | In-memory rate limits/breakers are single-node | Documented constraint; multi-node needs durable stores |

## 5. Database & data safety

No migrations were run this session (the sidebar feature needed none). Production DB untouched except normal user rows created by the acceptance runs (fresh `accept-*@bean.local` users; cascade-deleted GIFTZ test conversations). Pre-task backup: `db/custom.db.backup-20261104-135209.db`.
