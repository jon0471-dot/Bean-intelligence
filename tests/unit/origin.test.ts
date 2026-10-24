/**
 * BEAN Intelligence — unit tests for the strict trusted-origin policy.
 * Run: bun test tests/unit/origin.test.ts
 *
 * The policy under test (src/lib/api/origin.ts):
 *   - safe methods always allowed
 *   - no Origin header -> allowed (non-browser client)
 *   - Origin: null / unparsable -> rejected
 *   - Sec-Fetch-Site: cross-site -> rejected unconditionally
 *   - otherwise Origin must be allowlisted via
 *     BEAN_TRUSTED_ORIGINS (exact) / BEAN_TRUSTED_ORIGIN_SUFFIXES
 *     (https-only, dot-boundary) or loopback in non-production.
 */
import { describe, test, expect } from 'bun:test'
import {
  isAllowedApiMutation,
  normalizeOrigin,
  checkApiMutationOrigin,
  type OriginPolicyEnv,
} from '../../src/lib/api/origin'

const env = (over: Partial<OriginPolicyEnv> = {}): OriginPolicyEnv => ({
  BEAN_TRUSTED_ORIGINS: 'https://bean.example.com,https://staging.bean.example.com:8443',
  BEAN_TRUSTED_ORIGIN_SUFFIXES: 'space-z.ai',
  NODE_ENV: 'production',
  ...over,
})

describe('normalizeOrigin', () => {
  test('lowercases scheme and host, strips default ports', () => {
    expect(normalizeOrigin('HTTPS://APP.Example.COM:443')).toBe('https://app.example.com')
    expect(normalizeOrigin('http://LOCALHOST:80/')).toBe('http://localhost')
    expect(normalizeOrigin('https://Preview-X.Space-Z.AI')).toBe('https://preview-x.space-z.ai')
  })

  test('keeps non-default ports', () => {
    expect(normalizeOrigin('https://staging.bean.example.com:8443')).toBe(
      'https://staging.bean.example.com:8443',
    )
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  test('rejects credentials, path, query, hash and non-http schemes', () => {
    expect(normalizeOrigin('https://user:pass@bean.example.com')).toBeNull()
    expect(normalizeOrigin('https://bean.example.com/api')).toBeNull()
    expect(normalizeOrigin('https://bean.example.com?x=1')).toBeNull()
    expect(normalizeOrigin('https://bean.example.com#frag')).toBeNull()
    expect(normalizeOrigin('ftp://bean.example.com')).toBeNull()
    expect(normalizeOrigin('not a url')).toBeNull()
    expect(normalizeOrigin('')).toBeNull()
  })
})

describe('isAllowedApiMutation — method and header basics', () => {
  test('safe methods are always allowed, even with hostile origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isAllowedApiMutation(method, 'https://evil.example', null, env())).toBe(true)
      expect(isAllowedApiMutation(method, 'null', null, env())).toBe(true)
    }
  })

  test('unsafe method matching is case-insensitive', () => {
    expect(isAllowedApiMutation('post', 'https://evil.example', null, env())).toBe(false)
  })

  test('missing Origin header is allowed (non-browser clients)', () => {
    expect(isAllowedApiMutation('POST', null, null, env())).toBe(true)
    expect(isAllowedApiMutation('DELETE', null, null, env())).toBe(true)
  })

  test('Sec-Fetch-Site cross-site is rejected even when Origin would pass', () => {
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', 'cross-site', env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', 'CROSS-SITE', env())).toBe(false)
  })

  test('same-origin / same-site / none fetch metadata does not override Origin policy', () => {
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', 'same-origin', env())).toBe(true)
    expect(isAllowedApiMutation('POST', 'https://evil.example', 'same-origin', env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', 'same-site', env())).toBe(true)
  })
})

describe('isAllowedApiMutation — opaque and unparsable origins', () => {
  test('Origin: null is rejected (unverifiable opaque origin)', () => {
    const d = checkApiMutationOrigin('null', null, env())
    expect(d.allowed).toBe(false)
    expect(d.rejection).toBe('opaque-origin')
  })

  test('unparsable origin is rejected with reason', () => {
    const d = checkApiMutationOrigin('////', null, env())
    expect(d.allowed).toBe(false)
    expect(d.rejection).toBe('unparsable-origin')
  })

  test('origin with embedded credentials is not allowlisted', () => {
    expect(isAllowedApiMutation('POST', 'https://user:pass@bean.example.com', null, env())).toBe(false)
  })
})

