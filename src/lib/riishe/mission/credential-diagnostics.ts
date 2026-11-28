/**
 * BEAN Intelligence — M46.2: GitHub credential readiness diagnostics
 * (SERVER ONLY).
 *
 * M45's repository adapter reads `GITHUB_TOKEN` from the server environment
 * (never from prompts, model context, or responses). M46 adds the readiness
 * diagnostic the milestone requires: an operations seam that reports —
 * WITHOUT EVER DISCLOSING THE CREDENTIAL VALUE —
 *
 *   - configured / not configured (and what that honestly means);
 *   - live authentication validation result (valid / invalid / revoked);
 *   - per-repository scope validation for the REAL allowlist;
 *   - the permission flags GitHub reports for this credential
 *     (pull / push / admin / maintain — least-privilege visibility);
 *   - a precise failure category for everything that did not validate
 *     (not-configured / auth-invalid / rate-limited / network-unavailable);
 *   - expiration state, honestly: the provider does not disclose token
 *     expiry over the API, so the field says exactly that rather than
 *     inventing a date.
 *
 * The token passes through this module ONLY into the Authorization header
 * of its own transport (same discipline as the M45 adapter). It is never
 * logged, never returned, and never included in any diagnostic field.
 * No secret ever enters the model context: this module is not reachable
 * from any tool the model can call — it is an operator/ops seam.
 */

import { recordAudit } from '@/lib/observability/metering'
import { repositoryAllowlist, integrationRepository, writeLaneAvailability, checkWriteBranchPolicy, PRODUCTION_REPOSITORY, type RepoRef } from './repository-adapter'

// ---------------------------------------------------------------------------
// Types — every field is disclosure-safe by construction.
// ---------------------------------------------------------------------------

export type CredentialState = 'configured' | 'not-configured'

export type AuthFailureCategory =
  | 'none'
  | 'not-configured'
  | 'auth-invalid' // 401 — token unknown to GitHub (revoked, deleted, or mistyped env)
  | 'rate-limited' // 403/429 with a rate-limit message — honest unavailability
  | 'network-unavailable'

export interface RepoScopeCheck {
  repository: string
  /** GitHub says this credential can see the repo. */
  readable: boolean
  /** GitHub-reported permission flags for this credential (least privilege). */
  permissions: { pull: boolean | null; push: boolean | null; admin: boolean | null; maintain: boolean | null }
  defaultBranch: string | null
  note: string
}

export interface CredentialDiagnostic {
  /** Static configuration facts. */
  state: CredentialState
  /** Env var NAMES consulted (never values). */
  envNames: { token: string; allowlist: string; apiBase: string }
  apiBaseConfigured: boolean
  allowlist: string[]
  /** Live validation (null sections when validation could not run). */
  authentication: {
    validated: boolean
    failureCategory: AuthFailureCategory
    /** GitHub login owning the token (safe to display; NOT the token). */
    login: string | null
    note: string
  } | null
  expiration: {
    /** GitHub does not expose token expiry via the API — stated, not invented. */
    disclosedByProvider: false
    note: string
  }
  repositories: RepoScopeCheck[]
  /** When true, unauthenticated public reads still work (rate-limited). */
  publicReadFallback: boolean
  checkedAt: string
}

// ---------------------------------------------------------------------------
// Transport — injectable for tests; real fetch in production.
// ---------------------------------------------------------------------------

export interface DiagnosticResponse {
  status: number
  json: unknown
}

export type DiagnosticFetch = (path: string) => Promise<DiagnosticResponse>

