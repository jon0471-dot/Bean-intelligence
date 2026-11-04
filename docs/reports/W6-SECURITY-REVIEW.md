# CODE GIFTZ — W6 SECURITY REVIEW (/api/v1 unified gateway + deployment)

**Date:** 2026-11-04 · **Method:** implementation inspection + unit tests + a 42-check HTTP-level E2E run against the LIVE deployment path (`scripts/giftz-w6-security-e2e.ts`, dedicated eval admin account, full DB cleanup afterwards).
**Statuses:** PASS / FAIL / PARTIAL / NOT VERIFIED. **Verdict: no release blockers remain at the application layer; public API exposure still requires the live completion-path tests (upstream 429) — see Release gates.**

---

## 1. Findings

### Authentication & authorization
| Check | Status | Evidence |
| --- | --- | --- |
| Missing API key → 401 typed | **PASS** | E2E: `GET /api/v1/models` no key → 401 UNAUTHENTICATED |
| Invalid API key → 401 | **PASS** | E2E: `bgk_totally-invalid-key` → 401; garbage bearer → 401 |
| Revoked key → 401 immediately | **PASS** | E2E: DELETE key then call → 401; double-revoke → typed 400 (unit + E2E) |
| Expired key → 403 | **PASS** | E2E: key with 5 s expiry → after expiry 403 FORBIDDEN (`verifyApiKey` expiry gate) |
| Insufficient scopes → 403 | **PASS** | E2E: `models:read`-only key calling chat → 403; chat-only key calling usage → 403 |
| API keys can never manage keys/credentials | **PASS** | E2E: key-management via API key → 401/403; `requireAdminPrincipal` allows only admin SESSIONS |
| Admin routes without session → 401 | **PASS** | E2E: `/api/admin/gateway` anonymous → 401; with bare API key (no cookie) → 401 |
| Session vs API-key principal separation | **PASS** | `gateway-auth.ts`: Bearer wins for machine clients; sessions carry user rights; keys carry scopes; usage attributed to key owner |

### Credential security
| Check | Status | Evidence |
| --- | --- | --- |
| AES-256-GCM envelope, fail-closed incl. empty plaintext | **PASS** | W5 suite (`security-crypto.test.ts` 15 tests) still green; v1 envelope format verified at rest in the closure E2E |
| Auth-tag tampering → decryption failure, never silent | **PASS** | `DecryptionFailedError` path; rotation reports `failed` counts honestly (closure evidence: `reencrypted:1, failed:1`) |
| Missing/invalid master key → typed fail-closed | **PASS** | nocred phase: create-credential → 503 PRODUCT_UNAVAILABLE naming the missing config; models/auth unaffected |
| No plaintext credential in DB/frontend/API/logs/Git | **PASS** | DB scan hits=0 (closure); create/list masked views only; sweep items 2/3/5/7 (7/7 this session) |
| **SSRF via provider baseUrl (SEC-W6-01)** | **FAIL → FIXED (PASS)** | Gap found by this review: baseUrl was stored/fetched with NO validation. Fix: `src/lib/security/url-guard.ts` — write-time validation (create/replace, typed 400), decrypt-time defense-in-depth, loopback/link-local/0.0.0.0/:: rejected, cloud-metadata range (169.254.0.0/16) rejected even under the escape hatch, userinfo rejected; 12 unit tests + live HTTP verification (three malicious baseUrls → typed 400) |
| Masked admin credential display; rotation behavior | **PASS** | maskedHint-only views; rotate re-encrypts with counts-not-secrets (closure E2E) |

