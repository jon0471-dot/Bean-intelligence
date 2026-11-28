# Capability Registry — Products, Tasks, Backends, Health

**Status: implemented. The single source of truth for what BEAN offers, through which task and backend, and whether it is actually working right now.**

## 1. Purpose and responsibilities

The registry defines BEAN's product/task/backend vocabulary, resolves every
request to a real backend through governed preflight, probes real health, and
publishes customer-safe availability (`/api/products`, `/api/health`). The UI
may render this truth; it may never invent it.

## 2. Actual architecture

- **Products & tasks** — `src/lib/registry/products.ts`: the fixed
  `BeanProductId` vocabulary (`riishe`, `laxii`, `jazmii`, `code-giftz`,
  `gangzii`) and task vocabulary (`chat`, `image-generation`,
  `video-generation`, `coding-task`, `speech-synthesis`, plus the
  retrieval/mission/local-inference tasks), with per-product metadata.
- **Backends** — `src/lib/registry/backends.ts`: registered backend rows
  (env-configured) mapped to product+task; `getBackendsForProduct` drives
  router candidate selection.
- **Models** — `src/lib/registry/models.ts`: the gateway model list with
  health, credential-encryption status and a customer-safe public projection
  (`toPublicModels`).
- **Status/health** — `src/lib/registry/status.ts` +
  `src/app/api/health/route.ts`: per-CAPABILITY measured health rows
  (`operational | degraded | rate-limited | blocked | unavailable |
  not-configured`), probe cache with TTL, staggered probes
  (`src/lib/adapters/probe-stagger.ts`, `safe-probe.ts`,
  `health-cache.ts`), breaker semantics (`retry-hint.ts`).
- **Router preflight** — `src/lib/router/router.ts`: product/task identity →
  candidates → availability → rate limit → daily quota → budget guard →
  concurrency slot → adapter resolution; every product request (chat, media
  submission, delegation, AUTOBOTS runs) passes here.
- **Capability records** — `src/lib/registry/capability-records.ts`,
  `capabilities.ts`: the capability inventory feeding health rows.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Product/task registry | `src/lib/registry/products.ts` |
| Backends | `src/lib/registry/backends.ts` |
| Models | `src/lib/registry/models.ts` |
| Health/status | `src/lib/registry/status.ts`, `src/app/api/health/route.ts` |
| Preflight | `src/lib/router/router.ts` |
| Public surfaces | `src/app/api/products/route.ts`, `src/app/api/v1/{models,health,providers}/` |
| Presets/limits | `src/lib/registry/gangzii-presets.ts`, `LAXII_SIZES`/`GANGZII_LIMITS` in `products.ts` |

## 4. Model and provider integration

Backends carry their provider identity server-side only; the public API
exposes BEAN product identity and measured health, never provider names to
the browser. Credential state surfaces as `configured | not-configured`
(`credentialEncryptionStatus`) — never secret material.

## 5. Input/output contracts

`/api/products` → BEAN products with tagline/task/availability.
`/api/health` → per-capability rows with evidence (`checkedAt`,
`latencyMs` when actually probed, `failureCategory`, `httpStatus`, cache
flag). Preflight returns `{ backend, adapter, release, servedBy }` and throws
typed `BeanApiError`s (`PRODUCT_UNAVAILABLE`, `RATE_LIMITED`,
`QUOTA_EXCEEDED`, `COST_LIMIT`, `CONCURRENCY_LIMIT`, `NO_BACKEND`).

## 6. Tools and permissions

The registry is server-internal; no tool surface. Delegation tools consult
it implicitly because they run the same `preflight`.

## 7. Data and memory handling

Stateless besides the in-process probe cache and breaker windows; quota state
is durable (`UsageRecord` counts). No user data is stored by the registry.

## 8. Execution workflow

request → `preflight(userId, product, task)` → availability (probed health,
breakers) → rate limit window → durable daily quota → provider budget guard
→ concurrency slot → adapter → (on finish) `release()` exactly once (M26 G-4
slot discipline incl. the SSE handoff rule).

## 9. Existing tests and verification

`tests/unit/availability-scenarios.test.ts`, `capability-health.test.ts`,
`riishe-router-confidence.test.ts`, `api-rate-limit-headers.test.ts`,
`connectivity-health.test.ts`, slot-release suites
(`riishe-chat-slot-release.test.ts`), quota-free health probes
(`chat-recovery-quota.test.ts`).

## 10. Failure handling and fallback behavior

Unhealthy backends are excluded by preflight (no silent substitution);
breakers fail fast with real reset times (`retryAfterSec`, `resetAtMs`);
`not-configured` (nothing deployed) is distinct from `unavailable` (deployed
but failing) — measured, never assumed.

## 11. Current implemented capabilities

Five products with per-capability health; governed preflight for every
request path (including AUTOBOTS and missions); public models/health/v1
surfaces; breaker + retry-hint semantics.

## 12. Partial capabilities and known limitations

Health is probe-cached (TTL bounded staleness, rendered honestly in the
dashboard with evidence age); backends live in environment configuration, so
an unconfigured deployment reports degraded product availability rather than
hiding it.

## 13. Planned capabilities (NOT implemented)

Multi-region health, per-user backend pinning UI — roadmap only. AI STUDIO
(M50) and NIIKI (M51) will register products/capabilities ONLY when real
implementation and acceptance evidence exist.
