/**
 * M47.4 — REAL GitHub lane readiness diagnostic (server-only, no secrets).
 *
 * Runs the ACTUAL seams against the ACTUAL environment and prints the honest
 * readiness state:
 *   1. writeLaneAvailability()  — the adapter's own prerequisite report
 *      (GITHUB_TOKEN + BEAN_TEST_REPOSITORY names, values never printed).
 *   2. diagnoseGitHubCredential() — the leak-proof credential diagnostic
 *      (configured/not-configured; when configured: live auth validation
 *      with per-repository least-privilege scopes).
 *   3. LIVE read lane via `git ls-remote` — quota-free real network I/O
 *      against the owner repository (public metadata), proving the READ path
 *      works without credentials while writes stay honestly unavailable.
 *
 * This script NEVER creates, writes, deletes or configures anything.
 * Run: bun scripts/m47-github-readiness.ts
 */
import { writeLaneAvailability, integrationRepository, checkRepoPolicy } from '../src/lib/riishe/mission/repository-adapter'
import { diagnoseGitHubCredential } from '../src/lib/riishe/mission/credential-diagnostics'
import { execFileSync } from 'node:child_process'

async function main(): Promise<void> {
  // ---- 1. The adapter's own prerequisite report ---------------------------
  const lane = writeLaneAvailability()
  console.log(`WRITE_LANE: available=${lane.available} reason=${JSON.stringify(lane.reason.slice(0, 300))}`)

  // ---- 2. The leak-proof credential diagnostic ----------------------------
  const cred = await diagnoseGitHubCredential()
  console.log(`CREDENTIAL: state=${cred.state} env_token_name=${cred.envNames.token}` + (cred.authentication ? ` auth_validated=${cred.authentication.validated} category=${cred.authentication.failureCategory}` : ' (no token in this environment — nothing validated, nothing exposed)'))

  // ---- 3. The configured integration repository identity (or its absence) -
  const integ = integrationRepository()
  console.log(`TEST_REPOSITORY: ${integ ? JSON.stringify(`${integ.owner}/${integ.repo}`) : 'NOT-CONFIGURED (the owner production repository is never assumed disposable)'}`)
  if (integ) {
    const policy = checkRepoPolicy(integ)
    console.log(`REPO_POLICY: allowed=${policy.ok} reason=${policy.ok ? 'allowlisted' : JSON.stringify(policy.reason)}`)
  }

  // ---- 4. LIVE read lane (real network I/O, no credentials needed) --------
  try {
    const out = execFileSync('git', ['ls-remote', 'https://github.com/jon0471-dot/Bean-intelligence.git', 'HEAD'], { timeout: 30_000, encoding: 'utf8' })
    const sha = out.trim().split(/\s+/)[0] ?? ''
    console.log(`LIVE_READ: pass method=git-ls-remote remote_head_sha=${sha.slice(0, 12)} (public read lane — quota-free, no token consumed)`)
  } catch (e) {
    console.log(`LIVE_READ: failed reason=${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`)
  }

  console.log(
    lane.available
      ? 'M47.4 STATE: write lane READY — the real workflow may run under authorization.'
      : 'M47.4 STATE: live write lane HONEST-UNAVAILABLE — implementation complete and transport-tested; activation requires the owner to configure the missing prerequisites (never through chat).',
  )
}

main().catch((e) => {
  console.error('readiness diagnostic failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
