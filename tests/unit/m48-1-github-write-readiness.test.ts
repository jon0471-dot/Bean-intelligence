/**
 * M48.1 tests — the ONE authoritative GitHub write-readiness decision.
 *
 * Classification: LOCAL-INTEGRATION with injected transports (the SAME
 * seams the M46 suites use — diagnostic token/transport seams + adapter
 * token seam; zero network in every hermetic case except the two
 * explicit LIVE-READ probes carried over from M46).
 *
 * What this suite pins:
 *   - readiness is derived from the ACTUAL prerequisites and the SAME
 *     policy primitives the write path runs (checkRepoPolicy via
 *     writeLaneAvailability) — it can never report available:true for a
 *     target a later policy gate rejects;
 *   - every required fact is individually established or honestly
 *     `unknown`, and unknown is NEVER ready;
 *   - authentication rate limits are honest unavailability (unknown), not
 *     invalid-token verdicts; public READ access never implies WRITE
 *     permission; token expiration is never invented;
 *   - the production repository can never become the disposable test
 *     target;
 *   - NO secret value can reach any readiness or diagnostic field.
 *
 * Fake credential strings only — a real token never exists in this suite.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import {
  assessGitHubWriteReadiness,
  setCredentialTransportForTests,
  setCredentialTokenForTests,
  type DiagnosticResponse,
} from '../../src/lib/riishe/mission/credential-diagnostics'
import {
  writeLaneAvailability,
  checkRepoPolicy,
  checkWriteBranchPolicy,
  createBranch,
  setRepositoryTransportForTests,
  setRepositoryTokenForTests,
  type GitHubResponse,
} from '../../src/lib/riishe/mission/repository-adapter'

const INTEG = 'jon0471-dot/integration-sandbox'
const FAKE_TOKEN = 'ghp_M48_1_FAKE_VALUE_never_a_real_secret_0001'

function ok(json: unknown): DiagnosticResponse {
  return { status: 200, json }
}

function ghRes(status: number, json: unknown = null): GitHubResponse {
  return { status, json }
}

/** Transport mapping for the "fully ready" configuration (hermetic). */
function fullyReadyTransport(): (path: string) => Promise<DiagnosticResponse> {
  return async (path) => {
    if (path === '/user') return ok({ login: 'jon0471-dot' })
    if (path === '/repos/jon0471-dot/integration-sandbox') {
      return ok({ full_name: INTEG, default_branch: 'main', private: true, permissions: { pull: true, push: true, admin: false, maintain: true } })
    }
    return { status: 404, json: null }
  }
}

function configureReadyLane(): void {
  setRepositoryTokenForTests(FAKE_TOKEN)
  setCredentialTokenForTests(FAKE_TOKEN)
  process.env.BEAN_TEST_REPOSITORY = INTEG
  process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
  setCredentialTransportForTests(() => fullyReadyTransport())
}

beforeEach(() => {
  // Start every case from the honest bare environment: no token, no test
  // repository, default allowlist, no injected transports.
  setRepositoryTokenForTests(null)
  setCredentialTokenForTests(null)
  delete process.env.BEAN_TEST_REPOSITORY
  delete process.env.BEAN_REPO_ALLOWLIST
  setCredentialTransportForTests(null)
  setRepositoryTransportForTests(null)
})

afterEach(() => {
  setCredentialTransportForTests(null)
  setRepositoryTransportForTests(null)
  setCredentialTokenForTests(undefined)
  setRepositoryTokenForTests(undefined)
  delete process.env.BEAN_TEST_REPOSITORY
  delete process.env.BEAN_REPO_ALLOWLIST
})

function fact(assessment: { facts: Array<{ id: string; state: string; note: string }> }, id: string): { id: string; state: string; note: string } {
  const f = assessment.facts.find((x) => x.id === id)
  expect(f, `fact ${id} must always be reported`).toBeDefined()
  return f as { id: string; state: string; note: string }
}

