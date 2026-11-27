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
import { repositoryAllowlist, type RepoRef } from './repository-adapter'

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
