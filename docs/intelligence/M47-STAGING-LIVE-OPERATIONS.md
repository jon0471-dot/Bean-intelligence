# M47 — STAGING LIVE OPERATIONS

Status: **local staging lane implementation-complete with fresh LOCAL-LIVE evidence; live lane HONEST-UNAVAILABLE** (owner configuration pending). External staging: HONEST-UNAVAILABLE.

## M47 evidence (this session)

- `scripts/m47-staging-readiness.ts` (committed) ran the REAL lane seam: `stagingLaneConfig()` → configured=false with the exact missing prerequisites named:
  - `BEAN_STAGING_ROOT` — a dedicated directory for the staging standalone build;
  - `BEAN_STAGING_BASE_URL` — the staging process URL (e.g. `http://localhost:3100`, explicit port ≠ 3000);
  - `BEAN_STAGING_DEPLOY_TOKEN` — the staging deploy authorization token.
  Values were never printed — presence only.
- External provider check: `BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN` both UNSET → external staging HONEST-UNAVAILABLE. A loopback deployment is NEVER counted as an external deployment.
- Scope separation restated from the lane contract: the staging lane refuses port 3000 (the production preview lane) BY CONSTRUCTION; production stays gated by `BEAN_PRODUCTION_DEPLOY_ENABLED` + owner approval upstream; a staging approval never grants production permission.
- Fresh LOCAL-LIVE proof: the M46 staging suite re-ran green under the M47 tree — 9 pass / 0 fail — covering: verified deploy path with runtime BUILD_ID match + HTTP health + smoke GETs; unhealthy runtime → UNVERIFIED (never success); mid-deploy process crash → reconciliation-required; missing build → honest failure; port-3000 scope refusal; unconfigured-lane honest refusal naming prerequisites; retained-build rollback re-verified; non-retained rollback refused; the boundary seam pinning production separation.

## The verified staging workflow (when the owner configures the lane)

1. Inspect staging configuration (`stagingLaneConfig` — refuses honestly until all three prerequisites exist).
2. Inspect the current staged revision.
3. Validate the requested build identity (the adapter never builds or fetches code — it deploys an existing standalone build).
4. Produce an approval request; require valid authorization (the deploy token + the M44/M45 governance path upstream).
5. Deploy to staging (isolated root, independent database, no shared production data or credentials).
6. INDEPENDENT verification: staged BUILD_ID read + HTTP health + smoke tests + runtime buildId match — a deploy response alone can never prove success; incomplete verification is UNVERIFIED with `reconciliationRequired=true`.
7. Record deployment evidence (audit events; M46 conventions).
8. Recovery: interrupted/failed operations reconcile (inspect deployed revision + runtime health first); rollback only to a RETAINED build, only with separate approval, re-verified the same independent way.

## Production boundaries (unchanged)

Production is disabled by default (`BEAN_PRODUCTION_DEPLOY_ENABLED` unset); no automatic production deploy or retry; no DNS/domain/billing changes; no production database migration; no real production deployment during M47 acceptance. Local-lane deployments are never reported as external-provider deployments.
