/**
 * BEAN Intelligence — M45 Phase 3: the repository adapter (SERVER ONLY).
 *
 * The REAL execution path for repository actions — the capability M44
 * classified but could not run ("no real execution path in BEAN today").
 * This adapter is deliberately NARROW:
 *
 *   - typed operations with explicit parameters and policy checks; there is
 *     NO generic shell, NO arbitrary command surface;
 *   - an allowlist of repositories (env-overridable, owner-controlled);
 *   - branch-target restrictions: writes only to feature branches; the
 *     protected/main branch names are refused BEFORE any network call, and
 *     server-side branch protection is still respected at the API layer;
 *   - no force pushes and no history rewriting: the ref-update path is
 *     fast-forward only (the ancestor check runs first; the API call never
 *     carries a force flag);
 *   - the token (GITHUB_TOKEN) is read from the server environment inside
 *     this module and is NEVER returned, logged, or placed in any result
 *     that reaches the model or the Trust ledger;
 *   - every write is followed by an INDEPENDENT verification read through a
 *     DIFFERENT method than the write (a plain ref/commit GET, or a local
 *     `git ls-remote` when available) — a 2xx from the write call alone is
 *     never treated as completion.
 *
 * Read-only inspection works without a token against public repos (subject
 * to the platform's unauthenticated rate limits, which are reported as an
 * honest unavailability, never as a failure of the target repo).
 */

import { recordAudit } from '@/lib/observability/metering'

// ---------------------------------------------------------------------------
// Policy — the narrow world this adapter may touch.
// ---------------------------------------------------------------------------

export const REPOSITORY_ADAPTER_LIMITS = {
  maxRepos: 8,
  branchChars: 200,
  ownerChars: 100,
  shaHex: 40,
  messageChars: 4000,
  contentChars: 400_000,
  prTitleChars: 300,
  prBodyChars: 20_000,
  maxFilesPerCommit: 10,
  listBound: 30,
  timeoutMs: 20_000,
} as const

const PROTECTED_BRANCH_RE = /^(main|master|develop|release[/-].*|hotfix[/-].*|production|prod)$/i

/** Repositories the adapter may touch (owner-controlled via env). */
export function repositoryAllowlist(): string[] {
  const raw = process.env.BEAN_REPO_ALLOWLIST?.trim()
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, REPOSITORY_ADAPTER_LIMITS.maxRepos)
    if (list.length > 0) return list
  }
  return ['jon0471-dot/Bean-intelligence']
}

export interface RepoRef {
  owner: string
  repo: string
}

export type RepoPolicyRejection =
  | { ok: true }
  | { ok: false; reason: 'repo-not-allowlisted' | 'invalid-owner' | 'invalid-repo' }

/** The allowlist check EVERY operation runs first. */
export function checkRepoPolicy(ref: RepoRef): RepoPolicyRejection {
  const owner = String(ref.owner ?? '').trim()
  const repo = String(ref.repo ?? '').trim()
  if (!owner || owner.length > REPOSITORY_ADAPTER_LIMITS.ownerChars || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(owner)) {
    return { ok: false, reason: 'invalid-owner' }
  }
  if (!repo || repo.length > REPOSITORY_ADAPTER_LIMITS.ownerChars || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repo)) {
    return { ok: false, reason: 'invalid-repo' }
  }
  const full = `${owner}/${repo}`
  if (!repositoryAllowlist().includes(full)) return { ok: false, reason: 'repo-not-allowlisted' }
  return { ok: true }
}

export type BranchPolicyRejection =
  | { ok: true }
  | { ok: false; reason: 'protected-branch' | 'invalid-branch' | 'branch-too-long' }

