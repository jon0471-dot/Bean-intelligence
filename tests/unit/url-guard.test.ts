/**
 * CODE GIFTZ — W6 security: provider base-URL SSRF guard tests.
 *
 * SEC-W6-01: the OpenAI-compatible credential's baseUrl drives a server-side
 * fetch with the credential attached. The guard must reject loopback,
 * link-local (cloud metadata) and malformed targets while admitting
 * legitimate public endpoints and self-hosted LAN workers.
 *
 * Run: bun test tests/unit/url-guard.test.ts
 */
import { describe, test, expect } from 'bun:test'

const { validateProviderBaseUrl } = await import('../../src/lib/security/url-guard')

const ALLOW = process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS

describe('url-guard — accepted targets (legitimate providers)', () => {
  test('public https endpoints pass', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.groq.com/openai/v1',
      'https://internal-vllm.lan:8000/v1',
      'http://selfhosted.worker.internal:8080',
      'https://gateway.example.internal/v1',
    ]) {
      expect(validateProviderBaseUrl(url).ok).toBe(true)
    }
  })

  test('any port is allowed (self-hosted vLLM on :8000 is normal)', () => {
    expect(validateProviderBaseUrl('https://my-provider.example:8443/v1').ok).toBe(true)
  })
})

describe('url-guard — rejected targets (SSRF surface)', () => {
  test('loopback hostnames rejected', () => {
    for (const url of ['http://localhost:8000/v1', 'http://localhost/v1', 'https://foo.localhost/v1']) {
      const r = validateProviderBaseUrl(url)
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/loopback|metadata/)
    }
  })

  test('loopback IPv4 rejected (127.0.0.0/8)', () => {
    for (const url of ['http://127.0.0.1:3000/v1', 'http://127.9.9.9/v1']) {
      expect(validateProviderBaseUrl(url).ok).toBe(false)
    }
  })

  test('unspecified address rejected', () => {
    expect(validateProviderBaseUrl('http://0.0.0.0:9000').ok).toBe(false)
    expect(validateProviderBaseUrl('http://[::]/v1').ok).toBe(false)
  })

  test('cloud metadata endpoint rejected — ALWAYS, even under the escape hatch', () => {
    for (const url of ['http://169.254.169.254/latest/meta-data', 'http://169.254.10.20/v1']) {
      const r = validateProviderBaseUrl(url)
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/link-local|metadata/)
    }
  })

  test('link-local IPv6 rejected', () => {
    expect(validateProviderBaseUrl('http://[fe80::1]:8000/v1').ok).toBe(false)
  })

  test('IPv6 loopback rejected', () => {
    expect(validateProviderBaseUrl('http://[::1]:9000/v1').ok).toBe(false)
  })

  test('non-http(s) schemes rejected', () => {
    for (const url of ['ftp://provider.example/v1', 'file:///etc/passwd', 'gopher://x.example']) {
      expect(validateProviderBaseUrl(url).ok).toBe(false)
    }
  })

  test('userinfo (credentials-in-URL) rejected', () => {
    expect(validateProviderBaseUrl('https://user:pass@api.provider.example/v1').ok).toBe(false)
  })

  test('malformed / empty rejected', () => {
    expect(validateProviderBaseUrl('').ok).toBe(false)
    expect(validateProviderBaseUrl('not a url').ok).toBe(false)
    expect(validateProviderBaseUrl('http://').ok).toBe(false)
  })
})

describe('url-guard — operator escape hatch (local test rigs only)', () => {
  test('BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=true admits loopback but NEVER metadata', () => {
    process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS = 'true'
    try {
      expect(validateProviderBaseUrl('http://127.0.0.1:9213/v1').ok).toBe(true)
      expect(validateProviderBaseUrl('http://localhost:9213').ok).toBe(true)
      expect(validateProviderBaseUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false)
    } finally {
      if (ALLOW === undefined) delete process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS
      else process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS = ALLOW
    }
  })
})
