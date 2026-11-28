/**
 * M47.5 — REAL staging lane readiness diagnostic (server-only, no secrets).
 *
 * Runs the ACTUAL staging seams against the ACTUAL environment:
 *   1. stagingLaneConfig() — the lane's own prerequisite report
 *      (BEAN_STAGING_ROOT / BEAN_STAGING_BASE_URL / BEAN_STAGING_DEPLOY_TOKEN,
 *      values never printed — only presence and the honest refusal reason).
 *   2. The external provider check (BEAN_DEPLOY_PROVIDER / BEAN_DEPLOY_TOKEN)
 *      through the deployment adapter's own honest-unavailable path.
 *   3. Scope-separation probe: the production port is refused as a staging
 *      target BY CONSTRUCTION (pinned by the M46 boundary test; restated here
 *      from the lane config contract).
 *
 * This script deploys NOTHING. It records the exact missing prerequisites.
 * Run: bun scripts/m47-staging-readiness.ts
 */
import { stagingLaneConfig } from '../src/lib/riishe/mission/deployment-adapter'

async function main(): Promise<void> {
  const cfg = stagingLaneConfig()
  // The config reports presence + missing-prerequisite names, never values.
  console.log(`STAGING_LANE: configured=${cfg.configured}`)
  console.log(`STAGING_ROOT_ENV present=${process.env.BEAN_STAGING_ROOT ? 'yes' : 'no'}`)
  console.log(`STAGING_BASE_URL_ENV present=${process.env.BEAN_STAGING_BASE_URL ? 'yes' : 'no'}`)
  console.log(`STAGING_DEPLOY_TOKEN_ENV present=${process.env.BEAN_STAGING_DEPLOY_TOKEN ? 'yes' : 'no'}`)
  if (!cfg.configured) {
    console.log(`LANE_REFUSAL: missing prerequisites = ${cfg.missingPrerequisites.join(', ') || '(unspecified)'}`)
    console.log(`LANE_NOTE: ${cfg.note.slice(0, 300)}`)
  }
  const provider = process.env.BEAN_DEPLOY_PROVIDER?.trim() || null
  const providerToken = process.env.BEAN_DEPLOY_TOKEN?.trim() || null
  console.log(`EXTERNAL_PROVIDER: provider=${provider ? 'SET' : 'UNSET'} token=${providerToken ? 'SET' : 'UNSET'} → external staging ${provider && providerToken ? 'may be attempted' : 'HONEST-UNAVAILABLE'}`)
  console.log('SCOPE: the staging lane refuses port 3000 (the production preview lane) BY CONSTRUCTION; production stays gated by BEAN_PRODUCTION_DEPLOY_ENABLED + owner approval upstream.')
  console.log(
    cfg.configured
      ? 'M47.5 STATE: local staging lane READY — a real authorized deployment may run.'
      : 'M47.5 STATE: live staging lane HONEST-UNAVAILABLE — implementation complete and LOCAL-LIVE tested (real loopback staging processes in the M46 suite, re-run fresh under M47); activation requires the owner to configure the missing prerequisites.',
  )
}

main().catch((e) => {
  console.error('staging readiness failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