/** Write-target branch policy: feature branches only, never protected names. */
export function checkWriteBranchPolicy(branch: string): BranchPolicyRejection {
  const b = String(branch ?? '').trim()
  if (!b) return { ok: false, reason: 'invalid-branch' }
  if (b.length > REPOSITORY_ADAPTER_LIMITS.branchChars) return { ok: false, reason: 'branch-too-long' }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/.test(b)) return { ok: false, reason: 'invalid-branch' }
  if (PROTECTED_BRANCH_RE.test(b) || b.endsWith('/main') || b.endsWith('/master')) {
    return { ok: false, reason: 'protected-branch' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// The GitHub transport seam — injectable for tests; real fetch in production.
// ---------------------------------------------------------------------------

export interface GitHubResponse {
  status: number
  json: unknown
}

export type GitHubFetch = (path: string, init?: { method?: string; body?: unknown; accept?: string }) => Promise<GitHubResponse>

function githubApiBase(): string {
  return process.env.BEAN_GITHUB_API_BASE?.trim() || 'https://api.github.com'
}

function buildDefaultFetch(token: string | null): GitHubFetch {
  return async (path, init) => {
    const headers: Record<string, string> = {
      Accept: init?.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bean-intelligence-m45',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REPOSITORY_ADAPTER_LIMITS.timeoutMs)
    try {
      const res = await fetch(`${githubApiBase()}${path}`, {
        method: init?.method ?? 'GET',
        headers,
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      return { status: res.status, json }
    } finally {
      clearTimeout(timer)
    }
  }
}

let fetchOverrideForTests: GitHubFetch | null = null
let tokenOverrideForTests: string | null | undefined
let lsRemoteOverrideForTests: ((ref: RepoRef, branch: string) => Promise<string | null>) | null = null

/** Test seam: swap the transport (never used in production code). */
export function setRepositoryTransportForTests(fetcher: GitHubFetch | null): void {
  fetchOverrideForTests = fetcher
}

/** Test seam: pin the token state (present/absent) without real secrets. */
export function setRepositoryTokenForTests(token: string | null | undefined): void {
  tokenOverrideForTests = token
}

/** Test seam: pin the independent ls-remote query (hermetic verification tests). */
export function setLsRemoteForTests(fn: ((ref: RepoRef, branch: string) => Promise<string | null>) | null): void {
  lsRemoteOverrideForTests = fn
}

/** The token NEVER leaves this function's scope except into the auth header. */
function tokenForRequests(): string | null {
  if (tokenOverrideForTests !== undefined) return tokenOverrideForTests
  return process.env.GITHUB_TOKEN?.trim() || null
}

function transport(): GitHubFetch {
  return fetchOverrideForTests ?? buildDefaultFetch(tokenForRequests())
}

// ---------------------------------------------------------------------------
// Typed outcomes.
// ---------------------------------------------------------------------------

export type RepoOutcome<T> =
  | { kind: 'executed'; data: T; evidence: Array<{ kind: string; ref: string; note: string }> }
  | { kind: 'failed'; reason: string }
  | { kind: 'honest-unavailable'; reason: string }

function rateLimitNote(status: number, json: unknown): string | null {
  if (status !== 403 && status !== 429) return null
  const msg = (json as { message?: string } | null)?.message ?? ''
  if (/rate limit/i.test(msg)) {
    return `GitHub API rate limit reached (${tokenForRequests() ? 'authenticated' : 'unauthenticated'} quota). Retry later — this is an honest unavailability, not a repository problem.`
  }
  return null
}

async function gh(path: string, init?: { method?: string; body?: unknown; accept?: string }): Promise<RepoOutcome<GitHubResponse>> {
  try {
    const res = await transport()(path, init)
    const rl = rateLimitNote(res.status, res.json)
    if (rl) return { kind: 'honest-unavailable', reason: rl }
    return { kind: 'executed', data: res, evidence: [] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { kind: 'failed', reason: `GitHub request failed: ${msg.slice(0, 200)}` }
  }
}

// ---------------------------------------------------------------------------
// Read-only operations (policy-checked, bounded).
// ---------------------------------------------------------------------------

export async function inspectRepository(ref: RepoRef): Promise<RepoOutcome<{ fullName: string; defaultBranch: string | null; privateFlag: unknown; description: string | null }>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const res = await gh(`/repos/${ref.owner}/${ref.repo}`)
  if (res.kind !== 'executed') return res
  if (res.data.status === 404) return { kind: 'failed', reason: 'Repository not found (or not visible to this token).' }
  if (res.data.status !== 200) return { kind: 'failed', reason: `Repository inspection returned HTTP ${res.data.status}.` }
  const j = res.data.json as { full_name?: string; default_branch?: string; private?: boolean; description?: string | null }
  return {
    kind: 'executed',
    data: { fullName: j.full_name ?? `${ref.owner}/${ref.repo}`, defaultBranch: j.default_branch ?? null, privateFlag: j.private, description: j.description ?? null },
    evidence: [{ kind: 'repo', ref: j.full_name ?? `${ref.owner}/${ref.repo}`, note: `default branch ${j.default_branch ?? 'unknown'}` }],
  }
}

export async function listBranches(ref: RepoRef): Promise<RepoOutcome<Array<{ name: string; sha: string | null }>>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const res = await gh(`/repos/${ref.owner}/${ref.repo}/branches?per_page=${REPOSITORY_ADAPTER_LIMITS.listBound}`)
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Branch listing returned HTTP ${res.data.status}.` }
  const rows = (Array.isArray(res.data.json) ? res.data.json : []) as Array<{ name: string; commit?: { sha?: string } }>
  return {
    kind: 'executed',
    data: rows.slice(0, REPOSITORY_ADAPTER_LIMITS.listBound).map((b) => ({ name: b.name, sha: b.commit?.sha ?? null })),
    evidence: rows.slice(0, 6).map((b) => ({ kind: 'branch', ref: b.name, note: b.commit?.sha?.slice(0, 12) ?? '' })),
  }
}

export async function listCommits(ref: RepoRef, branch: string): Promise<RepoOutcome<Array<{ sha: string; message: string }>>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const b = encodeURIComponent(branch)
  const res = await gh(`/repos/${ref.owner}/${ref.repo}/commits?sha=${b}&per_page=${REPOSITORY_ADAPTER_LIMITS.listBound}`)
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Commit listing returned HTTP ${res.data.status}.` }
  const rows = (Array.isArray(res.data.json) ? res.data.json : []) as Array<{ sha: string; commit?: { message?: string } }>
  return {
    kind: 'executed',
    data: rows.slice(0, REPOSITORY_ADAPTER_LIMITS.listBound).map((c) => ({ sha: c.sha, message: (c.commit?.message ?? '').slice(0, 200) })),
    evidence: rows.slice(0, 4).map((c) => ({ kind: 'commit', ref: c.sha.slice(0, 12), note: (c.commit?.message ?? '').slice(0, 120) })),
  }
}

export async function compareRevisions(ref: RepoRef, base: string, head: string): Promise<RepoOutcome<{ status: string; aheadBy: number; behindBy: number; files: Array<{ filename: string; status: string }> }>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const res = await gh(`/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`)
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Comparison returned HTTP ${res.data.status}.` }
  const j = res.data.json as { status?: string; ahead_by?: number; behind_by?: number; files?: Array<{ filename: string; status: string }> }
  return {
    kind: 'executed',
    data: {
      status: j.status ?? 'unknown',
      aheadBy: j.ahead_by ?? 0,
      behindBy: j.behind_by ?? 0,
      files: (j.files ?? []).slice(0, REPOSITORY_ADAPTER_LIMITS.listBound).map((f) => ({ filename: f.filename, status: f.status })),
    },
    evidence: [{ kind: 'compare', ref: `${base}...${head}`, note: `${j.ahead_by ?? 0} ahead / ${j.behind_by ?? 0} behind` }],
  }
}

export async function listPullRequests(ref: RepoRef, state: 'open' | 'closed' | 'all' = 'open'): Promise<RepoOutcome<Array<{ number: number; title: string; headSha: string | null; state: string }>>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const res = await gh(`/repos/${ref.owner}/${ref.repo}/pulls?state=${state}&per_page=${REPOSITORY_ADAPTER_LIMITS.listBound}`)
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Pull-request listing returned HTTP ${res.data.status}.` }
  const rows = (Array.isArray(res.data.json) ? res.data.json : []) as Array<{ number: number; title: string; state: string; head?: { sha?: string } }>
  return {
    kind: 'executed',
    data: rows.slice(0, REPOSITORY_ADAPTER_LIMITS.listBound).map((p) => ({ number: p.number, title: p.title, headSha: p.head?.sha ?? null, state: p.state })),
    evidence: rows.slice(0, 5).map((p) => ({ kind: 'pull-request', ref: `#${p.number}`, note: `${p.state} ${p.title.slice(0, 120)}` })),
  }
}

export async function getPullRequest(ref: RepoRef, number: number): Promise<RepoOutcome<{ number: number; state: string; title: string; headSha: string | null; merged: boolean }>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  if (!Number.isInteger(number) || number <= 0 || number > 1_000_000) return { kind: 'failed', reason: 'Invalid pull-request number.' }
  const res = await gh(`/repos/${ref.owner}/${ref.repo}/pulls/${number}`)
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Pull-request lookup returned HTTP ${res.data.status}.` }
  const j = res.data.json as { number: number; state: string; title: string; merged?: boolean; head?: { sha?: string } }
  return {
    kind: 'executed',
    data: { number: j.number, state: j.state, title: j.title, headSha: j.head?.sha ?? null, merged: j.merged ?? false },
    evidence: [{ kind: 'pull-request', ref: `#${j.number}`, note: `${j.state}${j.merged ? ' (merged)' : ''} head ${j.head?.sha?.slice(0, 12) ?? '?'}` }],
  }
}