// ---------------------------------------------------------------------------
// The 17 required scenarios.
// ---------------------------------------------------------------------------
describe('M48.1 authoritative write-readiness — the 17 required scenarios', () => {
  test('1. credential absent → not-ok credential fact, live facts unknown, NEVER ready', async () => {
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(a.verdict).toBe('not-ready')
    expect(fact(a, 'credential-configured').state).toBe('not-ok')
    expect(fact(a, 'github-authentication').state).toBe('unknown')
    expect(fact(a, 'integration-repository-accessible').state).toBe('unknown')
    expect(fact(a, 'write-permission-reported').state).toBe('unknown')
    expect(a.summary).toMatch(/unknown is not ready/)
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(false)
    expect(lane.reason).toMatch(/GITHUB_TOKEN absent/)
  })

  test('2. credential configured and valid → authentication ok with owner login, still not ready without the other facts', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    setCredentialTransportForTests(() => async (path) => (path === '/user' ? ok({ login: 'jon0471-dot' }) : { status: 404, json: null }))
    const a = await assessGitHubWriteReadiness()
    const auth = fact(a, 'github-authentication')
    expect(auth.state).toBe('ok')
    expect(auth.note).toMatch(/jon0471-dot/)
    expect(auth.note).not.toMatch(new RegExp(FAKE_TOKEN.slice(4, 20)))
    expect(a.available).toBe(false) // no integration repository configured yet
  })

  test('3. credential invalid (401) → auth-invalid fact, downstream live facts skipped as not-ok, not ready', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => async () => ({ status: 401, json: { message: 'Bad credentials' } }))
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(fact(a, 'github-authentication').state).toBe('not-ok')
    expect(fact(a, 'github-authentication').note).toMatch(/401|revoked, expired or wrong env value/)
    expect(fact(a, 'integration-repository-accessible').state).toBe('not-ok')
    expect(fact(a, 'integration-repository-accessible').note).toMatch(/did not validate/)
    expect(fact(a, 'write-permission-reported').state).toBe('not-ok')
  })

  test('4. authentication rate-limited → UNKNOWN (honest quota unavailability), never an invalid-token verdict', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => async () => ({ status: 403, json: { message: 'API rate limit exceeded' } }))
    const a = await assessGitHubWriteReadiness()
    const auth = fact(a, 'github-authentication')
    expect(auth.state).toBe('unknown')
    expect(auth.note).toMatch(/rate limit/i)
    expect(auth.note).toMatch(/NOT an invalid token/i)
    expect(a.available).toBe(false) // unknown is not ready
  })

  test('5. authentication network-unavailable → UNKNOWN, no conclusion about the token itself', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => async () => {
      throw new Error('getaddrinfo EAI_AGAIN api.github.com')
    })
    const a = await assessGitHubWriteReadiness()
    const auth = fact(a, 'github-authentication')
    expect(auth.state).toBe('unknown')
    expect(auth.note).toMatch(/could not reach GitHub/)
    expect(auth.note).toMatch(/no conclusion about the token/i)
    expect(a.available).toBe(false)
  })

  test('6. integration repository missing (unset) → dedicated fact not-ok, live target facts unknown, not ready', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    setCredentialTransportForTests(() => fullyReadyTransport())
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(a.repository).toBeNull()
    expect(fact(a, 'dedicated-integration-repository').state).toBe('not-ok')
    expect(fact(a, 'integration-repository-accessible').state).toBe('unknown')
    expect(fact(a, 'write-permission-reported').state).toBe('unknown')
  })

  test('7. integration repository malformed → parsed as absent (nothing invented), not ready', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = 'not-a-repo-ref'
    setCredentialTransportForTests(() => fullyReadyTransport())
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(a.repository).toBeNull()
    expect(fact(a, 'dedicated-integration-repository').state).toBe('not-ok')
    expect(fact(a, 'dedicated-integration-repository').note).toMatch(/unset or malformed/)
  })

  test('8. integration repository inaccessible (404) → access not-ok honestly, permission not established', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => async (path) => {
      if (path === '/user') return ok({ login: 'jon0471-dot' })
      return { status: 404, json: { message: 'Not Found' } }
    })
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    const access = fact(a, 'integration-repository-accessible')
    expect(access.state).toBe('not-ok')
    expect(access.note).toMatch(/404/)
    expect(access.note).toMatch(/allowlist does NOT expand access/i)
    expect(fact(a, 'write-permission-reported').note).toMatch(/No permission report/)
  })

  test('9. read permission but no write permission → access ok but write-permission NOT-ok; READ never implies WRITE', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => async (path) => {
      if (path === '/user') return ok({ login: 'jon0471-dot' })
      if (path === `/repos/${INTEG}`) return ok({ full_name: INTEG, default_branch: 'main', permissions: { pull: true, push: false, admin: false, maintain: false } })
      return { status: 404, json: null }
    })
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(fact(a, 'integration-repository-accessible').state).toBe('ok')
    const perm = fact(a, 'write-permission-reported')
    expect(perm.state).toBe('not-ok')
    expect(perm.note).toMatch(/READ access never implies WRITE permission/)
    expect(perm.note).toMatch(/push=false/)
  })

  test('10. write permission correctly reported → GitHub-reported push=true recorded with the full flag set', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    process.env.BEAN_REPO_ALLOWLIST = `jon0471-dot/Bean-intelligence,${INTEG}`
    setCredentialTransportForTests(() => fullyReadyTransport())
    const a = await assessGitHubWriteReadiness()
    const perm = fact(a, 'write-permission-reported')
    expect(perm.state).toBe('ok')
    expect(perm.note).toMatch(/permissions\.push=true/)
    expect(perm.note).toMatch(/pull=true/)
    expect(perm.note).toMatch(/maintain=true/)
  })

  test('11. integration repository missing from allowlist → readiness NOT ready and the SAME policy rejects writes', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    process.env.BEAN_TEST_REPOSITORY = INTEG
    // Explicit allowlist WITHOUT the integration repository (the historical
    // readiness/execution mismatch — now impossible to report ready).
    process.env.BEAN_REPO_ALLOWLIST = 'jon0471-dot/Bean-intelligence'
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(fact(a, 'allowlist-includes-integration-repository').state).toBe('not-ok')
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(false)
    expect(lane.reason).toMatch(/rejected by the repository policy/)
    // And the actual write path refuses the SAME target BEFORE any network.
    let network = 0
    setRepositoryTransportForTests(async () => {
      network += 1
      return ghRes(201, {})
    })
    const out = await createBranch({ ref: { owner: 'jon0471-dot', repo: 'integration-sandbox' }, branch: 'm48-probe', fromSha: 'a'.repeat(40) })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/repo-not-allowlisted/)
    expect(network).toBe(0)
  })

  test('12. integration repository explicitly allowlisted → static projection ready + fully-ready live probes → AVAILABLE', async () => {
    configureReadyLane()
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(true)
    expect(a.verdict).toBe('ready')
    expect(a.repository).toBe(INTEG)
    expect(a.facts.every((f) => f.state === 'ok')).toBe(true)
    expect(a.summary).toMatch(/WRITE LANE READY/)
    expect(writeLaneAvailability().available).toBe(true)
  })

  test('13. production repository cannot become a disposable test target — refused even when allowlisted', async () => {
    setCredentialTokenForTests(FAKE_TOKEN)
    setRepositoryTokenForTests(FAKE_TOKEN)
    // The production repository IS in the default allowlist — readiness must
    // still refuse it as the disposable target.
    process.env.BEAN_TEST_REPOSITORY = 'jon0471-dot/Bean-intelligence'
    setCredentialTransportForTests(() => fullyReadyTransport())
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(fact(a, 'production-repository-protected').state).toBe('not-ok')
    expect(fact(a, 'production-repository-protected').note).toMatch(/REFUSED|never a disposable/)
    expect(fact(a, 'dedicated-integration-repository').state).toBe('not-ok')
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(false)
    expect(lane.reason).toMatch(/production repository/i)
    expect(lane.reason).toMatch(/never treated as a disposable/i)
  })

  test('14. protected branch rejected — by the fact projection AND by the policy function directly', async () => {
    configureReadyLane()
    const a = await assessGitHubWriteReadiness()
    expect(fact(a, 'feature-branch-policy-permits').state).toBe('ok')
    expect(fact(a, 'feature-branch-policy-permits').note).toMatch(/refuses protected names/)
    for (const b of ['main', 'master', 'develop', 'release/1', 'hotfix/x', 'production', 'feat/x/main']) {
      expect(checkWriteBranchPolicy(b).ok).toBe(false)
    }
  })

  test('15. normal feature branch accepted — policy function and readiness projection agree', async () => {
    configureReadyLane()
    expect(checkWriteBranchPolicy('m48-1-github-readiness').ok).toBe(true)
    expect(checkWriteBranchPolicy('bean-integration/acceptance-run').ok).toBe(true)
    const a = await assessGitHubWriteReadiness()
    expect(fact(a, 'feature-branch-policy-permits').state).toBe('ok')
  })

  test('16. readiness projection AGREES with the actual write policy in both directions', async () => {
    // (a) ready lane → an actual write is NOT refused by the pre-network
    //     policy gates: it reaches the transport (which the test observes).
    configureReadyLane()
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(true)
    let network = 0
    setRepositoryTransportForTests(async () => {
      network += 1
      return ghRes(201, { ref: 'refs/heads/m48-probe', object: { sha: 'a'.repeat(40) } })
    })
    const out = await createBranch({ ref: { owner: 'jon0471-dot', repo: 'integration-sandbox' }, branch: 'm48-probe', fromSha: 'a'.repeat(40) })
    expect(out.kind).toBe('executed')
    // 2 calls: the write itself + the adapter's INDEPENDENT verification read
    // (by design, never the write receipt alone). The point: the pre-network
    // policy gates did NOT refuse the target the readiness decision called ready.
    expect(network).toBe(2)
    expect(checkRepoPolicy({ owner: 'jon0471-dot', repo: 'integration-sandbox' }).ok).toBe(true)

    // (b) not-ready lane (allowlist omission) → the SAME target IS refused
    //     pre-network (already pinned in scenario 11) — the two decisions
    //     can never contradict each other because they share checkRepoPolicy.
    process.env.BEAN_REPO_ALLOWLIST = 'jon0471-dot/Bean-intelligence'
    expect(checkRepoPolicy({ owner: 'jon0471-dot', repo: 'integration-sandbox' }).ok).toBe(false)
    expect(writeLaneAvailability().available).toBe(false)
  })

  test('17. secret values NEVER appear in any readiness or diagnostic field', async () => {
    configureReadyLane()
    const { diagnoseGitHubCredential } = await import('../../src/lib/riishe/mission/credential-diagnostics')
    const a = await assessGitHubWriteReadiness()
    const d = await diagnoseGitHubCredential()
    const serialized = JSON.stringify({ assessment: a, diagnostic: d, lane: writeLaneAvailability() })
    expect(serialized).not.toContain(FAKE_TOKEN)
    expect(serialized).not.toMatch(/ghp_[A-Za-z0-9_]{10,}/)
    // The env NAMES may appear; the env VALUES may not.
    expect(d.envNames.token).toBe('GITHUB_TOKEN')
  })
})

