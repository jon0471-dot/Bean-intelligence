# M46 — GitHub Credentials & Access (docs/intelligence)

Milestone: M46.2 (Phase 3) · commit `00bab43`

## Credential architecture (discovered, not invented)

| Path | Mechanism | Scope |
| --- | --- | --- |
| Git push/pull | repo-local git credential store (HANDOFF §0; account `jon0471-dot`; mode 0600; never committed) | git transport only |
| GitHub REST (repository adapter) | `GITHUB_TOKEN` from the server environment, read inside `repository-adapter.ts`; the token crosses into the Authorization header ONLY | REST reads/writes for the M45/M46 adapters |
| Repository allowlist | `BEAN_REPO_ALLOWLIST` (comma-separated, max 8; default `jon0471-dot/Bean-intelligence`) | every operation checks it first |
| API base | `BEAN_GITHUB_API_BASE` (default `https://api.github.com`) | transport |
| Integration-test repository (M46.3) | `BEAN_TEST_REPOSITORY` — explicit configuration ONLY; nothing is created, published or defaulted | live write lane target |

**No secret values appear anywhere in this milestone's commits, logs, docs or diagnostics.** The credential store was never read during M46; `GITHUB_TOKEN` is absent from the deployment environment (verified without displaying values).

## The readiness diagnostic (`credential-diagnostics.ts`)

A SERVER-ONLY operator seam — unreachable from any model-callable tool, so no secret can enter model context through it. Per run it reports:

- **Configured / not configured** from the real env names above (names only, never values);
- **Authentication validation** — live `GET /user`; the credential owner's LOGIN is displayed (safe; not the token);
- **Failure categories** — `not-configured` / `auth-invalid` (401: revoked, expired or wrong env value — with the replace-through-environment instruction, never through chat) / `rate-limited` (403+429: honest quota unavailability, NOT an invalid-token verdict) / `network-unavailable` (draws NO conclusion about the token itself);
- **Repository scope validation** — per allowlist repo: readable? GitHub's own permission flags (pull/push/admin/maintain) = the least-privilege report; 404 reported honestly (the allowlist entry does NOT expand access — access is validated);
- **Expiration** — the provider does not disclose token expiry via the API; the diagnostic says exactly that instead of inventing a date.

Audit events (`m46.credential_diagnostic`) record OUTCOME only.

## Live diagnostic result (this deployment, run for real)

```
state: not-configured | publicReadFallback: true
authentication.failureCategory: not-configured
note: "… Repository WRITES require a credential — the write lane stays unavailable
       until the owner configures one through the deployment environment
       (never through chat)."
```

## Configuration procedure for the owner (never through chat)

1. Create a fine-grained personal access token (or repository-scoped GitHub App installation) limited to the dedicated integration repository; permissions: contents read/write + pull requests read/write; nothing organization-wide.
2. Set `GITHUB_TOKEN` in the deployment environment (the existing secure channel — the same one that carries `DATABASE_URL`).
3. Set `BEAN_TEST_REPOSITORY=owner/integration-sandbox` (a disposable repository the owner creates manually).
4. Optionally narrow `BEAN_REPO_ALLOWLIST`.
5. Restart; run the diagnostic (it validates auth + scope and reports the permission flags).

## Tests

`tests/unit/m46-credential-diagnostics.test.ts` (8 cases, LOCAL-INT): configured path via token+transport seams (NO real secret exists in the suite), 401/403-rate-limit/network classifications, leak test (a fake `ghp_…` value can never reach any diagnostic field), and the real-environment honest state pinned as behavior.