/**
 * Divergence between a LOCAL ref and the REMOTE ref, measured by
 * `git ls-remote` — an independent transport (git protocol, no API quota).
 * Returns the remote tip and whether the local value matches.
 */
export async function remoteDivergence(ref: RepoRef, branch: string, localSha: string | null): Promise<RepoOutcome<{ remoteSha: string | null; inSync: boolean; method: string }>> {
  const policy = checkRepoPolicy(ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const b = String(branch ?? '').trim()
  if (!b) return { kind: 'failed', reason: 'A branch is required.' }
  const lsRemote = await lsRemoteRef(ref, b)
  if (lsRemote.kind !== 'executed') return lsRemote
  const remote = lsRemote.data
  return {
    kind: 'executed',
    data: { remoteSha: remote, inSync: !!remote && !!localSha && remote === localSha, method: 'git ls-remote (independent transport)' },
    evidence: [{ kind: 'remote-ref', ref: `${ref.owner}/${ref.repo}@${b}`, note: `remote ${remote?.slice(0, 12) ?? 'unset'} vs local ${localSha?.slice(0, 12) ?? 'unset'}` }],
  }
}

async function lsRemoteRef(ref: RepoRef, branch: string): Promise<RepoOutcome<string | null>> {
  if (lsRemoteOverrideForTests) {
    try {
      return { kind: 'executed', data: await lsRemoteOverrideForTests(ref, branch), evidence: [] }
    } catch (e) {
      return { kind: 'failed', reason: `The independent remote query failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }
    }
  }
  try {
    const { execFile } = await import('node:child_process')
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        ['ls-remote', `https://github.com/${ref.owner}/${ref.repo}.git`, `refs/heads/${branch}`],
        { timeout: REPOSITORY_ADAPTER_LIMITS.timeoutMs },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout ?? ''))),
      )
    })
    const sha = out.split('\t')[0]?.trim() ?? ''
    return { kind: 'executed', data: /^[0-9a-f]{40}$/.test(sha) ? sha : null, evidence: [] }
  } catch (e) {
    // git unavailable or network refused — fall back to the API ref read.
    const res = await gh(`/repos/${ref.owner}/${ref.repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    if (res.kind !== 'executed') return res
    if (res.data.status !== 200) return { kind: 'executed', data: null, evidence: [] }
    const j = res.data.json as { object?: { sha?: string } }
    return { kind: 'executed', data: j.object?.sha ?? null, evidence: [] }
  }
}

// ---------------------------------------------------------------------------
// Approved write operations — each followed by an INDEPENDENT verification.
// ---------------------------------------------------------------------------

export interface CreateBranchInput {
  ref: RepoRef
  branch: string
  fromSha: string
}

export async function createBranch(input: CreateBranchInput): Promise<RepoOutcome<{ branch: string; sha: string; verified: boolean; method: string }>> {
  const policy = checkRepoPolicy(input.ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const branch = checkWriteBranchPolicy(input.branch)
  if (!branch.ok) return { kind: 'failed', reason: `Branch refused by policy (${branch.reason}).` }
  const sha = String(input.fromSha ?? '').trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) return { kind: 'failed', reason: 'A full 40-hex source commit SHA is required.' }
  const token = tokenForRequests()
  if (!token) return { kind: 'honest-unavailable', reason: 'No GitHub credential is configured for this deployment — branch creation is unavailable (never simulated).' }

  const res = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${input.branch}`, sha },
  })
  if (res.kind !== 'executed') return res
  if (res.data.status === 422) return { kind: 'failed', reason: 'The branch already exists (or the reference is invalid).' }
  if (res.data.status !== 201) return { kind: 'failed', reason: `Branch creation returned HTTP ${res.data.status}.` }

  // INDEPENDENT verification: a plain ref GET (different call class than the write).
  const verify = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`)
  let verified = false
  if (verify.kind === 'executed' && verify.data.status === 200) {
    const j = verify.data.json as { object?: { sha?: string } }
    verified = j.object?.sha === sha
  }
  await recordAudit({ actorId: 'm45-repository-adapter', action: 'm45.repo_branch_created', target: `${input.ref.owner}/${input.ref.repo}@${input.branch}`, meta: { sha: sha.slice(0, 12), verified } }).catch(() => undefined)
  return {
    kind: 'executed',
    data: { branch: input.branch, sha, verified, method: 'independent ref GET after creation' },
    evidence: [{ kind: 'branch', ref: input.branch, note: `${verified ? 'verified' : 'UNVERIFIED'} at ${sha.slice(0, 12)}` }],
  }
}

export interface CommitToBranchInput {
  ref: RepoRef
  branch: string
  path: string
  content: string
  message: string
}

export async function commitToBranch(input: CommitToBranchInput): Promise<RepoOutcome<{ sha: string | null; branch: string; path: string; verified: boolean; method: string }>> {
  const policy = checkRepoPolicy(input.ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const branch = checkWriteBranchPolicy(input.branch)
  if (!branch.ok) return { kind: 'failed', reason: `Branch refused by policy (${branch.reason}).` }
  const path = String(input.path ?? '').trim()
  if (!path || path.length > 400 || path.includes('..') || path.startsWith('/')) return { kind: 'failed', reason: 'Invalid file path.' }
  const message = String(input.message ?? '').trim()
  if (message.length < 3 || message.length > REPOSITORY_ADAPTER_LIMITS.messageChars) return { kind: 'failed', reason: 'A commit message of 3-4000 characters is required.' }
  if (String(input.content ?? '').length > REPOSITORY_ADAPTER_LIMITS.contentChars) return { kind: 'failed', reason: `Content exceeds its ${REPOSITORY_ADAPTER_LIMITS.contentChars}-character bound.` }
  const token = tokenForRequests()
  if (!token) return { kind: 'honest-unavailable', reason: 'No GitHub credential is configured for this deployment — commits are unavailable (never simulated).' }

  const res = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: { branch: input.branch, message, content: Buffer.from(input.content, 'utf8').toString('base64') },
  })
  if (res.kind !== 'executed') return res
  if (res.data.status === 404) return { kind: 'failed', reason: 'Branch or repository not found for the commit (404).' }
  if (res.data.status !== 200 && res.data.status !== 201) return { kind: 'failed', reason: `Commit returned HTTP ${res.data.status}.` }
  const j = res.data.json as { commit?: { sha?: string }; content?: { sha?: string } }
  const sha = j.commit?.sha ?? null

  // INDEPENDENT verification: commit GET (object-level, not the write receipt).
  let verified = false
  if (sha) {
    const verify = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/commits/${sha}`)
    verified = verify.kind === 'executed' && verify.data.status === 200
  }
  await recordAudit({ actorId: 'm45-repository-adapter', action: 'm45.repo_commit_created', target: `${input.ref.owner}/${input.ref.repo}@${input.branch}:${path}`, meta: { sha: sha?.slice(0, 12) ?? null, verified } }).catch(() => undefined)
  return {
    kind: 'executed',
    data: { sha, branch: input.branch, path, verified, method: 'independent commit GET after creation' },
    evidence: [{ kind: 'commit', ref: sha?.slice(0, 12) ?? 'unknown', note: `${verified ? 'verified' : 'UNVERIFIED'} commit on ${input.branch} for ${path}` }],
  }
}

