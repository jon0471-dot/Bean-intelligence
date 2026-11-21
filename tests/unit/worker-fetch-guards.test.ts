/**
 * BEAN Intelligence — M26 SSRF guard regression tests for the WORKER fetch
 * paths (audit S-7 / S-10).
 *
 * S-7: JAZMII's video worker re-fetched the user reference image via
 * imageReferenceToDataUrl with NO SSRF guard and redirect:'follow' — a URL
 * validated at submit time could 302 to an internal address at worker time.
 * S-10: downloadVideo fetched the provider-controlled task URL with
 * redirect:'follow' and no guard.
 *
 * Both paths now ride the research gateway's guardedFetch (every hop
 * revalidated). These tests pin: internal/literal targets are refused
 * WITHOUT any fetch being attempted, public literal targets fetch, and the
 * honest failure contract (null / typed error) holds.
 */
import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { imageReferenceToDataUrl } from '../../src/lib/intel/vision'
import { downloadVideo } from '../../src/lib/adapters/hosted-video'

const REAL_FETCH = globalThis.fetch

/** Minimal WHATWG-ish Response stub sufficient for both consumers. */
function fakeImageResponse(): Response {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  } as unknown as Response
}

function fakeMp4Response(): Response {
  const mp4 = Buffer.alloc(32)
  mp4.write('ftyp', 4, 'ascii')
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    arrayBuffer: async () => mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof mock> | null = null

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  fetchMock = mock(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return await handler(url)
  }) as unknown as ReturnType<typeof mock>
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

beforeEach(() => {
  fetchMock = null
})
afterEach(() => {
  globalThis.fetch = REAL_FETCH
})

describe('S-7 imageReferenceToDataUrl — worker-side SSRF guard', () => {
  test('literal loopback/metadata targets are refused WITHOUT any fetch', async () => {
    stubFetch(() => fakeImageResponse())
    expect(await imageReferenceToDataUrl('http://127.0.0.1:8081/secret.png')).toBeNull()
    expect(await imageReferenceToDataUrl('http://169.254.169.254/latest/meta-data')).toBeNull()
    expect(await imageReferenceToDataUrl('http://10.1.2.3/img.png')).toBeNull()
    // the guard rejected before any network I/O
    expect(fetchMock!.mock.calls.length).toBe(0)
  })

  test('public literal target still fetches (no false positive)', async () => {
    stubFetch(() => fakeImageResponse())
    const out = await imageReferenceToDataUrl('http://8.8.8.8/img.png')
    expect(out).not.toBeNull()
    expect(out).toContain('data:image/png;base64,')
    expect(fetchMock!.mock.calls.length).toBe(1)
  })

  test('data URLs pass through untouched; non-http(s) refs are rejected', async () => {
    stubFetch(() => fakeImageResponse())
    const data = 'data:image/png;base64,iVBORw0KGgo='
    expect(await imageReferenceToDataUrl(data)).toBe(data)
    expect(await imageReferenceToDataUrl('file:///etc/passwd')).toBeNull()
    expect(fetchMock!.mock.calls.length).toBe(0)
  })
})

describe('S-10 downloadVideo — provider URL guard', () => {
  test('internal provider URL is refused with a typed error (no fetch attempted)', async () => {
    stubFetch(() => fakeMp4Response())
    await expect(downloadVideo('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /blocked or failed/i,
    )
    expect(fetchMock!.mock.calls.length).toBe(0)
  })

  test('loopback provider URL is refused (no fetch attempted)', async () => {
    stubFetch(() => fakeMp4Response())
    await expect(downloadVideo('http://127.0.0.1:9/v.mp4')).rejects.toThrow(/blocked or failed/i)
    expect(fetchMock!.mock.calls.length).toBe(0)
  })

  test('public provider URL downloads and passes container validation', async () => {
    stubFetch(() => fakeMp4Response())
    const dl = await downloadVideo('http://8.8.8.8/video.mp4', 5_000)
    expect(dl.format).toBe('mp4')
    expect(dl.bytesLength).toBe(32)
    expect(fetchMock!.mock.calls.length).toBe(1)
  })

  test('non-video payload is still rejected by the magic-byte check', async () => {
    stubFetch(() => fakeImageResponse())
    await expect(downloadVideo('http://8.8.8.8/video.mp4', 5_000)).rejects.toThrow(/container/i)
  })
})
