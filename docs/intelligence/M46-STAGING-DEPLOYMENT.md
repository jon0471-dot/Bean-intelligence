# M46 — Staging Deployment (docs/intelligence)

Milestone: M46.4 (Phase 5) · commit `54239f0`

## Phase-0 discovery (the infrastructure that actually exists)

| Item | Finding |
| --- | --- |
| Reverse proxy | `Caddyfile`: `:81` → `localhost:3000`, with `XTransformPort` multi-port support |
| Application | Next standalone build (`.next/standalone/server.js`), started by `npm start` (`PORT=3000 HOSTNAME=0.0.0.0`, `DATABASE_URL=file:…/db/custom.db`) |
| Revision detection | `.next/BUILD_ID` + independent `git -C <root> rev-parse HEAD` (M45 `inspectDeployedRevision`) |
| Health | `/api/health` — comprehensive adapter/product probes |
| Logs | `dev.log` / `server.log` via `tee`; secret-filtered tails through the adapter |
| Rollback | none existed before M46 (no retained builds, no swap mechanism) |
| External provider | **none** — `BEAN_DEPLOY_PROVIDER` / `BEAN_DEPLOY_TOKEN` / `BEAN_STAGING_DEPLOY_TOKEN` / `BEAN_PRODUCTION_DEPLOY_ENABLED` all absent → provider history honestly unavailable; production refused outright (unchanged) |

## The new local staging lane (REAL local process, honestly labeled)

Configured by three prerequisites, each named when missing: `BEAN_STAGING_ROOT` (dedicated build directory), `BEAN_STAGING_BASE_URL` (staging's own URL, explicit port), `BEAN_STAGING_DEPLOY_TOKEN`. Unconfigured → every deploy reports HONEST-UNAVAILABLE; loopback/fixture checks are never counted as staging deploys.

**`executeApprovedStagingDeploy`** (the M44 approval is consumed upstream BEFORE this call):
1. Config + revision validation (40-hex SHA or build id);
2. Scope separation enforced: staging may not take port 3000 (the production preview lane);
3. Process start through the seam — production path spawns the standalone `server.js` detached on the staging port; a missing build dir is an honest failure (the adapter never builds or fetches code);
4. INDEPENDENT verification: staged `BUILD_ID` read + HTTP health probe + smoke GETs (`/`, `/api/health`) + runtime buildId match;
5. Verification incomplete → **UNVERIFIED with `reconciliationRequired: true`** — a deploy response can never prove success;
6. Process manager dying mid-deploy → reconciliation-required (inspect actual staging state; never auto-retry);
7. Audit event `m46.staging_deployed` records outcome only.

**`rollbackStagingToBuild`** — a separately authorized operation: the target must exist as a RETAINED build (nothing rebuilt or fetched); verified the same independent way; never automatic, never a retry of a failed deploy.

**Production boundaries unchanged** (`DEPLOYMENT_BOUNDARY_SEAM`): separate scopes, owner approval upstream, no automatic production retry, no DNS/domain/billing changes, rollback requires explicit approval.

## Live staging acceptance

| Step | Result |
| --- | --- |
| Real staging environment (external provider) | **HONEST-UNAVAILABLE** — none configured |
| Local staging lane verification | **LOCAL-LIVE** — real loopback staging processes with staged BUILD_IDs: verified deploy path (health `healthy`, buildId match, smoke 200/200, `reconciliationRequired: false`); unhealthy runtime → UNVERIFIED never success; mid-deploy crash → reconciliation-required; retained-build rollback re-verified with the old build's buildId; non-retained rollback refused |

This deployment's classified reality: staging deployment is LOCAL-staging-ready (implementation + LOCAL-LIVE verification complete) and external-staging-unavailable. Classifications are never mixed.

## Tests

`tests/unit/m46-staging-deployment.test.ts` (9 cases): verified deploy, unhealthy → UNVERIFIED, mid-deploy crash → reconciliation, missing build honest failure, port-3000 refusal, unconfigured prerequisites, rollback re-verification, non-retained rollback refusal, boundary seam pins.