export interface FastForwardBranchInput {
  ref: RepoRef
  branch: string
  toSha: string
}

/**
 * Fast-forward a remote feature branch to a descendant commit. The ancestor
 * relationship is VERIFIED first (compare API); a non-fast-forward update is
 * refused — this adapter structurally cannot force-push.
 */
export async function fastForwardBranch(input: FastForwardBranchInput): Promise<RepoOutcome<{ branch: string; sha: string; verified: boolean; method: string }>> {
  const policy = checkRepoPolicy(input.ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const branch = checkWriteBranchPolicy(input.branch)
  if (!branch.ok) return { kind: 'failed', reason: `Branch refused by policy (${branch.reason}).` }
  const toSha = String(input.toSha ?? '').trim()
  if (!/^[0-9a-f]{40}$/.test(toSha)) return { kind: 'failed', reason: 'A full 40-hex target commit SHA is required.' }
  const token = tokenForRequests()
  if (!token) return { kind: 'honest-unavailable', reason: 'No GitHub credential is configured for this deployment — ref updates are unavailable (never simulated).' }

  // Current remote tip.
  const current = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`)
  if (current.kind !== 'executed') return current
  if (current.data.status !== 200) return { kind: 'failed', reason: 'The branch does not exist on the remote.' }
  const currentSha = ((current.data.json as { object?: { sha?: string } }).object?.sha ?? '').trim()

  // Ancestry check: the current tip must be an ancestor of the target.
  if (currentSha && currentSha !== toSha) {
    const cmp = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/compare/${currentSha}...${toSha}`)
    if (cmp.kind !== 'executed') return cmp
    const status = ((cmp.data.json as { status?: string }).status ?? '').toLowerCase()
    if (status !== 'ahead' && status !== 'identical') {
      return { kind: 'failed', reason: 'Fast-forward refused: the target commit does not descend from the current remote tip (force pushes are structurally impossible here).' }
    }
  }

  const res = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, {
    method: 'PATCH',
    body: { sha: toSha, force: false },
  })
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Ref update returned HTTP ${res.data.status}.` }

  // INDEPENDENT verification through the other transport when possible.
  const ls = await lsRemoteRef(input.ref, input.branch)
  let verified = false
  let method = 'independent git ls-remote after update'
  if (ls.kind === 'executed' && ls.data) {
    verified = ls.data === toSha
  } else {
    const verify = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`)
    method = 'independent ref GET after update'
    if (verify.kind === 'executed' && verify.data.status === 200) {
      verified = ((verify.data.json as { object?: { sha?: string } }).object?.sha ?? '') === toSha
    }
  }
  await recordAudit({ actorId: 'm45-repository-adapter', action: 'm45.repo_branch_fast_forwarded', target: `${input.ref.owner}/${input.ref.repo}@${input.branch}`, meta: { toSha: toSha.slice(0, 12), verified } }).catch(() => undefined)
  return {
    kind: 'executed',
    data: { branch: input.branch, sha: toSha, verified, method },
    evidence: [{ kind: 'remote-ref', ref: `${input.branch}`, note: `${verified ? 'verified' : 'UNVERIFIED'} fast-forward to ${toSha.slice(0, 12)}` }],
  }
}