function buildDefaultFetch(token: string | null): DiagnosticFetch {
  return async (path) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bean-intelligence-m46-diagnostics',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(`${apiBase()}${path}`, { method: 'GET', headers, signal: controller.signal })
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

let diagnosticTransportOverride: ((tokenPresent: boolean) => DiagnosticFetch) | null = null
let tokenOverrideForTests: string | null | undefined

/** Test seam: swap the transport per token-state (never used in production). */
export function setCredentialTransportForTests(fn: ((tokenPresent: boolean) => DiagnosticFetch) | null): void {
  diagnosticTransportOverride = fn
}

/** Test seam: pin the token STATE (present/absent) without real secrets. */
export function setCredentialTokenForTests(token: string | null | undefined): void {
  tokenOverrideForTests = token
}

function apiBase(): string {
  return process.env.BEAN_GITHUB_API_BASE?.trim() || 'https://api.github.com'
}

/** The token NEVER leaves this scope except into the auth header. */
function credentialToken(): string | null {
  if (tokenOverrideForTests !== undefined) return tokenOverrideForTests
  return process.env.GITHUB_TOKEN?.trim() || null
}

// ---------------------------------------------------------------------------
// The diagnostic.
// ---------------------------------------------------------------------------

function rateLimited(status: number, json: unknown): boolean {
  if (status !== 403 && status !== 429) return false
  const msg = (json as { message?: string } | null)?.message ?? ''
  return /rate limit/i.test(msg)
}

function parseRepoScope(json: unknown): { fullName: string | null; defaultBranch: string | null; permissions: RepoScopeCheck['permissions'] } {
  const rec = (json ?? {}) as { full_name?: unknown; default_branch?: unknown; permissions?: Record<string, unknown> }
  const p = rec.permissions ?? {}
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
  return {
    fullName: typeof rec.full_name === 'string' ? rec.full_name : null,
    defaultBranch: typeof rec.default_branch === 'string' ? rec.default_branch : null,
    permissions: { pull: bool(p.pull), push: bool(p.push), admin: bool(p.admin), maintain: bool(p.maintain) },
  }
}

/**
 * Run the full credential readiness diagnostic. Safe to call repeatedly;
 * every call re-reads configuration (env changes are visible immediately)
 * and re-runs the live probes (an audit event records the OUTCOME only).
 */
export async function diagnoseGitHubCredential(): Promise<CredentialDiagnostic> {
  const token = credentialToken()
  const state: CredentialState = token ? 'configured' : 'not-configured'
  const allowlist = repositoryAllowlist()
  const base: CredentialDiagnostic = {
    state,
    envNames: { token: 'GITHUB_TOKEN', allowlist: 'BEAN_REPO_ALLOWLIST', apiBase: 'BEAN_GITHUB_API_BASE' },
    apiBaseConfigured: Boolean(process.env.BEAN_GITHUB_API_BASE?.trim()),
    allowlist,
    authentication: null,
    expiration: {
      disclosedByProvider: false,
      note: 'GitHub does not disclose token expiration through the API. Check the token\'s expiry in the GitHub settings that issued it; a 401 on any later run means it was revoked, expired or replaced (reported as auth-invalid, never guessed).',
    },
    repositories: [],
    publicReadFallback: !token,
    checkedAt: new Date().toISOString(),
  }

  if (!token) {
    base.authentication = {
      validated: false,
      failureCategory: 'not-configured',
      login: null,
      note:
        'GITHUB_TOKEN is not configured in this deployment. Read-only inspection of PUBLIC repositories still works through the unauthenticated API (subject to GitHub\'s per-IP rate limits, reported as honest unavailability when exhausted). Repository WRITES require a credential — the write lane stays unavailable until the owner configures one through the deployment environment (never through chat).',
    }
    void recordAudit({ actorId: 'm46-credential-diagnostics', action: 'm46.credential_diagnostic', target: 'github', meta: { state, category: 'not-configured' } }).catch(() => undefined)
    return base
  }

  const fetcher = diagnosticTransportOverride ? diagnosticTransportOverride(true) : buildDefaultFetch(token)

  // Step 1 — authentication validation (GET /user).
  let authCategory: AuthFailureCategory = 'none'
  let login: string | null = null
  let authNote = 'Token validated against GitHub (GET /user succeeded); the login above is the credential owner.'
  try {
    const res = await fetcher('/user')
    if (res.status === 200) {
      const rec = (res.json ?? {}) as { login?: unknown }
      login = typeof rec.login === 'string' ? rec.login : null
    } else if (res.status === 401) {
      authCategory = 'auth-invalid'
      authNote = 'GitHub rejected this credential (401). The token is revoked, expired, or the env value is wrong. Replace it through the deployment environment — never through chat.'
    } else if (rateLimited(res.status, res.json)) {
      authCategory = 'rate-limited'
      authNote = 'GitHub API rate limit was reached while validating the credential. This is honest unavailability of the quota, not an invalid token; retry later.'
    } else {
      authCategory = 'network-unavailable'
      authNote = `Credential validation did not complete (HTTP ${res.status}). Treated as unavailable rather than guessed.`
    }
  } catch (e) {
    authCategory = 'network-unavailable'
    authNote = `Credential validation could not reach GitHub (${(e instanceof Error ? e.message : 'network error').slice(0, 120)}). No conclusion about the token itself is drawn.`
  }
  base.authentication = { validated: authCategory === 'none', failureCategory: authCategory, login, note: authNote }

  // Step 2 — per-repository scope validation for the REAL allowlist.
  if (authCategory === 'none') {
    for (const full of allowlist) {
      const [owner, repo] = full.split('/')
      const ref: RepoRef = { owner: owner ?? '', repo: repo ?? '' }
      let check: RepoScopeCheck = {
        repository: full,
        readable: false,
        permissions: { pull: null, push: null, admin: null, maintain: null },
        defaultBranch: null,
        note: 'Not validated (authentication did not complete).',
      }
      try {
        const res = await fetcher(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`)
        if (res.status === 200) {
          const parsed = parseRepoScope(res.json)
          check = {
            repository: full,
            readable: true,
            permissions: parsed.permissions,
            defaultBranch: parsed.defaultBranch,
            note: `Readable${parsed.fullName && parsed.fullName !== full ? ` (resolves to ${parsed.fullName})` : ''}; permission flags are GitHub's own report for this credential.`,
          }
        } else if (res.status === 404) {
          check.note = 'Not accessible with this credential (404): the repository does not exist, is private, or the credential lacks scope for it. The allowlist entry does NOT expand access — access is validated, never assumed.'
        } else if (rateLimited(res.status, res.json)) {
          check.note = 'Rate limit reached during scope validation — honest unavailability; retry later.'
        } else {
          check.note = `Scope validation returned HTTP ${res.status}; treated as unavailable rather than guessed.`
        }
      } catch (e) {
        check.note = `Scope validation could not reach GitHub (${(e instanceof Error ? e.message : 'network error').slice(0, 120)}).`
      }
      base.repositories.push(check)
    }
  } else {
    for (const full of allowlist) {
      base.repositories.push({
        repository: full,
        readable: false,
        permissions: { pull: null, push: null, admin: null, maintain: null },
        defaultBranch: null,
        note: `Skipped: authentication ${authCategory === 'rate-limited' ? 'was rate-limited' : 'did not validate'} — scope checks would be meaningless.`,
      })
    }
  }

  void recordAudit({ actorId: 'm46-credential-diagnostics', action: 'm46.credential_diagnostic', target: 'github', meta: { state, category: authCategory, reposChecked: base.repositories.length } }).catch(() => undefined)
  return base
}

