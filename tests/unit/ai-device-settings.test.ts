/**
 * BEAN Intelligence — AI Device settings + local engine client regressions.
 * Pins: loopback-only pairing contract, sanitization of persisted settings,
 * honest refusal of non-loopback hosts (never a silent acceptance).
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  getDeviceSettings,
  setDeviceSettings,
  unpairLocalEngine,
  resetDeviceSettingsForTests,
} from '@/lib/client-compute/inference/device-settings'
import { LocalEngineClient, localEngineBaseUrl } from '@/lib/local-engine/llamacpp-client'

beforeEach(() => {
  resetDeviceSettingsForTests()
})

describe('AI device settings store', () => {
  test('defaults: auto mode, no pairing, non-browser stub is honest', () => {
    const s = getDeviceSettings()
    expect(s.version).toBe(1)
    expect(s.mode).toBe('auto')
    expect(s.localEngine).toBeNull()
    expect(s.preferredChatModelId).toBeNull()
  })

  test('persists a valid loopback pairing', () => {
    setDeviceSettings({ localEngine: { host: '127.0.0.1', port: 8080, apiKey: 'k', verifiedAt: null, reportedModel: null } })
    expect(getDeviceSettings().localEngine?.host).toBe('127.0.0.1')
    expect(getDeviceSettings().localEngine?.port).toBe(8080)
  })

  test('SANITIZES AWAY a non-loopback host (the store must never hold it)', () => {
    setDeviceSettings({
      // Deliberately invalid: a LAN host must never be persisted.
      localEngine: { host: '192.168.1.50' as '127.0.0.1', port: 8080, apiKey: 'k', verifiedAt: null, reportedModel: null },
    })
    expect(getDeviceSettings().localEngine).toBeNull()
  })

  test('unpair deletes the stored key with the pairing', () => {
    setDeviceSettings({ localEngine: { host: 'localhost', port: 8080, apiKey: 'secret-key', verifiedAt: null, reportedModel: null } })
    unpairLocalEngine()
    expect(getDeviceSettings().localEngine).toBeNull()
  })

  test('mode enum is enforced', () => {
    setDeviceSettings({ mode: 'telepathy' as 'auto' })
    expect(getDeviceSettings().mode).toBe('auto')
  })
})

describe('local desktop engine client', () => {
  test('baseUrl guard: loopback allowed', () => {
    expect(localEngineBaseUrl({ host: '127.0.0.1', port: 8080 })).toBe('http://127.0.0.1:8080')
    expect(localEngineBaseUrl({ host: 'localhost', port: 8080 })).toBe('http://localhost:8080')
    expect(localEngineBaseUrl({ host: '[::1]', port: 8080 })).toBe('http://[::1]:8080')
  })

  test('baseUrl guard: NON-loopback hosts are refused (SSRF-safe pairing)', () => {
    expect(() => localEngineBaseUrl({ host: 'example.com' as '127.0.0.1', port: 8080 })).toThrow()
    expect(() => localEngineBaseUrl({ host: '192.168.0.10' as '127.0.0.1', port: 8080 })).toThrow()
  })

  test('pair(): wrong key => AI_LOCAL_ENGINE_AUTH_FAILED (honest 401 mapping)', async () => {
    const client = new LocalEngineClient({
      fetchFn: (async () => new Response('{"data":[]}', { status: 401 })) as unknown as typeof fetch,
    })
    const result = await client.pair({ host: '127.0.0.1', port: 8080, apiKey: 'wrong', verifiedAt: null, reportedModel: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AI_LOCAL_ENGINE_AUTH_FAILED')
      expect(result.error.recovery).toContain('Re-pair')
    }
  })

  test('pair(): unreachable engine => AI_LOCAL_ENGINE_UNREACHABLE with recovery', async () => {
    const client = new LocalEngineClient({
      fetchFn: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    })
    const result = await client.pair({ host: '127.0.0.1', port: 8080, apiKey: 'k', verifiedAt: null, reportedModel: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AI_LOCAL_ENGINE_UNREACHABLE')
  })

  test('pair(): success reads the engine model list (identity measured, not assumed)', async () => {
    const client = new LocalEngineClient({
      fetchFn: (async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen3-1.7b-q4_k_m.gguf', owned_by: 'local' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    })
    const result = await client.pair({ host: '127.0.0.1', port: 8080, apiKey: 'k', verifiedAt: null, reportedModel: null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.serverModel).toBe('qwen3-1.7b-q4_k_m.gguf')
      expect(result.models[0]?.id).toBe('qwen3-1.7b-q4_k_m.gguf')
    }
  })
})
