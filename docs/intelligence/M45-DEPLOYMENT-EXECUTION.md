# M45 — Deployment Execution (docs/intelligence)

## The deployment that actually exists

BEAN in this environment serves through a **Caddy reverse proxy → localhost:3000** (Next.js standalone build). There is NO external deployment provider configured (no `BEAN_DEPLOY_PROVIDER` / `BEAN_DEPLOY_TOKEN`). The adapter's first honesty rule: inspect what is real, refuse what is not.

## Inspection capabilities (real, implemented)

| Operation (`deployment-inspect`, read-only) | What it reports |
| --- | --- |
| `operation=config` | Caddyfile presence/summary, start/build commands (secret-redacted), `.next/BUILD_ID`, standalone presence, scope (`local-preview`) |
| default / `operation=revision` | deployed revision: build id + serving commit via **independent `git rev-parse`** of the deployment root |
| `operation=health` | REAL HTTP probe of `/api/health`: status 200 healthy / non-200 unhealthy / unreachable ⇒ healthy=null (never a pass) |
| `operation=logs` | bounded tail (max 200 lines) of `dev.log`/`server.log`, secret-filtered |
| `operation=history` | **honest unavailability** — no provider configured; local build artifacts are never dressed up as provider history |

## Approved staging execution

`executeApprovedDeployment({scope: 'staging'})` is the typed contract an approved plan reaches through `deployment-release`. In this deployment `BEAN_STAGING_DEPLOY_TOKEN` is absent ⇒ the outcome is HONEST UNAVAILABILITY ("...cannot run and is never simulated"). A configured-but-unknown provider also refuses rather than improvising an API.

## Deployment boundaries (pinned in `DEPLOYMENT_BOUNDARY_SEAM` + tests)

- Staging and production are separate authorization scopes.
- Production requires `BEAN_PRODUCTION_DEPLOY_ENABLED=true` AND the owner approval already consumed upstream (M44 gate) — and is refused outright otherwise.
- No deployment on AI confidence. No automatic production retry. No DNS/domain/billing/infrastructure modification. Rollback = explicit, approved, independently verified only.
- No secret extraction: every file-derived output passes `redactSecrets` (authorization/token/password/api-key/DATABASE_URL patterns, `sk-*`, `ghp_*`).

## Required credentials (for future live staging)

`BEAN_STAGING_DEPLOY_TOKEN` (+ a typed provider integration to be added when the owner configures infrastructure), `BEAN_DEPLOY_BASE_URL` (defaults `http://localhost:3000`), `BEAN_DEPLOY_ROOT` (defaults cwd), `BEAN_PRODUCTION_DEPLOY_ENABLED` (production kill-switch, default absent).

## Known limitations

- No provider-backed deployment history, no real staging environment: scenarios 16/17 in the acceptance suite verify the refusal/honesty paths locally (LOCAL-LIVE loopback server) — a REAL staging deploy remains untested until the owner configures infrastructure. This is recorded honestly, never counted as a live deploy pass.