/** Test/ops seam: the failure categories in report order. */
export const AUTH_FAILURE_CATEGORIES: readonly AuthFailureCategory[] = [
  'none',
  'not-configured',
  'auth-invalid',
  'rate-limited',
  'network-unavailable',
]

// ---------------------------------------------------------------------------
// M48.1 — the ONE authoritative GitHub write-readiness decision.
//
// History: writeLaneAvailability() originally reported ready from
// configuration presence alone (token + BEAN_TEST_REPOSITORY names), while
// the actual write operations separately ran checkRepoPolicy() — a target
// could be "ready" and then rejected by the allowlist. This assessment
// closes that gap structurally: it derives EVERY fact from the SAME
// primitives the write path runs (writeLaneAvailability's projection now
// includes the production-repository protection and the real
// checkRepoPolicy call) and adds the LIVE facts (authentication,
// repository accessibility, GitHub-reported permission flags). A fact the
// probes cannot establish is reported `unknown` — and unknown means the
// lane is NOT ready. It never reports ready from env-var presence alone,
// never invents token expiration, never confuses a rate limit with invalid
// authentication, and never mistakes public read access for write
// permission.
// ---------------------------------------------------------------------------

export type ReadinessFactState = 'ok' | 'not-ok' | 'unknown'

export interface WriteReadinessFact {
  /** Stable machine identifier, e.g. `credential-configured`. */
  id: string
  /** What this fact establishes, in operator language. */
  fact: string
  state: ReadinessFactState
  /** Disclosure-safe evidence note (never contains the credential). */
  note: string
}