describe('isAllowedApiMutation — exact origin allowlist', () => {
  test('exact match allowed', () => {
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', null, env())).toBe(true)
    expect(isAllowedApiMutation('PUT', 'https://staging.bean.example.com:8443', null, env())).toBe(true)
  })

  test('scheme or port mismatch is rejected', () => {
    expect(isAllowedApiMutation('POST', 'http://bean.example.com', null, env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://bean.example.com:8443', null, env())).toBe(false)
  })

  test('unlisted host is rejected, including look-alikes', () => {
    expect(isAllowedApiMutation('POST', 'https://evil.example', null, env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://bean.example.com.evil.io', null, env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://notbean.example.com', null, env())).toBe(false)
  })

  test('default-port normalization allows the canonical spelling', () => {
    const e = env({ BEAN_TRUSTED_ORIGINS: 'https://bean.example.com:443' })
    expect(isAllowedApiMutation('POST', 'https://bean.example.com', null, e)).toBe(true)
  })

  test('invalid allowlist entries are ignored (fail closed)', () => {
    const e = env({
      BEAN_TRUSTED_ORIGINS: 'https://user:pass@x.com,not a url,https://ok.example.com',
    })
    expect(isAllowedApiMutation('POST', 'https://ok.example.com', null, e)).toBe(true)
    expect(isAllowedApiMutation('POST', 'https://x.com', null, e)).toBe(false)
  })
})

describe('isAllowedApiMutation — configured suffix scope (https-only, dot-boundary)', () => {
  test('platform preview subdomain allowed', () => {
    expect(isAllowedApiMutation('POST', 'https://preview-abc123.space-z.ai', null, env())).toBe(true)
    expect(isAllowedApiMutation('POST', 'https://space-z.ai', null, env())).toBe(true)
  })

  test('look-alike hosts are rejected (dot-boundary anchored)', () => {
    expect(isAllowedApiMutation('POST', 'https://evil-space-z.ai', null, env())).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://space-z.ai.evil.com', null, env())).toBe(false)
    expect(isAllowedApiMutation('DELETE', 'https://sub.not-space-z.ai', null, env())).toBe(false)
  })

  test('scheme downgrade is rejected', () => {
    expect(isAllowedApiMutation('POST', 'http://preview-abc123.space-z.ai', null, env())).toBe(false)
  })

  test('suffix scope requires opt-in and sane entries', () => {
    const e = env({ BEAN_TRUSTED_ORIGIN_SUFFIXES: 'localhost, .space-z.ai, *bad..' })
    expect(isAllowedApiMutation('POST', 'https://preview-x.space-z.ai', null, e)).toBe(true)
    const noSuffix = env({ BEAN_TRUSTED_ORIGIN_SUFFIXES: undefined })
    expect(isAllowedApiMutation('POST', 'https://preview-x.space-z.ai', null, noSuffix)).toBe(false)
  })
})

describe('isAllowedApiMutation — loopback development allowance', () => {
  const devEnv = env({ NODE_ENV: 'development', BEAN_TRUSTED_ORIGINS: undefined })

  test('non-production allows http(s) loopback on any port', () => {
    expect(isAllowedApiMutation('POST', 'http://localhost:3000', null, devEnv)).toBe(true)
    expect(isAllowedApiMutation('POST', 'http://127.0.0.1:3001', null, devEnv)).toBe(true)
    expect(isAllowedApiMutation('POST', 'https://localhost:3000', null, devEnv)).toBe(true)
  })

  test('non-loopback hosts still follow the allowlist in development', () => {
    expect(isAllowedApiMutation('POST', 'http://169.254.10.5:3000', null, devEnv)).toBe(false)
    expect(isAllowedApiMutation('POST', 'https://evil.example', null, devEnv)).toBe(false)
  })

  test('production never gets the implicit loopback allowance', () => {
    expect(isAllowedApiMutation('POST', 'http://localhost:3000', null, env())).toBe(false)
  })
})

describe('checkApiMutationOrigin — rejection reasons (for middleware logging)', () => {
  test('reports cross-site-fetch-metadata', () => {
    expect(checkApiMutationOrigin('https://bean.example.com', 'cross-site', env()).rejection).toBe(
      'cross-site-fetch-metadata',
    )
  })

  test('reports origin-not-allowlisted for valid but untrusted origins', () => {
    expect(checkApiMutationOrigin('https://evil.example', null, env()).rejection).toBe(
      'origin-not-allowlisted',
    )
  })
})
