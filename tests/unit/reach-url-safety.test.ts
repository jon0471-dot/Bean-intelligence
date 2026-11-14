/**
 * Reach gateway — URL safety / SSRF guard (hermetic: DNS disabled under bun
 * test, literal-address and redirect logic fully exercised with fetch stubs).
 *
 * Regression contract (Phase 6):
 *   - literal private / loopback / link-local / metadata addresses blocked;
 *   - IPv4-mapped IPv6 blocked;
 *   - metadata + localhost hostnames blocked;
 *   - credentials in URLs blocked;
 *   - redirects revalidated per hop (redirect-SSRF safe);
 *   - public URLs pass.
 */

import { describe, expect, test } from 'bun:test'
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlSync,
  guardedFetch,
  clearReachDnsCacheForTests,
} from '../../src/lib/research/reach/url-safety'

const PUBLIC = 'https://nodejs.org/en/about'

describe('assertPublicHttpUrl (literal + hostname checks)', () => {
  test('blocks private, loopback, link-local, CGNAT and metadata literals', async () => {
    const blocked = [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.0.9/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
    ]
    for (const url of blocked) {
      const res = await assertPublicHttpUrl(url, { resolveDns: false })
      expect(res.ok).toBeFalse()
    }
  })

  test('blocks metadata and internal-suffix hostnames', async () => {
    for (const url of [
      'http://localhost/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://instance-data/',
      'http://service.internal/',
      'http://printer.local/',
    ]) {
      const res = await assertPublicHttpUrl(url, { resolveDns: false })
      expect(res.ok).toBeFalse()
    }
  })

  test('blocks non-http schemes and embedded credentials', async () => {
    expect((await assertPublicHttpUrl('file:///etc/passwd', { resolveDns: false })).ok).toBeFalse()
    expect((await assertPublicHttpUrl('ftp://example.com/', { resolveDns: false })).ok).toBeFalse()
    expect((await assertPublicHttpUrl('http://user:pass@example.com/', { resolveDns: false })).ok).toBeFalse()
  })

  test('allows public URLs (sync and async agree)', async () => {
    expect((await assertPublicHttpUrl(PUBLIC, { resolveDns: false })).ok).toBeTrue()
    expect(assertPublicHttpUrlSync(PUBLIC).ok).toBeTrue()
    clearReachDnsCacheForTests()
  })
})

describe('guardedFetch redirect revalidation (fetch stubbed)', () => {
  const realFetch = globalThis.fetch

  function stubFetch(responses: Array<{ status: number; location?: string }>): { calls: string[] } {
    const calls: string[] = []
    let i = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      const r = responses[Math.min(i, responses.length - 1)]
      i += 1
      const headers = new Headers()
      if (r.location) headers.set('location', r.location)
      return new Response(null, { status: r.status, headers })
    }) as unknown as typeof fetch
    return { calls }
  }

  test('follows a public redirect chain and reports the final URL', async () => {
    const { calls } = stubFetch([
      { status: 301, location: 'https://nodejs.org/en' },
      { status: 200 },
    ])
    const out = await guardedFetch('https://nodejs.org/en/about', { timeoutMs: 2_000 })
    expect(out.res.status).toBe(200)
    expect(out.finalUrl).toBe('https://nodejs.org/en')
    expect(calls.length).toBe(2)
    globalThis.fetch = realFetch
  })

  test('BLOCKS a redirect into a private/metadata address (SSRF)', async () => {
    stubFetch([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }])
    let message = ''
    try {
      await guardedFetch('https://example.com/redirect', { timeoutMs: 2_000 })
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toContain('redirect blocked')
    globalThis.fetch = realFetch
  })

  test('BLOCKS a redirect into localhost even when the first hop is public', async () => {
    stubFetch([{ status: 302, location: 'http://127.0.0.1:9222/json' }])
    let blocked = false
    try {
      await guardedFetch('https://example.com/redirect', { timeoutMs: 2_000 })
    } catch {
      blocked = true
    }
    expect(blocked).toBeTrue()
    globalThis.fetch = realFetch
  })

  test('bounds the redirect chain (too many hops fails honestly)', async () => {
    stubFetch([
      { status: 302, location: 'https://nodejs.org/b' },
      { status: 302, location: 'https://nodejs.org/c' },
      { status: 302, location: 'https://nodejs.org/d' },
      { status: 302, location: 'https://nodejs.org/e' },
      { status: 302, location: 'https://nodejs.org/f' },
    ])
    let blocked = false
    try {
      await guardedFetch('https://nodejs.org/a', { timeoutMs: 2_000 })
    } catch (e) {
      blocked = String(e instanceof Error ? e.message : e).includes('too many redirects')
    }
    expect(blocked).toBeTrue()
    globalThis.fetch = realFetch
  })

  test('blocks the FIRST request when the initial URL is private (zero fetches)', async () => {
    let fetched = 0
    globalThis.fetch = (async () => {
      fetched += 1
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    let blocked = false
    try {
      await guardedFetch('http://169.254.169.254/', { timeoutMs: 2_000 })
    } catch {
      blocked = true
    }
    expect(blocked).toBeTrue()
    expect(fetched).toBe(0)
    globalThis.fetch = realFetch
  })
})
