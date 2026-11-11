/**
 * Hardened hosted-image adapter — provider response contract (2026-11-11).
 *
 * Measured root cause of the poster BACKEND_FAILURE: the SDK's
 * `createImageGeneration` ran `result.data.map(...)` unguarded, so a 2xx
 * body without a `data` array crashed as an unclassifiable TypeError and the
 * provider's actual answer was lost. The adapter now calls the documented
 * wire contract directly. These tests pin that contract hermetically:
 *   - 2xx + data[0].base64 / b64_json / url  → real bytes, magic-validated;
 *   - 2xx WITHOUT data                       → ImageProviderResponseError
 *     carrying the provider's message + body keys (diagnostics, no secrets);
 *   - HTTP 429                               → UpstreamRateLimitError;
 *   - HTTP 401                               → status-parsable auth failure;
 *   - non-JSON 2xx body                      → typed malformed-response error.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

/** Configurable upstream behavior for the mocked fetch. */
let upstream: (req: Request) => Response | Promise<Response> = () => new Response('{}', { status: 500 })
let download: (url: string) => Response | Promise<Response> = () => new Response('x', { status: 404 })
const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
const downloadCalls: string[] = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url.includes('/images/generations')) {
    fetchCalls.push({ url, init })
    return upstream(new Request(url, init))
  }
  downloadCalls.push(url)
  return download(url)
}) as typeof fetch

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key-material', token: 'test-token', chatId: 'c1', userId: 'u1' },
    }),
  },
}))

const { hostedImageAdapter, ImageProviderResponseError } = await import('../../src/lib/adapters/hosted-image')
const { UpstreamRateLimitError } = await import('../../src/lib/upstream/gateway')

beforeEach(() => {
  fetchCalls.length = 0
  downloadCalls.length = 0
  // The images-class breaker must be closed for each test.
  const g = globalThis as unknown as Record<string, unknown>
  const breaker = g['__bean_upstream_cooldown__'] as Map<string, unknown> | undefined
  breaker?.clear()
})

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  const breaker = g['__bean_upstream_cooldown__'] as Map<string, unknown> | undefined
  breaker?.clear()
})

const JPEG_B64 = Buffer.from(
  Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00),
).toString('base64')

function genRequest(size = '1024x1024') {
  return { prompt: 'a test image', size } as Parameters<
    NonNullable<typeof hostedImageAdapter.generateImage>
  >[0]
}

describe('hostedImageAdapter.generateImage — response contract', () => {
  test('2xx with a base64 item returns validated JPEG bytes', async () => {
    upstream = () => new Response(JSON.stringify({ created: 1, data: [{ base64: JPEG_B64 }] }), { status: 200 })
    const res = await hostedImageAdapter.generateImage!(genRequest())
    expect(Buffer.from(res.bytes.subarray(0, 2)).toString('hex')).toBe('ffd8')
    expect(res.format).toBe('jpeg')
    expect(res.width).toBe(1024)
    expect(res.height).toBe(1024)
  })

  test('2xx with a b64_json item also decodes', async () => {
    upstream = () => new Response(JSON.stringify({ data: [{ b64_json: JPEG_B64 }] }), { status: 200 })
    const res = await hostedImageAdapter.generateImage!(genRequest())
    expect(res.bytes.length).toBeGreaterThan(0)
  })

  test('2xx with a url item downloads the artifact bytes', async () => {
    upstream = () => new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/img' }] }), { status: 200 })
    download = () => new Response(new Uint8Array(Buffer.from(JPEG_B64, 'base64')), { status: 200 })
    const res = await hostedImageAdapter.generateImage!(genRequest())
    expect(downloadCalls).toEqual(['https://cdn.test/img'])
    expect(res.bytes.length).toBeGreaterThan(0)
  })

  test('REGRESSION: 2xx WITHOUT a data array is a typed diagnosable error carrying the provider message', async () => {
    upstream = () =>
      new Response(JSON.stringify({ error: { code: '1302', message: 'content moderation rejected the request' } }), { status: 200 })
    try {
      await hostedImageAdapter.generateImage!(genRequest())
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ImageProviderResponseError)
      const err = e as unknown as { providerDetail: string; bodyKeys: string[]; httpStatus: number; message: string }
      expect(err.httpStatus).toBe(200)
      expect(err.providerDetail).toContain('content moderation rejected the request')
      expect(err.bodyKeys).toEqual(['error'])
      // The old failure mode surfaced as "Cannot read properties of undefined (reading 'map')"
      expect(err.message).not.toMatch(/reading 'map'/)
    }
  })

  test('a string-valued error body is retained as provider detail too', async () => {
    upstream = () =>
      new Response(JSON.stringify({ error: 'Handler dispatch failed; nested exception is java.lang.StackOverflowError' }), { status: 200 })
    try {
      await hostedImageAdapter.generateImage!(genRequest())
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ImageProviderResponseError)
      const err = e as unknown as { providerDetail: string }
      expect(err.providerDetail).toContain('StackOverflowError')
    }
  })

  test('non-JSON 2xx body is a typed malformed-response error', async () => {
    upstream = () => new Response('<html>gateway hiccup</html>', { status: 200 })
    await expect(hostedImageAdapter.generateImage!(genRequest())).rejects.toBeInstanceOf(ImageProviderResponseError)
  })

  test('HTTP 429 raises the typed throttle error (breaker evidence recorded)', async () => {
    upstream = () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })
    await expect(hostedImageAdapter.generateImage!(genRequest())).rejects.toBeInstanceOf(UpstreamRateLimitError)
  })

  test('HTTP 401 keeps the status-parsable phrasing so classification maps to auth', async () => {
    upstream = () => new Response('{"error":"invalid credentials"}', { status: 401 })
    try {
      await hostedImageAdapter.generateImage!(genRequest())
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toMatch(/status 401/)
    }
  })

  test('the wire request carries the documented headers and native body', async () => {
    upstream = () => new Response(JSON.stringify({ data: [{ base64: JPEG_B64 }] }), { status: 200 })
    await hostedImageAdapter.generateImage!(genRequest('1344x768'))
    expect(fetchCalls).toHaveLength(1)
    const { url, init } = fetchCalls[0]
    expect(url).toBe('https://gateway.test/v1/images/generations')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toMatch(/^Bearer /)
    expect(headers.get('X-Token')).toBe('test-token')
    expect(headers.get('X-Chat-Id')).toBe('c1')
    expect(headers.get('X-User-Id')).toBe('u1')
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'a test image', size: '1344x768' })
  })

  test('unsupported (non-native) sizes are still rejected before any network call', async () => {
    await expect(hostedImageAdapter.generateImage!(genRequest('1920x1080'))).rejects.toThrow(/Unsupported size/)
    expect(fetchCalls).toHaveLength(0)
  })
})

// restore the real fetch for other test files in this isolate
afterEach(() => {
  // no-op: isolate-scoped; globalThis.fetch stays mocked for this file only
})
void realFetch