// ---------------------------------------------------------------------------
// Honest-environment projection: this deployment (no GITHUB_TOKEN / no
// BEAN_TEST_REPOSITORY) must assess honestly, never ready.
// ---------------------------------------------------------------------------
describe('M48.1 readiness — the real deployment environment (honest)', () => {
  test('bare environment → not-ready with the configuration requirements named', async () => {
    const a = await assessGitHubWriteReadiness()
    expect(a.available).toBe(false)
    expect(a.verdict).toBe('not-ready')
    const ids = a.facts.map((f) => f.id)
    // exactly the eight required facts, deterministically ordered
    expect(ids).toEqual([
      'credential-configured',
      'dedicated-integration-repository',
      'allowlist-includes-integration-repository',
      'production-repository-protected',
      'feature-branch-policy-permits',
      'github-authentication',
      'integration-repository-accessible',
      'write-permission-reported',
    ])
    expect(a.summary).toMatch(/credential-configured/)
    expect(a.summary).toMatch(/dedicated-integration-repository/)
  })
})

// ---------------------------------------------------------------------------
// LIVE-READ probes (carried over from M46): the read lane is real even when
// the write lane honestly is not. No writes of any kind in M48.1.
// ---------------------------------------------------------------------------
describe('M48.1 live read lane (LIVE, real external system — read-only)', () => {
  test('git ls-remote answers for the real authorized repository without the REST API', async () => {
    setRepositoryTokenForTests(undefined)
    const proc = Bun.spawnSync(['git', 'ls-remote', 'https://github.com/jon0471-dot/Bean-intelligence.git', 'refs/heads/main'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    })
    expect(proc.exitCode).toBe(0)
    const out = new TextDecoder().decode(proc.stdout).trim()
    expect(out).toMatch(/^[0-9a-f]{40}\s+refs\/heads\/main$/)
  })
})
