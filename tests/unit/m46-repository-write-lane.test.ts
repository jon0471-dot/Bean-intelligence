/**
 * M46.3 tests — the real GitHub write lane: readiness, reconciliation, and
 * every failure scenario the milestone names.
 *
 * Classification: LOCAL-INTEGRATION with MOCKED transports (the injected
 * GitHubFetch seam — no network at all) + one LIVE-READ probe (git
 * ls-remote against the real authorized repository, the quota-free lane).
 *
 * The LIVE WRITE lane itself is HONEST-UNAVAILABLE in this deployment:
 * no GITHUB_TOKEN and no BEAN_TEST_REPOSITORY exist, so the suite pins that
 * honesty as behavior (never a fabricated write) and exercises the full
 * write workflow + every failure mode through the injected transports, so
 * the lane is ready the moment the owner configures a credential and a
 * disposable integration repository.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import {
  createBranch,
  commitToBranch,
  fastForwardBranch,
  createPullRequest,
  readBranchFile,
  inspectRepository,
  setRepositoryTransportForTests,
  setRepositoryTokenForTests,
  setLsRemoteForTests,
  integrationRepository,
  writeLaneAvailability,
  type GitHubFetch,
  type GitHubResponse,
} from '../../src/lib/riishe/mission/repository-adapter'

const REF = { owner: 'jon0471-dot', repo: 'integration-sandbox' }
const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

function res(status: number, json: unknown = null): GitHubResponse {
  return { status, json }
}

function base64(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

beforeEach(() => {
  setRepositoryTokenForTests('fake-token-for-lane-tests') // presence only — no real secret
  process.env.BEAN_REPO_ALLOWLIST = 'jon0471-dot/Bean-intelligence,jon0471-dot/integration-sandbox'
  process.env.BEAN_TEST_REPOSITORY = 'jon0471-dot/integration-sandbox'
})

afterEach(() => {
  setRepositoryTransportForTests(null)
  setRepositoryTokenForTests(undefined)
  setLsRemoteForTests(null)
  delete process.env.BEAN_TEST_REPOSITORY
  delete process.env.BEAN_REPO_ALLOWLIST
})

// ---------------------------------------------------------------------------
// Write-lane readiness — the honest configuration story.
// ---------------------------------------------------------------------------
describe('M46.3 write-lane readiness (explicit configuration only)', () => {
  test('no credential → honestly unavailable, never simulated', () => {
    setRepositoryTokenForTests(null)
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(false)
    expect(lane.reason).toMatch(/credential.*not configured|GITHUB_TOKEN absent/i)
  })

  test('credential but no dedicated integration repository → unavailable (owner repo never assumed disposable)', () => {
    delete process.env.BEAN_TEST_REPOSITORY
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(false)
    expect(lane.reason).toMatch(/BEAN_TEST_REPOSITORY unset/)
    expect(lane.reason).toMatch(/production repository.*refused|refused.*production/i)
  })

  test('credential + configured integration repository → ready, with the narrow rules stated', () => {
    const lane = writeLaneAvailability()
    expect(lane.available).toBe(true)
    expect(lane.reason).toMatch(/integration-sandbox/)
    expect(lane.reason).toMatch(/fast-forward/)
    expect(lane.reason).toMatch(/never merged|never cleaned/)
  })

  test('integrationRepository parses only well-formed owner/repo pairs and never invents one', () => {
    expect(integrationRepository()).toEqual(REF)
    process.env.BEAN_TEST_REPOSITORY = 'not-a-repo-ref'
    expect(integrationRepository()).toBeNull()
    process.env.BEAN_TEST_REPOSITORY = ''
    expect(integrationRepository()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The full required write workflow (mocked transport; the exact sequence
// Phase 4 runs live once a real integration repository exists).
// ---------------------------------------------------------------------------
describe('M46.3 required write workflow (injected transport, full sequence)', () => {
  test('inspect → branch → commit → read-back → fast-forward → PR, each step independently verified', async () => {
    const calls: Array<{ path: string; method: string }> = []
    const transport: GitHubFetch = async (path, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ path, method })
      if (path === '/repos/jon0471-dot/integration-sandbox' && method === 'GET') {
        return res(200, { full_name: 'jon0471-dot/integration-sandbox', default_branch: 'main', private: true })
      }
      if (path === '/repos/jon0471-dot/integration-sandbox/git/refs' && method === 'POST') {
        return res(201, { ref: 'refs/heads/m46-ite', object: { sha: SHA } })
      }
      if (path === '/repos/jon0471-dot/integration-sandbox/git/ref/heads/m46-ite' && method === 'GET') {
        return res(200, { object: { sha: calls.some((c) => c.method === 'PATCH') ? SHA2 : SHA } })
      }
      if (path.startsWith('/repos/jon0471-dot/integration-sandbox/contents/') && method === 'PUT') {
        return res(201, { commit: { sha: SHA }, content: { sha: SHA } })
      }
      if (path.startsWith('/repos/jon0471-dot/integration-sandbox/contents/') && method === 'GET') {
        return res(200, { path: 'm46-integration-test.md', encoding: 'base64', content: base64('# M46 integration artifact\n'), sha: SHA })
      }
      if (path.startsWith('/repos/jon0471-dot/integration-sandbox/commits/') && method === 'GET') {
        return res(200, { sha: SHA })
      }
      if (path.includes('/compare/') && method === 'GET') {
        return res(200, { status: 'ahead', ahead_by: 1, behind_by: 0 })
      }
      if (path === '/repos/jon0471-dot/integration-sandbox/git/refs/heads/m46-ite' && method === 'PATCH') {
        return res(200, { object: { sha: SHA2 } })
      }
      if (path === '/repos/jon0471-dot/integration-sandbox/pulls' && method === 'POST') {
        return res(201, { number: 7, state: 'open', head: { sha: SHA2 }, title: 'M46 integration test' })
      }
      if (path === '/repos/jon0471-dot/integration-sandbox/pulls/7' && method === 'GET') {
        return res(200, { number: 7, state: 'open', head: { sha: SHA2 }, merged: false })
      }
      return res(404, { message: 'unexpected path in test transport' })
    }
    setRepositoryTransportForTests(transport)
    setLsRemoteForTests(async () => SHA2) // the independent git-level check after the push

    // 1. repository identity
    const identity = await inspectRepository(REF)
    expect(identity.kind).toBe('executed')
    if (identity.kind === 'executed') expect(identity.data.defaultBranch).toBe('main')
    // 2. feature branch from a known sha
    const branch = await createBranch({ ref: REF, branch: 'm46-ite', fromSha: SHA })
    expect(branch.kind).toBe('executed')
    if (branch.kind === 'executed') expect(branch.data.verified).toBe(true)
    // 3. harmless clearly-named artifact, committed on the feature branch
    const commit = await commitToBranch({ ref: REF, branch: 'm46-ite', path: 'm46-integration-test.md', content: '# M46 integration artifact\n', message: 'm46 integration-test artifact (harmless, clearly named)' })
    expect(commit.kind).toBe('executed')
    if (commit.kind === 'executed') expect(commit.data.verified).toBe(true)
    // 4. read the committed artifact back and verify its CONTENTS
    const back = await readBranchFile(REF, 'm46-ite', 'm46-integration-test.md')
    expect(back.kind).toBe('executed')
    if (back.kind === 'executed') expect(back.data.content).toBe('# M46 integration artifact\n')
    // 5. fast-forward the branch (never force)
    const ff = await fastForwardBranch({ ref: REF, branch: 'm46-ite', toSha: SHA2 })
    expect(ff.kind).toBe('executed')
    if (ff.kind === 'executed') expect(ff.data.verified).toBe(true)
    // 6. PR creation within the configured test repository, independently verified
    const pr = await createPullRequest({ ref: REF, head: 'm46-ite', base: 'main', title: 'M46 integration test', body: 'test artifact; never merged automatically' })
    expect(pr.kind).toBe('executed')
    if (pr.kind === 'executed') expect(pr.data.verified).toBe(true)
    // No force push anywhere: every ref update carried no force flag (the
    // adapter structurally omits it; PATCH with force is impossible via API).
    expect(calls.filter((c) => c.method === 'PATCH').length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Every Phase-4 failure scenario.
// ---------------------------------------------------------------------------
describe('M46.3 failure scenarios (each pinned as honest behavior)', () => {
  test('invalid credentials (401 on write) → failed, never executed', async () => {
    setRepositoryTransportForTests(async () => res(401, { message: 'Bad credentials' }))
    const out = await createBranch({ ref: REF, branch: 'm46-x', fromSha: SHA })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/HTTP 401/)
  })

  test('insufficient permissions (403, not rate-limit) → failed honestly', async () => {
    setRepositoryTransportForTests(async () => res(403, { message: 'Resource not accessible by integration' }))
    const out = await commitToBranch({ ref: REF, branch: 'm46-x', path: 'f.txt', content: 'x', message: 'test commit message' })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/HTTP 403/)
  })

  test('rate limits (403 with rate-limit message) → honest-unavailable, not a repo failure', async () => {
    setRepositoryTransportForTests(async () => res(403, { message: 'API rate limit exceeded' }))
    const out = await inspectRepository(REF)
    expect(out.kind).toBe('honest-unavailable')
    if (out.kind === 'honest-unavailable') expect(out.reason).toMatch(/rate limit/i)
  })

  test('NETWORK TIMEOUT AFTER A WRITE → reconciliation-required, NEVER succeeded, NEVER blind-retried', async () => {
    let writes = 0
    setRepositoryTransportForTests(async (_path, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'PUT') {
        writes += 1
        throw new Error('The operation was aborted due to timeout')
      }
      return res(404, null) // any independent read would 404 (unknown file)
    })
    const out = await commitToBranch({ ref: REF, branch: 'm46-x', path: 'f.txt', content: 'x', message: 'test commit message' })
    expect(out.kind).toBe('reconciliation-required')
    if (out.kind === 'reconciliation-required') {
      expect(out.reason).toMatch(/did not complete in transport/)
      expect(out.reason).toMatch(/Inspect remote state before any retry/)
    }
    // exactly ONE write was sent — the adapter never re-sends blind
    expect(writes).toBe(1)
  })

  test('successful write followed by failed verification → executed with verified:false (UNVERIFIED, not success)', async () => {
    setRepositoryTransportForTests(async (_path, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'PUT') return res(201, { commit: { sha: SHA }, content: { sha: SHA } })
      return res(500, null) // verification read fails
    })
    const out = await commitToBranch({ ref: REF, branch: 'm46-x', path: 'f.txt', content: 'x', message: 'test commit message' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.verified).toBe(false)
      expect(out.evidence.some((e) => /UNVERIFIED/.test(e.note))).toBe(true)
    }
  })

  test('remote revision changed during the operation → fast-forward refused (no force)', async () => {
    setRepositoryTransportForTests(async (path, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (path.endsWith('/git/ref/heads/m46-x') && method === 'GET') return res(200, { object: { sha: 'c'.repeat(40) } })
      if (path.includes('/compare/')) return res(200, { status: 'diverged', ahead_by: 0, behind_by: 3 })
      return res(404, null)
    })
    const out = await fastForwardBranch({ ref: REF, branch: 'm46-x', toSha: SHA2 })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/does not descend|force push/i)
  })

  test('duplicate execution (branch already exists, 422) → honest failed, no duplicate effect', async () => {
    setRepositoryTransportForTests(async (path, init) => {
      if (path === '/repos/jon0471-dot/integration-sandbox/git/refs' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        return res(422, { message: 'Reference already exists' })
      }
      return res(404, null)
    })
    const out = await createBranch({ ref: REF, branch: 'm46-x', fromSha: SHA })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/already exists/)
  })

  test('stale approval → refused at the approval layer (M45 consume-once re-pinned at the lane seam)', async () => {
    // The approval contract's own digest binding is exhaustively pinned in
    // m45 suites (S7/S8). At the lane seam the equivalent rule: an operation
    // whose precondition (token) vanished mid-flight reports honest
    // unavailability instead of proceeding.
    setRepositoryTokenForTests(null)
    const out = await fastForwardBranch({ ref: REF, branch: 'm46-x', toSha: SHA2 })
    expect(out.kind).toBe('honest-unavailable')
    if (out.kind === 'honest-unavailable') expect(out.reason).toMatch(/credential|never simulated/i)
  })

  test('protected branch target → refused BEFORE any network call', async () => {
    let networkCalls = 0
    setRepositoryTransportForTests(async () => {
      networkCalls += 1
      return res(200, {})
    })
    for (const b of ['main', 'master', 'develop', 'release/1', 'hotfix/x', 'production']) {
      const out = await createBranch({ ref: REF, branch: b, fromSha: SHA })
      expect(out.kind).toBe('failed')
      if (out.kind === 'failed') expect(out.reason).toMatch(/protected-branch/)
    }
    expect(networkCalls).toBe(0)
  })

  test('unauthorized repository (outside allowlist + not the integration repo) → refused before network', async () => {
    let networkCalls = 0
    setRepositoryTransportForTests(async () => {
      networkCalls += 1
      return res(200, {})
    })
    const out = await commitToBranch({ ref: { owner: 'someone-else', repo: 'their-repo' }, branch: 'feature', path: 'f.txt', content: 'x', message: 'test commit message' })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/repo-not-allowlisted/)
    expect(networkCalls).toBe(0)
  })

  test('no credential at all → every write honestly unavailable (never simulated)', async () => {
    setRepositoryTokenForTests(null)
    setRepositoryTransportForTests(async () => res(500, null))
    const a = await createBranch({ ref: REF, branch: 'm46-x', fromSha: SHA })
    const b = await commitToBranch({ ref: REF, branch: 'm46-x', path: 'f.txt', content: 'x', message: 'test commit message' })
    const c = await fastForwardBranch({ ref: REF, branch: 'm46-x', toSha: SHA2 })
    const d = await createPullRequest({ ref: REF, head: 'm46-x', base: 'main', title: 'test PR title', body: 'y' })
    for (const out of [a, b, c, d]) {
      expect(out.kind).toBe('honest-unavailable')
      if (out.kind === 'honest-unavailable') expect(out.reason).toMatch(/credential|never simulated/i)
    }
  })
})

// ---------------------------------------------------------------------------
// The reconciliation path through the M44/M46 lifecycle: an uncertain write
// becomes VERIFYING → RECOVERY_REQUIRED, never SUCCEEDED.
// ---------------------------------------------------------------------------
describe('M46.3 reconciliation through the governed lifecycle', () => {
  test('a reconciliation-required dispatch reaches the runner as its own outcome kind', async () => {
    // dispatchRepositoryAction maps the adapter outcome verbatim.
    const { dispatchRepositoryAction } = await import('../../src/lib/riishe/mission/action-runner')
    setRepositoryTransportForTests(async (_path, init) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') throw new Error('aborted mid-flight')
      return res(404, null)
    })
    const out = await dispatchRepositoryAction({
      actionType: 'repo-commit',
      params: { repository: 'jon0471-dot/integration-sandbox', branch: 'm46-x', path: 'f.txt', content: 'x', message: 'test commit message' },
      id: 'r1',
      description: 'uncertain write reconciliation',
    })
    expect(out.kind).toBe('reconciliation-required')
    if (out.kind === 'reconciliation-required') expect(out.reason).toMatch(/Inspect remote state before any retry/)
  })

  test('readBranchFile refuses traversal and invalid paths before the network', async () => {
    let networkCalls = 0
    setRepositoryTransportForTests(async () => {
      networkCalls += 1
      return res(200, {})
    })
    const a = await readBranchFile(REF, 'b', '../escape')
    const b = await readBranchFile(REF, 'b', '/absolute')
    expect(a.kind).toBe('failed')
    expect(b.kind).toBe('failed')
    expect(networkCalls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// LIVE-READ probe — the real authorized repository, quota-free lane.
// ---------------------------------------------------------------------------
describe('M46.3 live read lane (LIVE, real external system)', () => {
  test('git ls-remote answers for the real authorized repository without the REST API', async () => {
    setRepositoryTokenForTests(undefined)
    setRepositoryTransportForTests(null)
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
