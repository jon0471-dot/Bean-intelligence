/**
 * M36-A — CONTROLLED MODEL DISCOVERY tests (fake fetch; no network).
 *
 * Pinned contracts (brief §4B/§5):
 *  - discovery is credential-gated: a dormant slot is reported honestly and
 *    the endpoint is NEVER queried;
 *  - a real provider API list (OpenAI `GET /models`, Anthropic `GET /v1/models`)
 *    maps exactly into DiscoveredModel records;
 *  - failures degrade honestly (429 / non-JSON / malformed payload) with a
 *    safe note — no fabricated inventory;
 *  - results are cached briefly (repeat calls do not refetch);
 *  - discovery NEVER mutates routing state (it returns a catalogue only).
 */
import { describe, test, expect, beforeEach } from 'bun:test'

import {
  discoverOpenAiCompatibleModels,
  discoverAnthropicModels,
  resetDiscoveryCacheForTests,
} from '../../src/lib/providers/model-discovery'

const ENV_KEYS = [
  'BEAN_PROVIDER_OPENAI_API_KEY',
  'BEAN_PROVIDER_OPENAI_BASE_URL',
  'BEAN_PROVIDER_ANTHROPIC_API_KEY',
  'BEAN_PROVIDER_ANTHROPIC_BASE_URL',
] as const

let savedFetch: typeof fetch
let fetchCount = 0

function installFetch(handler: (url: string, headers: Record<string, string>) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k.toLowerCase()] = String(v)
    }
    return await handler(url, headers)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  savedFetch = globalThis.fetch
  resetDiscoveryCacheForTests()
  fetchCount = 0
  for (const k of ENV_KEYS) delete process.env[k]
  return () => {
    globalThis.fetch = savedFetch
  }
})

describe('model discovery — credential gating', () => {
  test('dormant openai-compatible slot: honest note, zero fetches', async () => {
    installFetch(() => new Response('{}', { status: 200 }))
    const result = await discoverOpenAiCompatibleModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.models).toHaveLength(0)
    expect(result.note).toContain('dormant')
    expect(fetchCount).toBe(0)
  })

  test('dormant anthropic slot: honest note, zero fetches', async () => {
    installFetch(() => new Response('{}', { status: 200 }))
    const result = await discoverAnthropicModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.note).toContain('dormant')
    expect(fetchCount).toBe(0)
  })
})

describe('model discovery — real provider API mapping', () => {
  test('OpenAI-compatible /models maps into discovered records (Bearer auth)', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-test-key'
    process.env.BEAN_PROVIDER_OPENAI_BASE_URL = 'https://provider.example/v1'
    installFetch((url, headers) => {
      expect(url).toBe('https://provider.example/v1/models')
      expect(headers.authorization).toBe('Bearer sk-test-key')
      return new Response(
        JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b', name: 'Model B' }, { nope: true }, { id: '' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const result = await discoverOpenAiCompatibleModels()
    expect(result.source).toBe('provider-api')
    expect(result.queriedUrl).toBe('https://provider.example/v1')
    expect(result.models).toEqual([{ id: 'model-a', displayName: null }, { id: 'model-b', displayName: 'Model B' }])
    expect(result.note).toBeNull()
    // Cached: a second call does NOT refetch.
    await discoverOpenAiCompatibleModels()
    expect(fetchCount).toBe(1)
  })

  test('Anthropic /v1/models maps display_name + version headers', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test'
    installFetch((url, headers) => {
      expect(url).toBe('https://api.anthropic.com/v1/models')
      expect(headers['x-api-key']).toBe('sk-ant-test')
      expect(headers['anthropic-version']).toBe('2023-06-01')
      return new Response(
        JSON.stringify({ data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const result = await discoverAnthropicModels()
    expect(result.source).toBe('provider-api')
    expect(result.models).toEqual([{ id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' }])
  })
})

describe('model discovery — honest failure degradation', () => {
  test('a 429 from the endpoint degrades to a safe note (no fabricated list)', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-test-key'
    installFetch(() => new Response('{"error":"slow"}', { status: 429 }))
    const result = await discoverOpenAiCompatibleModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.models).toHaveLength(0)
    expect(result.note).toContain('rate-limited')
  })

  test('a non-JSON body degrades to a safe note', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test'
    installFetch(() => new Response('<html>not json</html>', { status: 200 }))
    const result = await discoverAnthropicModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.note).toContain('non-JSON')
  })

  test('a response without a data[] array degrades to a safe note', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-test-key'
    installFetch(() => new Response(JSON.stringify({ unexpected: true }), { status: 200 }))
    const result = await discoverOpenAiCompatibleModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.note).toContain('data[]')
  })

  test('an unreachable endpoint degrades with the network reason', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test'
    installFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    const result = await discoverAnthropicModels()
    expect(result.source).toBe('operator-catalogue')
    expect(result.models).toHaveLength(0)
    expect(result.note).toContain('unreachable')
  })
})
