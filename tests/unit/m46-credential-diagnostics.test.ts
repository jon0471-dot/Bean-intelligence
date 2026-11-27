/**
 * M46.2 tests — GitHub credential readiness diagnostics.
 *
 * Classification: LOCAL-INTEGRATION — real modules with an injected
 * transport (the same seam pattern as the M45 repository adapter). No real
 * token is ever present in this suite: the "configured" cases run through a
 * transport override keyed on token presence, and every assertion pins that
 * NO token material can reach any diagnostic field.
 *
 * The suite also runs the REAL diagnostic against the REAL environment
 * (which has no token configured) and pins that honest state as behavior.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test'

import {
  diagnoseGitHubCredential,
  setCredentialTransportForTests,
  setCredentialTokenForTests,
  AUTH_FAILURE_CATEGORIES,
  type DiagnosticResponse,
} from '../../src/lib/riishe/mission/credential-diagnostics'
import { setRepositoryTokenForTests } from '../../src/lib/riishe/mission/repository-adapter'

const FAKE_TOKEN_VALUE = 'ghp_SUPERSECRETVALUE_never_leaks_1234567890'

function ok(json: unknown): DiagnosticResponse {
  return { status: 200, json }
}

afterAll(() => {
  setCredentialTransportForTests(null)
  setCredentialTokenForTests(undefined)
  delete process.env.BEAN_REPO_ALLOWLIST
})

describe('M46.2 credential diagnostic — configured path (injected transport)', () => {
  beforeEach(() => {
    // "configured" is simulated through the two test seams — the real env
    // stays untouched and NO real secret exists in this suite.
    setCredentialTokenForTests(FAKE_TOKEN_VALUE)
    setCredentialTransportForTests(() => async (path) => {
      if (path === '/user') return ok({ login: 'jon0471-dot' })
      if (path.startsWith('/repos/jon0471-dot/Bean-intelligence')) {
        return ok({ full_name: 'jon0471-dot/Bean-intelligence', default_branch: 'main', permissions: { pull: true, push: true, admin: false, maintain: true } })
      }
      if (path.startsWith('/repos/jon0471-dot/')) return { status: 404, json: { message: 'Not Found' } }
      return { status: 404, json: null }
    })
    // Point the allowlist at two repos for the scope matrix (env convention).
    process.env.BEAN_REPO_ALLOWLIST = 'jon0471-dot/Bean-intelligence,jon0471-dot/integration-sandbox'
    void setRepositoryTokenForTests(null) // adapter seam untouched; diagnostic reads env itself
  })

  test('valid authentication reports the login and honest expiration disclosure', async () => {
    const d = await diagnoseGitHubCredential()
    expect(d.state).toBe('configured')
    expect(d.authentication?.validated).toBe(true)
    expect(d.authentication?.failureCategory).toBe('none')
    expect(d.authentication?.login).toBe('jon0471-dot')
    expect(d.expiration.disclosedByProvider).toBe(false)
    expect(d.expiration.note).toMatch(/does not disclose/)
  })

  test('per-repository scope validation reports GitHub permission flags and 404 honestly', async () => {
    const d = await diagnoseGitHubCredential()
    expect(d.repositories.length).toBe(2)
    const primary = d.repositories.find((r) => r.repository === 'jon0471-dot/Bean-intelligence')!
    expect(primary.readable).toBe(true)
    expect(primary.permissions.pull).toBe(true)
    expect(primary.permissions.push).toBe(true)
    expect(primary.permissions.admin).toBe(false)
    expect(primary.defaultBranch).toBe('main')
    const sandbox = d.repositories.find((r) => r.repository === 'jon0471-dot/integration-sandbox')!
    expect(sandbox.readable).toBe(false)
    expect(sandbox.note).toMatch(/404|Not accessible/)
  })

  test('no token material can reach any diagnostic field', async () => {
    const d = await diagnoseGitHubCredential()
    const serialized = JSON.stringify(d)
    expect(serialized).not.toContain(FAKE_TOKEN_VALUE)
    expect(serialized).not.toContain('ghp_')
    // The env NAMES are disclosed; values never are.
    expect(d.envNames.token).toBe('GITHUB_TOKEN')
  })
})

describe('M46.2 credential diagnostic — failure categories', () => {
  test('401 classifies auth-invalid with a replace-through-environment note', async () => {
    setCredentialTransportForTests(() => async (path) => (path === '/user' ? { status: 401, json: { message: 'Bad credentials' } } : { status: 401, json: null }))
    const d = await diagnoseGitHubCredential()
    expect(d.authentication?.failureCategory).toBe('auth-invalid')
    expect(d.authentication?.validated).toBe(false)
    expect(d.authentication?.note).toMatch(/revoked|expired|wrong/)
    // scope checks are skipped (meaningless without auth)
    expect(d.repositories.every((r) => r.note.includes('Skipped'))).toBe(true)
  })

  test('rate limiting classifies as honest unavailability, not an invalid token', async () => {
    setCredentialTransportForTests(() => async () => ({ status: 403, json: { message: 'API rate limit exceeded' } }))
    const d = await diagnoseGitHubCredential()
    expect(d.authentication?.failureCategory).toBe('rate-limited')
    expect(d.authentication?.note).toMatch(/rate limit|quota/i)
  })

  test('network failure draws NO conclusion about the token itself', async () => {
    setCredentialTransportForTests(() => async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const d = await diagnoseGitHubCredential()
    expect(d.authentication?.failureCategory).toBe('network-unavailable')
    expect(d.authentication?.note).toMatch(/could not reach GitHub/)
    expect(d.authentication?.note).toMatch(/no conclusion about the token/i)
  })

  test('the failure vocabulary is complete and ordered', () => {
    expect(AUTH_FAILURE_CATEGORIES).toEqual(['none', 'not-configured', 'auth-invalid', 'rate-limited', 'network-unavailable'])
  })
})

describe('M46.2 credential diagnostic — the REAL environment (honest state pinned)', () => {
  test('this deployment honestly reports not-configured with public-read fallback', async () => {
    setCredentialTransportForTests(null)
    setCredentialTokenForTests(undefined) // the REAL env applies (no token present)
    delete process.env.BEAN_REPO_ALLOWLIST // the real default allowlist applies
    const d = await diagnoseGitHubCredential()
    expect(d.state).toBe('not-configured')
    expect(d.publicReadFallback).toBe(true)
    expect(d.authentication?.failureCategory).toBe('not-configured')
    expect(d.authentication?.note).toMatch(/WRITES require a credential/)
    expect(d.authentication?.note).toMatch(/never through chat/)
    expect(d.allowlist.length).toBeGreaterThan(0)
    // and still no token material anywhere
    expect(JSON.stringify(d)).not.toContain('ghp_')
  })
})