export interface CreatePullRequestInput {
  ref: RepoRef
  head: string
  base: string
  title: string
  body: string
}

export async function createPullRequest(input: CreatePullRequestInput): Promise<RepoOutcome<{ number: number | null; url: string | null; state: string | null; headSha: string | null; verified: boolean; method: string }>> {
  const policy = checkRepoPolicy(input.ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  const head = checkWriteBranchPolicy(input.head)
  if (!head.ok) return { kind: 'failed', reason: `Head branch refused by policy (${head.reason}).` }
  const title = String(input.title ?? '').trim()
  if (title.length < 3 || title.length > REPOSITORY_ADAPTER_LIMITS.prTitleChars) return { kind: 'failed', reason: 'A pull-request title of 3-300 characters is required.' }
  if (String(input.body ?? '').length > REPOSITORY_ADAPTER_LIMITS.prBodyChars) return { kind: 'failed', reason: `The pull-request body exceeds ${REPOSITORY_ADAPTER_LIMITS.prBodyChars} characters.` }
  const token = tokenForRequests()
  if (!token) return { kind: 'honest-unavailable', reason: 'No GitHub credential is configured for this deployment — pull-request creation is unavailable (never simulated).' }

  const res = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/pulls`, {
    method: 'POST',
    body: { head: input.head, base: input.base, title, body: String(input.body ?? '').slice(0, REPOSITORY_ADAPTER_LIMITS.prBodyChars) },
  })
  if (res.kind !== 'executed') return res
  if (res.data.status === 422) return { kind: 'failed', reason: 'GitHub refused the pull request (a PR may already exist for these branches, or the base is invalid).' }
  if (res.data.status !== 201) return { kind: 'failed', reason: `Pull-request creation returned HTTP ${res.data.status}.` }
  const j = res.data.json as { number?: number; html_url?: string; state?: string; head?: { sha?: string } }
  const number = j.number ?? null

  // INDEPENDENT verification: pull-request GET (identity + state + head).
  let verified = false
  if (number) {
    const verify = await getPullRequest(input.ref, number)
    verified = verify.kind === 'executed' && verify.data.state === 'open' && !!verify.data.headSha
  }
  await recordAudit({ actorId: 'm45-repository-adapter', action: 'm45.repo_pr_created', target: `${input.ref.owner}/${input.ref.repo}#${number ?? '?'}`, meta: { head: input.head, base: input.base, verified } }).catch(() => undefined)
  return {
    kind: 'executed',
    data: { number, url: j.html_url ?? null, state: j.state ?? null, headSha: j.head?.sha ?? null, verified, method: 'independent pull-request GET after creation' },
    evidence: [{ kind: 'pull-request', ref: `#${number ?? '?'}`, note: `${verified ? 'verified open' : 'UNVERIFIED'} PR ${input.head} → ${input.base}` }],
  }
}

export interface UpdatePullRequestInput {
  ref: RepoRef
  number: number
  title?: string
  body?: string
  state?: 'open' | 'closed'
}

export async function updatePullRequest(input: UpdatePullRequestInput): Promise<RepoOutcome<{ number: number; state: string; verified: boolean; method: string }>> {
  const policy = checkRepoPolicy(input.ref)
  if (!policy.ok) return { kind: 'failed', reason: `Repository refused by policy (${policy.reason}).` }
  if (!Number.isInteger(input.number) || (input.number ?? 0) <= 0) return { kind: 'failed', reason: 'Invalid pull-request number.' }
  if (input.state && input.state !== 'open' && input.state !== 'closed') return { kind: 'failed', reason: 'State must be open or closed.' }
  const token = tokenForRequests()
  if (!token) return { kind: 'honest-unavailable', reason: 'No GitHub credential is configured for this deployment — pull-request updates are unavailable (never simulated).' }

  const body: Record<string, string> = {}
  if (input.title) body.title = input.title.slice(0, REPOSITORY_ADAPTER_LIMITS.prTitleChars)
  if (input.body) body.body = input.body.slice(0, REPOSITORY_ADAPTER_LIMITS.prBodyChars)
  if (input.state) body.state = input.state
  if (Object.keys(body).length === 0) return { kind: 'failed', reason: 'Nothing to update.' }

  const res = await gh(`/repos/${input.ref.owner}/${input.ref.repo}/pulls/${input.number}`, { method: 'PATCH', body })
  if (res.kind !== 'executed') return res
  if (res.data.status !== 200) return { kind: 'failed', reason: `Pull-request update returned HTTP ${res.data.status}.` }

  const verify = await getPullRequest(input.ref, input.number)
  const verified = verify.kind === 'executed' && (!input.state || verify.data.state === input.state)
  return {
    kind: 'executed',
    data: { number: input.number, state: verify.kind === 'executed' ? verify.data.state : 'unknown', verified, method: 'independent pull-request GET after update' },
    evidence: [{ kind: 'pull-request', ref: `#${input.number}`, note: `${verified ? 'verified' : 'UNVERIFIED'} update` }],
  }
}

function encodePath(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/')
}

/** Test/ops seam: the policy vocabulary in registration order. */
export const REPOSITORY_POLICY_SEAM = {
  protectedBranches: ['main', 'master', 'develop', 'release/*', 'hotfix/*', 'production', 'prod'],
  writesRequireToken: true,
  forcePushSupported: false,
} as const
