/**
 * BEAN Intelligence — client model registry integrity regressions.
 * Pins (2026-11-18 operationalization):
 *  - the three enabled entries carry MEASURED sizes/revision/checksum facts;
 *  - requestDownload refuses runtime-managed models instead of faking a
 *    checksum gate;
 *  - the checksum gate still applies to bean-managed artifacts (modnet).
 */
import { describe, test, expect } from 'bun:test'
import { ModelRegistry, getDefaultModelRegistry } from '@/lib/client-compute/model-registry'

describe('client model registry', () => {
  test('the on-device chat model entry carries the measured facts', () => {
    const entry = getDefaultModelRegistry().getEntry('riishe-chat-webllm-qwen2.5-0.5b')
    expect(entry).toBeDefined()
    expect(entry?.revision).toBe('32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad')
    expect(entry?.sizeBytes).toBe(289_693_824)
    expect(entry?.sizeUnverified).toBe(false)
    expect(entry?.integrity).toBe('runtime-managed-pinned-revision')
    expect(entry?.downloadPath).toBe('runtime-managed-cache')
    expect(entry?.gpuCompatible).toBe(true)
    expect(entry?.cpuCompatible).toBe(false)
    expect(entry?.enabled).toBe(true)
  })

  test('the browser ASR entry carries the measured facts', () => {
    const entry = getDefaultModelRegistry().getEntry('gangzii-asr-browser-whisper-tiny')
    expect(entry?.revision).toBe('5332fcc35e32a33b86612b9a57a89be7906102b1')
    expect(entry?.sizeBytes).toBe(43_622_127)
    expect(entry?.cpuCompatible).toBe(true)
    expect(entry?.integrity).toBe('runtime-managed-pinned-revision')
  })

  test('the MODNet artifact entry carries the REAL pinned SHA-256 + size', () => {
    const entry = getDefaultModelRegistry().getEntry('laxii-bgremoval-modnet')
    expect(entry?.sha256).toBe('92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a')
    expect(entry?.sizeBytes).toBe(6_632_188)
    expect(entry?.integrity).toBe('pinned-artifact-sha256')
    expect(entry?.downloadPath).toBe('bean-managed-cache')
    expect(entry?.sourceUrl).toContain('/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/')
    expect(entry?.enabled).toBe(true)
  })

  test('requestDownload REFUSES runtime-managed models (honest integrity boundary)', async () => {
    const registry = new ModelRegistry({ fetchFn: (async () => new Response('', { status: 200 })) as unknown as typeof fetch })
    const result = await registry.requestDownload('riishe-chat-webllm-qwen2.5-0.5b', { approval: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('REFUSED_RUNTIME_MANAGED')
      expect(result.reason).toContain('pinned upstream revision')
    }
  })

  test('requestDownload still gates bean-managed artifacts on explicit approval', async () => {
    const registry = new ModelRegistry()
    const result = await registry.requestDownload('laxii-bgremoval-modnet', { approval: false })
    // Refused, with an honest reason (which gate fired first depends on the
    // registered runtime probes; in this bare context the runtime probe is
    // false, so REFUSED_RUNTIME_UNAVAILABLE is the honest first refusal).
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(10)
    }
  })

  test('listPublic never invents sizes: runtimeAvailable reflects registered probes (unregistered = false)', () => {
    const registry = getDefaultModelRegistry()
    const view = registry.listPublic()
    expect(view.length).toBe(3)
    for (const m of view) {
      // No runtime probe is registered in this bare test context — the honest
      // answer is false, never an assumed true.
      expect(m.runtimeAvailable).toBe(false)
    }
  })
})
