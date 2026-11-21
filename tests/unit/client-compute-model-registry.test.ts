/**
 * Client compute — model registry and download policy.
 *
 * Pinned policy behaviors:
 *  - downloads refused without explicit approval;
 *  - downloads refused while the entry is disabled / runtime unavailable;
 *  - downloads REFUSED while no trusted SHA-256 is pinned (default state);
 *  - storage quota checked BEFORE any bytes are fetched;
 *  - install state requires a verified cache hit (checksum-gated);
 *  - size measurement is a real HEAD probe (never invented);
 *  - deletion works and eviction is reported honestly.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { CLIENT_MODEL_REGISTRY, ModelRegistry, registerModelRuntime } from '@/lib/client-compute/model-registry'
import type { ModelCacheLike } from '@/lib/client-compute/model-registry'

const MODEL_ID = 'laxii-bgremoval-modnet'

function fakeCache(): { cache: ModelCacheLike; store: Map<string, Response> } {
  const store = new Map<string, Response>()
  return {
    store,
    cache: {
      match: async (key) => store.get(key),
      put: async (key, res) => {
        store.set(key, res)
      },
      delete: async (key) => store.delete(key),
    },
  }
}

function registryWith(opts: {
  cache?: ReturnType<typeof fakeCache>
  body?: Uint8Array
  headSize?: number | null
  quota?: { quotaBytes: number | null; usageBytes: number | null }
  digest?: (bytes: Uint8Array) => Promise<string>
} = {}) {
  const body = opts.body ?? new Uint8Array([1, 2, 3, 4])
  return new ModelRegistry({
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'HEAD') {
        if (opts.headSize === null) return new Response(null, { status: 200, headers: { 'content-length': '' } })
        return new Response(null, { status: 200, headers: { 'content-length': String(opts.headSize ?? body.byteLength) } })
      }
      if (!url.startsWith('https://')) return new Response('nope', { status: 403 })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body)
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-length': String(body.byteLength) } })
    }) as unknown as typeof globalThis.fetch,
    cacheFactory: async () => opts.cache?.cache ?? fakeCache().cache,
    storageEstimate: async () => opts.quota ?? { quotaBytes: null, usageBytes: null },
    digestFn:
      opts.digest ??
      (async () => 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.slice(0, 64)), // placeholder, tests override
  })
}

const entry = () => CLIENT_MODEL_REGISTRY.find((m) => m.id === MODEL_ID)!
const originalEntry = { ...entry() }
beforeEach(() => {
  Object.assign(entry(), originalEntry)
})

describe('client-compute model registry policy', () => {
  test('refused without a pinned trusted checksum even when otherwise enabled (default sha256 is null)', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const reg = registryWith()
    entry().enabled = true
    entry().sha256 = null
    const out = await reg.requestDownload(MODEL_ID, { approval: true })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('REFUSED_NO_INTEGRITY_METADATA')
      expect(out.reason).toMatch(/SHA-256|checksum/i)
    }
  })

  test('refused without explicit user approval', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const reg = registryWith()
    entry().enabled = true
    entry().sha256 = 'a'.repeat(64)
    const out = await reg.requestDownload(MODEL_ID, { approval: false })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('REFUSED_APPROVAL_REQUIRED')
  })

  test('refused while disabled (license/config gate)', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const reg = registryWith()
    entry().sha256 = 'a'.repeat(64)
    const out = await reg.requestDownload(MODEL_ID, { approval: true })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('REFUSED_NOT_ENABLED')
  })

  test('refused while the required runtime is unavailable (probe forced false)', async () => {
    registerModelRuntime('onnxruntime-web', () => false) // override any earlier probe
    const reg = registryWith()
    entry().enabled = true
    entry().sha256 = 'a'.repeat(64)
    const out = await reg.requestDownload(MODEL_ID, { approval: true })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('REFUSED_RUNTIME_UNAVAILABLE')
      expect(out.reason).toMatch(/onnxruntime-web/)
    }
  })

  test('storage quota gate refuses BEFORE fetching when space is insufficient', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    entry().enabled = true
    entry().sha256 = 'a'.repeat(64)
    entry().sizeBytes = 50_000_000
    entry().sizeUnverified = false
    let fetched = false
    const reg = new ModelRegistry({
      fetchFn: (async () => {
        fetched = true
        return new Response(new Uint8Array([1]), { status: 200 })
      }) as unknown as typeof globalThis.fetch,
      cacheFactory: async () => fakeCache().cache,
      storageEstimate: async () => ({ quotaBytes: 60_000_000, usageBytes: 20_000_000 }),
      digestFn: async () => 'a'.repeat(64),
    })
    const out = await reg.requestDownload(MODEL_ID, { approval: true })
    expect(fetched).toBe(false)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('STORAGE_INSUFFICIENT')
  })

  test('happy path: pinned checksum + approval → verified install state', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const body = new Uint8Array([9, 9, 9])
    const cache = fakeCache()
    entry().enabled = true
    entry().sha256 = 'bb'.repeat(32)
    const reg = registryWith({ cache, body, digest: async () => 'bb'.repeat(32) })
    const fractions: number[] = []
    const out = await reg.requestDownload(MODEL_ID, { approval: true, onProgress: (f) => fractions.push(f) })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.bytes).toBe(body.byteLength)
    expect(fractions).toContain(1)
    const state = await reg.getInstallState(MODEL_ID)
    expect(state.installed).toBe(true)
    const ids = await reg.installedModelIds()
    expect(ids).toContain(MODEL_ID)
  })

  test('checksum mismatch → CHECKSUM_FAILED and NOT installed', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const cache = fakeCache()
    entry().enabled = true
    entry().sha256 = 'cc'.repeat(32)
    const reg = registryWith({ cache, digest: async () => 'dd'.repeat(32) })
    const out = await reg.requestDownload(MODEL_ID, { approval: true })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('CHECKSUM_FAILED')
    const state = await reg.getInstallState(MODEL_ID)
    expect(state.installed).toBe(false)
  })

  test('deleteModel removes the verified install', async () => {
    registerModelRuntime('onnxruntime-web', () => true)
    const cache = fakeCache()
    entry().enabled = true
    entry().sha256 = 'bb'.repeat(32)
    const reg = registryWith({ cache, digest: async () => 'bb'.repeat(32) })
    await reg.requestDownload(MODEL_ID, { approval: true })
    expect((await reg.getInstallState(MODEL_ID)).installed).toBe(true)
    const del = await reg.deleteModel(MODEL_ID)
    expect(del.deleted).toBe(true)
    expect((await reg.getInstallState(MODEL_ID)).installed).toBe(false)
  })

  test('measureSize is a real HEAD probe; unmeasurable length stays unverified', async () => {
    const reg = registryWith({ headSize: 12345 })
    const ok = await reg.measureSize(MODEL_ID)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.sizeBytes).toBe(12345)
    expect(entry().sizeUnverified).toBe(false)

    const reg2 = registryWith({ headSize: null })
    const res2 = await reg2.measureSize(MODEL_ID)
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.reason).toMatch(/content length/)
  })

  test('public listing carries no fabricated sizes and exposes the honest gate flags', () => {
    registerModelRuntime('onnxruntime-web', () => false) // honest default probe
    const reg = registryWith()
    const listed = reg.listPublic()
    const m = listed.find((x) => x.id === MODEL_ID)!
    expect(m.sizeUnverified).toBe(true)
    expect(m.sizeBytes).toBeNull()
    expect(m.runtimeAvailable).toBe(false) // no runtime registered yet in this test scope
    expect(m.enabled).toBe(false)
    expect(m.limitations.length).toBeGreaterThan(0)
    expect(m.license).toBe('verify-before-distribute')
  })

  test('unknown model ids are refused everywhere', async () => {
    const reg = registryWith()
    expect((await reg.requestDownload('nope', { approval: true })).ok).toBe(false)
    expect((await reg.measureSize('nope')).ok).toBe(false)
    expect((await reg.getInstallState('nope')).installed).toBe(false)
  })
})
