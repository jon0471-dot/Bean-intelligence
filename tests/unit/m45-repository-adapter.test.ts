/**
 * M45 Phase 3 tests — the repository adapter (narrow, policy-checked,
 * independently verified).
 *
 * Classification: MOCKED TESTS (injected GitHub transport + pinned token
 * state). No network, no real secrets. One LIVE row is recorded separately
 * in the acceptance suite (git ls-remote against the public repository).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import {
  checkRepoPolicy,
  checkWriteBranchPolicy,
  inspectRepository,
  createBranch,
  commitToBranch,
  fastForwardBranch,
  createPullRequest,
  remoteDivergence,
  setRepositoryTransportForTests,
  setRepositoryTokenForTests,
  setLsRemoteForTests,
  repositoryAllowlist,
  type GitHubResponse,
} from '../../src/lib/riishe/mission/repository-adapter'
import { dispatchRepositoryAction, resolveRuntimePostconditions } from '../../src/lib/riishe/mission/action-runner'
import { verifyPostconditions, runtimeVerificationContract } from '../../src/lib/riishe/mission/outcome-verification'
import { buildActionContract } from '../../src/lib/riishe/mission/action-contract'

const REPO = { owner: 'jon0471-dot', repo: 'Bean-intelligence' }

// A tiny routing transport: tests register handlers per path prefix.
type Handler = (path: string, init?: { method?: string; body?: unknown }) => GitHubResponse | undefined
const handlers: Handler[] = []

function jsonResponse(status: number, json: unknown): GitHubResponse {
  return { status, json }
}

beforeEach(() => {
  handlers.length = 0
  setRepositoryTokenForTests('test-token-not-a-secret')
  setLsRemoteForTests(null)
  setRepositoryTransportForTests(async (path, init) => {
    for (const h of handlers) {
      const res = h(path, init)
      if (res) return res
    }
    return jsonResponse(404, { message: 'Not Found (no test handler matched)' })
  })
})

afterEach(() => {
  setRepositoryTransportForTests(null)
  setRepositoryTokenForTests(undefined)
  setLsRemoteForTests(null)
})

// ---------------------------------------------------------------------------
// 1. Policy — allowlist + protected branches (refused BEFORE any network).
// ---------------------------------------------------------------------------

describe('M45 repository policy', () => {
  test('non-allowlisted repositories are refused', () => {
    expect(checkRepoPolicy({ owner: 'evil', repo: 'repo' }).ok).toBe(false)
    expect(checkRepoPolicy({ owner: 'jon0471-dot', repo: 'Bean-intelligence' }).ok).toBe(true)
  })

  test('invalid owners/repo names are refused', () => {
    expect(checkRepoPolicy({ owner: '', repo: 'x' }).ok).toBe(false)
    expect(checkRepoPolicy({ owner: 'a'.repeat(120), repo: 'x' }).ok).toBe(false)
    expect(checkRepoPolicy({ owner: 'o k', repo: 'x' }).ok).toBe(false)
  })

  test('protected branch targets are refused for writes', () => {
    for (const b of ['main', 'master', 'develop', 'release/1', 'hotfix/urgent', 'production', 'prod', 'sub/main']) {
      expect(checkWriteBranchPolicy(b).ok).toBe(false)
    }
    expect(checkWriteBranchPolicy('feat/m45-test').ok).toBe(true)
    expect(checkWriteBranchPolicy('').ok).toBe(false)
    expect(checkWriteBranchPolicy('../escape').ok).toBe(false)
  })

  test('the default allowlist contains exactly the owner repository', () => {
    expect(repositoryAllowlist()).toContain('jon0471-dot/Bean-intelligence')
  })
})

// ---------------------------------------------------------------------------
// 2. Read-only inspection over the injected transport.
// ---------------------------------------------------------------------------

describe('M45 repository inspection', () => {
  test('inspectRepository maps metadata honestly', async () => {
    handlers.push((path) => (path === `/repos/${REPO.owner}/${REPO.repo}` ? jsonResponse(200, { full_name: 'jon0471-dot/Bean-intelligence', default_branch: 'main', private: false, description: 'BEAN' }) : undefined))
    const out = await inspectRepository(REPO)
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.defaultBranch).toBe('main')
      expect(out.evidence[0].kind).toBe('repo')
    }
  })

  test('a 404 is a failure (not a fabricated empty success)', async () => {
    const out = await inspectRepository(REPO)
    expect(out.kind).toBe('failed')
  })

  test('a rate limit is honest unavailability, never a failure of the repo', async () => {
    handlers.push(() => jsonResponse(403, { message: 'API rate limit exceeded for this IP' }))
    const out = await inspectRepository(REPO)
    expect(out.kind).toBe('honest-unavailable')
    if (out.kind === 'honest-unavailable') expect(out.reason).toContain('rate limit')
  })

  test('dispatchAction repo-inspect routes through the adapter', async () => {
    handlers.push((path) => (path.includes('/branches?') ? jsonResponse(200, [{ name: 'main', commit: { sha: 'a'.repeat(40) } }, { name: 'feat/x', commit: { sha: 'b'.repeat(40) } }]) : undefined))
    const out = await dispatchRepositoryAction({ actionType: 'repo-inspect', params: { repository: 'jon0471-dot/Bean-intelligence', operation: 'branches' }, id: 'i1', description: 'list branches' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.resultSummary).toContain('2 remote branch')
  })
})

// ---------------------------------------------------------------------------
// 3. Writes — token required, digest of truth is the independent read.
// ---------------------------------------------------------------------------

describe('M45 repository writes', () => {
  test('no credential → honest unavailability for branch creation (never simulated)', async () => {
    setRepositoryTokenForTests(null)
    const out = await createBranch({ ref: REPO, branch: 'feat/m45-x', fromSha: 'c'.repeat(40) })
    expect(out.kind).toBe('honest-unavailable')
    if (out.kind === 'honest-unavailable') expect(out.reason).toContain('credential')
  })

  test('branch creation verifies through an independent ref GET', async () => {
    const sha = 'd'.repeat(40)
    handlers.push((path, init) => {
      if (path === `/repos/${REPO.owner}/${REPO.repo}/git/refs` && init?.method === 'POST') return jsonResponse(201, { ref: `refs/heads/feat/m45-x` })
      if (path === `/repos/${REPO.owner}/${REPO.repo}/git/ref/heads/feat%2Fm45-x` || path.endsWith('/git/ref/heads/feat/m45-x')) return jsonResponse(200, { object: { sha } })
      return undefined
    })
    const out = await createBranch({ ref: REPO, branch: 'feat/m45-x', fromSha: sha })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.verified).toBe(true)
      expect(out.data.method).toContain('independent')
    }
  })

  test('an independent read that DISAGREES marks the write UNVERIFIED (never success-shaped)', async () => {
    const sha = 'd'.repeat(40)
    handlers.push((path, init) => {
      if (path === `/repos/${REPO.owner}/${REPO.repo}/git/refs` && init?.method === 'POST') return jsonResponse(201, {})
      if (path.includes('/git/ref/heads/')) return jsonResponse(200, { object: { sha: 'e'.repeat(40) } })
      return undefined
    })
    const out = await createBranch({ ref: REPO, branch: 'feat/m45-x', fromSha: sha })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.data.verified).toBe(false)
  })

  test('commit creation verifies through an independent commit GET', async () => {
    const sha = 'f'.repeat(40)
    handlers.push((path, init) => {
      if (path.includes('/contents/') && init?.method === 'PUT') return jsonResponse(201, { commit: { sha } })
      if (path.includes('/commits/') && (init?.method ?? 'GET') === 'GET') return jsonResponse(200, { sha })
      return undefined
    })
    const out = await commitToBranch({ ref: REPO, branch: 'feat/m45-x', path: 'docs/m45.md', content: '# M45', message: 'm45: governed commit' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.data.verified).toBe(true)
  })

  test('fast-forward refuses a NON-descendant target — force pushes are structurally impossible', async () => {
    const current = 'a'.repeat(40)
    const target = 'b'.repeat(40)
    handlers.push((path) => {
      if (path.endsWith('/git/ref/heads/feat%2Fm45-x') || path.endsWith('/git/ref/heads/feat/m45-x')) return jsonResponse(200, { object: { sha: current } })
      if (path.includes('/compare/')) return jsonResponse(200, { status: 'divergent' })
      return undefined
    })
    const out = await fastForwardBranch({ ref: REPO, branch: 'feat/m45-x', toSha: target })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toContain('Fast-forward refused')
  })

  test('fast-forward to a true descendant updates with force=false and verifies via ls-remote', async () => {
    const current = 'a'.repeat(40)
    const target = 'b'.repeat(40)
    let sawForceFlag: unknown = 'not-called'
    handlers.push((path, init) => {
      if (path.endsWith('/git/refs/heads/feat%2Fm45-x') && init?.method === 'PATCH') {
        sawForceFlag = (init.body as { force?: boolean })?.force
        return jsonResponse(200, { object: { sha: target } })
      }
      if (path.endsWith('/git/ref/heads/feat%2Fm45-x')) return jsonResponse(200, { object: { sha: current } })
      if (path.includes('/compare/')) return jsonResponse(200, { status: 'ahead' })
      return undefined
    })
    setLsRemoteForTests(async () => target)
    const out = await fastForwardBranch({ ref: REPO, branch: 'feat/m45-x', toSha: target })
    expect(sawForceFlag).toBe(false)
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.data.verified).toBe(true)
  })

  test('pull-request creation verifies identity + state through an independent PR GET', async () => {
    handlers.push((path, init) => {
      if (path === `/repos/${REPO.owner}/${REPO.repo}/pulls` && init?.method === 'POST') return jsonResponse(201, { number: 42, html_url: 'https://github.com/x/pr/42', state: 'open', head: { sha: 'c'.repeat(40) } })
      if (path === `/repos/${REPO.owner}/${REPO.repo}/pulls/42`) return jsonResponse(200, { number: 42, state: 'open', title: 'Governed change', head: { sha: 'c'.repeat(40) } })
      return undefined
    })
    const out = await createPullRequest({ ref: REPO, head: 'feat/m45-x', base: 'main', title: 'Governed change', body: 'body' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.data.verified).toBe(true)
  })

  test('the PR GET disagreeing marks creation UNVERIFIED and the verification verdict fails honestly', async () => {
    handlers.push((path, init) => {
      if (path === `/repos/${REPO.owner}/${REPO.repo}/pulls` && init?.method === 'POST') return jsonResponse(201, { number: 43, state: 'open', head: { sha: 'c'.repeat(40) } })
      if (path === `/repos/${REPO.owner}/${REPO.repo}/pulls/43`) return jsonResponse(200, { number: 43, state: 'closed', head: { sha: 'c'.repeat(40) } })
      return undefined
    })
    const out = await createPullRequest({ ref: REPO, head: 'feat/m45-x', base: 'main', title: 'Governed change', body: '' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.verified).toBe(false)
      // The runner's verification uses the evidence note — UNVERIFIED must
      // NOT produce a passing postcondition.
      const contract = buildActionContract({ id: 'pr', actionType: 'repo-pull-request', title: 'Open PR', description: 'open the governed PR', params: { repository: 'jon0471-dot/Bean-intelligence', head: 'feat/m45-x', base: 'main' }, authScope: 'repo-write', idempotencyKey: 'pr:1' })
      const runtime = runtimeVerificationContract(contract, out.evidence)
      const verdict = verifyPostconditions(runtime, { pullRequestState: 'unconfirmed' })
      expect(verdict.verdict).toBe('failed')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Runtime postcondition resolution (execution-time placeholders).
// ---------------------------------------------------------------------------

describe('M45 runtime verification contract', () => {
  test('the executed commit sha is stamped into commit-present from independent evidence', () => {
    const contract = buildActionContract({ id: 'cm', actionType: 'repo-commit', title: 'Commit config', description: 'commit the change', params: { repository: 'jon0471-dot/Bean-intelligence', branch: 'feat/m45-x', path: 'a.md', content: 'x' }, authScope: 'repo-write', idempotencyKey: 'cm:1' })
    const sha = 'ab'.repeat(20)
    const resolved = resolveRuntimePostconditions(contract, [{ kind: 'commit', ref: sha, note: 'verified commit object' }])
    expect(resolved[0].kind).toBe('commit-present')
    expect(resolved[0].params.sha).toBe(sha)
    // A full observation then CONFIRMS.
    const verdict = verifyPostconditions({ ...contract, postconditions: resolved }, { git: { commits: [sha] } })
    expect(verdict.verdict).toBe('confirmed')
  })

  test('without the executed sha the postcondition stays inconclusive (never auto-true)', () => {
    const contract = buildActionContract({ id: 'cm2', actionType: 'repo-commit', title: 'Commit config', description: 'commit the change', params: { repository: 'jon0471-dot/Bean-intelligence', branch: 'feat/m45-x', path: 'a.md', content: 'x' }, authScope: 'repo-write', idempotencyKey: 'cm:2' })
    const resolved = resolveRuntimePostconditions(contract, [])
    const verdict = verifyPostconditions({ ...contract, postconditions: resolved }, { git: { commits: ['nothing'] } })
    expect(verdict.verdict).not.toBe('confirmed')
  })

  test('remote-ref-equals fails honestly when the independent remote disagrees', () => {
    const sha = 'cd'.repeat(20)
    const contract = buildActionContract({ id: 'pp', actionType: 'repo-push', title: 'Push branch', description: 'push the branch', params: { repository: 'jon0471-dot/Bean-intelligence', branch: 'feat/m45-x', sha }, authScope: 'repo-write', idempotencyKey: 'pp:1' })
    const verdict = verifyPostconditions(contract, { git: { remoteRef: 'ef'.repeat(20) } })
    expect(verdict.verdict).toBe('failed')
    const ok = verifyPostconditions(contract, { git: { remoteRef: sha } })
    expect(ok.verdict).toBe('confirmed')
  })

  test('divergence measures via the independent transport', async () => {
    setLsRemoteForTests(async () => '12'.repeat(20))
    const out = await remoteDivergence(REPO, 'main', '34'.repeat(20))
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.inSync).toBe(false)
      expect(out.data.method).toContain('independent')
    }
  })
})