### API abuse protection
| Check | Status | Evidence |
| --- | --- | --- |
| Per-key rate limiting | **PASS** | E2E: 3/min key → `404,404,429,429,429` on the invalid-model path — limiter engaged within window, typed RATE_LIMITED |
| Per-principal gateway limit + daily quota | **PASS** | `checkGatewayRateLimit` (30/min) + `checkGatewayQuota` (500/day) enforced before body parse (`chat/completions/route.ts`); quota typed QUOTA_EXCEEDED |
| Request-size limits | **PASS** | zod: ≤48 messages × 64 000 chars, system ≤24 000, max_tokens ≤32 000; E2E: 60-message body → typed 400; malformed JSON → typed 400 |
| Invalid model IDs → typed 404, never 500 | **PASS** | E2E after `prisma generate` (see §3): `bean-does-not-exist` → 404 NOT_FOUND naming the id + pointing at /api/v1/models |
| Excessive verification attempts | **PASS** | Structural: maxAttempts ≤ hard cap 3, revisions ≤ min(maxAttempts−1, regenerationLimit ≤ 1) — W5 12-category suite (incl. clamp + bound-exhaustion tests) |
| Long-running request protection | **PASS** | upstream timeout 90 s, gateway timeoutMs config (≤120 s for verifier), AbortSignal wired on /api/v1 (cooperative cancellation) |
| Streaming connection handling | **PASS (app layer)** | heartbeats, single terminal frame, cancel() unwinds generator, no zombie persist — unit-tested; >30 s PUBLIC streams remain platform-limited (NOT VERIFIED live, blocker D) |
| Errors without stack traces/secrets | **PASS** | E2E: typed bodies only; server-side logs carry a 6-frame stack (internal), responses never do; auth errors contain no key material |

### Web security
| Check | Status | Evidence |
| --- | --- | --- |
| CSRF for cookie-authenticated mutations | **PASS** | Middleware origin policy: E2E cross-site Origin → 403 typed; non-browser (no Origin) passes by design; policy documented in `origin.ts` |
| Session cookie flags | **PASS** | E2E: httpOnly + Secure + SameSite=None (SameSite=None REQUIRES Secure — required by the cross-site preview access path; rationale in `session.ts`) |
| Security headers (SEC-W6-02) | **PASS (app-level)** | E2E on / and /api/health: X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy camera/microphone/geolocation denied. **Deliberate omission:** X-Frame-Options/frame-ancestors — the workspace preview panel embeds the site cross-origin BY DESIGN; framing it off would break the whole-website preview. HSTS → platform ingress |
| CORS allowlist | **PASS** | Strict config-driven policy (`origin.ts`): exact origins + HTTPS dot-boundary suffix scope; no wildcards; `null` opaque origin rejected |
| HTTPS enforcement at boundary | **PARTIAL** | TLS terminates at the platform ingress (public URL is https; app cannot enforce redirects it never sees). Not verifiable from inside the app |
| Admin route authorization | **PASS** | `requireAdmin` on /api/admin/* (E2E 401s); `requireAdminPrincipal` on /api/v1/keys; audit records on mutations |
| Logging/error leakage | **PASS** | no secrets in logger payloads (sweep #4); rejection logs carry only origins (not credentials) |

### Deployment security
| Check | Status | Evidence |
| --- | --- | --- |
| Master key only in server-side env | **PASS** | never in DB/git/reports; closure runner generated it in-memory and unset it; sweep #7 (.env untracked, no secret shapes) |
| Never request real provider keys through chat | **PASS** | product prompt disciplines + sweep; no credential-shaped strings in bundles |
| Production verification config unchanged | **PASS** | `BEAN_VERIFY_ENABLED` default OFF — untouched (the isolated live runs would enable it per-process only) |
| Secrets/DB backups not committed | **PASS** | verify.db backups git-ignored by explicit rules; commit contents audited |

## 2. Root cause fixed during the review (R5)

The first E2E run returned 500s on every ApiKey-table call: the restored sandbox carried a **pre-W5 generated Prisma client** (`node_modules/.prisma` had zero ApiKey/GatewayRequestLog symbols). `bunx prisma generate` + supervisor restart fixed it (427 symbols). Any future workspace restore must re-run `prisma generate` when node_modules is restored stale — documented in the preview report (R5).

## 3. Test inventory added in W6

- `tests/unit/url-guard.test.ts` — 12 tests (accept/reject/escape-hatch)
- `tests/unit/verification-w6.test.ts` — 11 tests (focus is internal-only, prompt discipline, budget behavior)
- `scripts/giftz-w6-security-e2e.ts` — 42 HTTP checks, production-DB hygiene (dedicated account + full cleanup, zero upstream contact)

## 4. Release gates for public API exposure (unchanged, explicit)

1. Live JSON + SSE completions through `/api/v1/chat/completions` with a real hosted model (BLOCKED — upstream 429), incl. persistence, usage accounting, terminal frames.
2. Live verification-enabled run (BLOCKED — same window).
3. Platform ingress >30 s streaming decision (platform-owned).

Until those pass: **NOT PRODUCTION-RELEASED; internal/operator use only.** Nothing in this review weakens W1–W5 acceptance criteria.