export type WriteReadinessVerdict = 'ready' | 'not-ready'

export interface GitHubWriteReadiness {
  /**
   * TRUE only when EVERY required fact is individually established (no
   * `unknown`) AND none is `not-ok`. Any unknown ⇒ not ready.
   */
  available: boolean
  verdict: WriteReadinessVerdict
  /** The resolved integration repository (safe identifier), or null. */
  repository: string | null
  /** The eight required facts, in fixed report order. */
  facts: WriteReadinessFact[]
  /** Honest summary the readiness script and dashboards print verbatim. */
  summary: string
  checkedAt: string
}

/** A representative feature-branch name of the kind the write lane uses. */
const REPRESENTATIVE_FEATURE_BRANCH = 'bean-integration/acceptance-run'

/**
 * The authoritative write-readiness assessment: static policy projection
 * (from the repository adapter — the SAME module the writes run) plus live
 * credential validation through the existing diagnostic transport.
 */
export async function assessGitHubWriteReadiness(): Promise<GitHubWriteReadiness> {
  const facts: WriteReadinessFact[] = []
  const integration = integrationRepository()
  const repository = integration ? `${integration.owner}/${integration.repo}` : null

  // -- Facts 1 (credential exists) + 5 (dedicated repo configured) + 6
  //    (allowlist accepts it) + 7 (production repo protected) derive from
  //    writeLaneAvailability(), which now runs the REAL checkRepoPolicy.
  //    Its reason text identifies the first failing static fact; when it is
  //    satisfied, all four static facts are individually established.
  const lane = writeLaneAvailability()
  const tokenConfigured = lane.available || /GITHUB_TOKEN absent/.test(lane.reason) === false
  facts.push({
    id: 'credential-configured',
    fact: 'A GitHub credential exists in the server environment (GITHUB_TOKEN).',
    state: tokenConfigured ? 'ok' : 'not-ok',
    note: lane.available ? 'GITHUB_TOKEN is present (value never displayed).' : 'GITHUB_TOKEN is absent — writes are honestly unavailable, never simulated.',
  })

  facts.push({
    id: 'dedicated-integration-repository',
    fact: 'BEAN_TEST_REPOSITORY identifies a dedicated, disposable integration repository.',
    state: integration ? (repository === PRODUCTION_REPOSITORY ? 'not-ok' : 'ok') : 'not-ok',
    note: !integration
      ? 'BEAN_TEST_REPOSITORY is unset or malformed — no write target is configured and nothing is defaulted.'
      : repository === PRODUCTION_REPOSITORY
        ? 'The configured value IS the owner production repository — a production repository is never a disposable write target.'
        : `Configured target: ${repository} (explicitly configured; nothing auto-created).`,
  })

  const policyOk = lane.available // available:true implies checkRepoPolicy passed on the integration repo
  facts.push({
    id: 'allowlist-includes-integration-repository',
    fact: 'The integration repository is accepted by the same repository policy (BEAN_REPO_ALLOWLIST via checkRepoPolicy) every write operation runs.',
    state: integration ? (policyOk ? 'ok' : 'not-ok') : 'unknown',
    note: !integration
      ? 'Cannot be established without a configured integration repository.'
      : policyOk
        ? `checkRepoPolicy(${repository}) passes — the readiness projection and the write path share this exact function.`
        : `The write policy rejects ${repository} (${lane.reason}).`,
  })

  facts.push({
    id: 'production-repository-protected',
    fact: `The production repository (${PRODUCTION_REPOSITORY}) is not configured as the disposable write target.`,
    state: integration ? (repository === PRODUCTION_REPOSITORY ? 'not-ok' : 'ok') : 'ok',
    note: !integration
      ? 'No write target is configured, so the production repository is not the target.'
      : repository === PRODUCTION_REPOSITORY
        ? 'REFUSED: the production repository cannot serve as the disposable integration target.'
        : `Write target is ${repository}, not the production repository.`,
  })

  // -- Fact 8: branch policy permits the intended feature-branch operations
  //    (structural projection from the adapter's real branch policy).
  const branchProbe = checkWriteBranchPolicy(REPRESENTATIVE_FEATURE_BRANCH)
  const protectedRefused = !checkWriteBranchPolicy('main').ok
  facts.push({
    id: 'feature-branch-policy-permits',
    fact: 'Branch policy permits the intended feature-branch operations (and still refuses protected branches).',
    state: branchProbe.ok && protectedRefused ? 'ok' : 'not-ok',
    note: branchProbe.ok && protectedRefused
      ? `checkWriteBranchPolicy accepts feature branches (verified with "${REPRESENTATIVE_FEATURE_BRANCH}") and refuses protected names (verified with "main") — the same function every write runs.`
      : 'The branch policy no longer accepts the representative feature branch (or no longer refuses protected names) — the lane must not be reported ready.',
  })

  // -- Live facts 2 (authentication) + 3 (repository access) + 4 (GitHub-
  //    reported write permission) via the SAME transport seam the credential
  //    diagnostic uses. Unknown when the probes cannot establish them.
  const token = credentialToken()
  const push = (state: ReadinessFactState, id: string, fact: string, note: string): void => {
    facts.push({ id, fact, state, note })
  }

  if (!token) {
    push('unknown', 'github-authentication', 'GitHub authentication succeeds for the credential (live GET /user).', 'Not verified: no credential is configured, so there is nothing to authenticate.')
    push('unknown', 'integration-repository-accessible', 'The credential can access the configured integration repository (live GET /repos/…).', 'Not verified: no credential is configured.')
    push('unknown', 'write-permission-reported', 'GitHub reports sufficient write permission for the credential on the integration repository (permissions.push).', 'Not verified: no credential is configured. Public read access never implies write permission.')
  } else {
    const fetcher = diagnosticTransportOverride ? diagnosticTransportOverride(true) : buildDefaultFetch(token)
    let authOk: boolean | null = null
    let authNote = ''
    try {
      const res = await fetcher('/user')
      if (res.status === 200) {
        authOk = true
        const login = (res.json as { login?: unknown } | null)?.login
        authNote = `GET /user succeeded${typeof login === 'string' ? ` — credential owner: ${login}` : ''} (login displayed; the token never is).`
      } else if (res.status === 401) {
        authOk = false
        authNote = 'GitHub rejected the credential (401): revoked, expired or wrong env value — replace it through the deployment environment, never through chat.'
      } else if (rateLimited(res.status, res.json)) {
        authNote = 'Rate limit reached during validation — honest quota unavailability, NOT an invalid token; the fact stays unknown until a later run succeeds.'
      } else {
        authNote = `Authentication probe returned HTTP ${res.status} — no conclusion drawn; the fact stays unknown.`
      }
    } catch (e) {
      authNote = `Authentication probe could not reach GitHub (${(e instanceof Error ? e.message : 'network error').slice(0, 120)}) — no conclusion about the token itself; unknown.`
    }
    push(authOk === null ? 'unknown' : authOk ? 'ok' : 'not-ok', 'github-authentication', 'GitHub authentication succeeds for the credential (live GET /user).', authNote)

    if (!integration) {
      push('unknown', 'integration-repository-accessible', 'The credential can access the configured integration repository (live GET /repos/…).', 'Not verified: BEAN_TEST_REPOSITORY is unset — there is no target to probe.')
      push('unknown', 'write-permission-reported', 'GitHub reports sufficient write permission for the credential on the integration repository (permissions.push).', 'Not verified: BEAN_TEST_REPOSITORY is unset — there is no target to probe.')
    } else if (authOk === false) {
      push('not-ok', 'integration-repository-accessible', 'The credential can access the configured integration repository (live GET /repos/…).', 'Skipped: authentication did not validate — a rejected credential accesses nothing.')
      push('not-ok', 'write-permission-reported', 'GitHub reports sufficient write permission for the credential on the integration repository (permissions.push).', 'Skipped: authentication did not validate.')
    } else {
      let accessState: ReadinessFactState = 'unknown'
      let accessNote = ''
      let pushFlag: boolean | null = null
      let permNote = ''
      try {
        const res = await fetcher(`/repos/${encodeURIComponent(integration.owner)}/${encodeURIComponent(integration.repo)}`)
        if (res.status === 200) {
          const parsed = parseRepoScope(res.json)
          accessState = 'ok'
          accessNote = `GET /repos succeeded for ${repository}${parsed.fullName && parsed.fullName !== repository ? ` (resolves to ${parsed.fullName})` : ''}; visibility/access validated, never assumed from the allowlist.`
          pushFlag = parsed.permissions.push
          permNote = pushFlag
            ? `GitHub reports permissions.push=true for this credential on ${repository} — the provider's own least-privilege report (pull=${parsed.permissions.pull}, push=${parsed.permissions.push}, admin=${parsed.permissions.admin}, maintain=${parsed.permissions.maintain}).`
            : `GitHub reports permissions.push=${String(pushFlag)} for this credential on ${repository} — READ access never implies WRITE permission; the lane is not ready until GitHub itself reports push.`
        } else if (res.status === 404) {
          accessState = 'not-ok'
          accessNote = `The configured integration repository ${repository} is not accessible with this credential (404): it does not exist, is private to someone else, or the credential lacks scope. The allowlist does NOT expand access.`
          permNote = 'No permission report: the repository is not accessible to this credential.'
        } else if (rateLimited(res.status, res.json)) {
          accessNote = 'Rate limit reached during the repository probe — honest quota unavailability; access and permission stay unknown until a later run.'
          permNote = 'No permission report: the probe was rate-limited.'
        } else {
          accessNote = `Repository probe returned HTTP ${res.status} — no conclusion drawn; unknown.`
          permNote = 'No permission report: the probe did not complete.'
        }
      } catch (e) {
        accessNote = `Repository probe could not reach GitHub (${(e instanceof Error ? e.message : 'network error').slice(0, 120)}) — unknown, no conclusion drawn.`
        permNote = 'No permission report: the probe did not complete.'
      }
      push(accessState, 'integration-repository-accessible', 'The credential can access the configured integration repository (live GET /repos/…).', accessNote)
      push(pushFlag === null ? (authOk === true && accessState === 'ok' ? 'unknown' : accessState === 'not-ok' ? 'not-ok' : 'unknown') : pushFlag ? 'ok' : 'not-ok', 'write-permission-reported', 'GitHub reports sufficient write permission for the credential on the integration repository (permissions.push).', permNote)
    }
  }

  const available = facts.every((f) => f.state === 'ok')
  const blocking = facts.filter((f) => f.state === 'not-ok').map((f) => f.id)
  const unknowns = facts.filter((f) => f.state === 'unknown').map((f) => f.id)
  const summary = available
    ? `WRITE LANE READY — all ${facts.length} required facts established and satisfied for ${repository} (feature branches only; every write independently verified; owner retains all merge authority).`
    : `WRITE LANE NOT READY — ${blocking.length ? `failing: ${blocking.join(', ')}` : ''}${blocking.length && unknowns.length ? '; ' : ''}${unknowns.length ? `unverified: ${unknowns.join(', ')} (unknown is not ready)` : ''}. The readiness decision uses the same repository resolution and policy functions as the write path, so it can never promise what a write would refuse.`

  void recordAudit({ actorId: 'm48-write-readiness', action: 'm48.write_readiness_assessment', target: repository ?? 'unconfigured', meta: { available, blocking: blocking.length, unknown: unknowns.length } }).catch(() => undefined)

  return { available, verdict: available ? 'ready' : 'not-ready', repository, facts, summary, checkedAt: new Date().toISOString() }
}
