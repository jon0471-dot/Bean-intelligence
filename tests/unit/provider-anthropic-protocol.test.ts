/**
 * M36-A — Anthropic Messages adapter PROTOCOL tests (fake fetch; no network).
 *
 * Pinned contracts (brief §13: every registered provider adapter has a real
 * protocol-level test):
 *  - official Messages wire protocol: x-api-key + anthropic-version headers,
 *    top-level system field (BEAN's leading assistant turn maps to it),
 *    messages[] ending with a user turn;
 *  - response parsing: content[] text blocks + usage token counts;
 *  - streaming: SSE content_block_delta → text deltas through the audited
 *    decoder; non-SSE JSON tolerated as one delta;
 *  - 429 → dedicated 'chat-anthropic' breaker class with retry hint;
 *  - 401 → honest auth failure WITHOUT exposing the credential;
 *  - dormant slot: zero fetches, typed refusal;
 *  - health: a REAL tiny completion probe (capability verified, never assumed).
 */
import { describe, test, expect, beforeEach } from 'bun:test'

import { _resetUpstreamCooldownForTests } from '../../src/lib/upstream/gateway'
import { anthropicAdapter, buildAnthropicBody, anthropicSseEventToDelta, ANTHROPIC_BACKEND_ID } from '../../src/lib/providers/anthropic'
import { resolveAnthropicCredential } from '../../src/lib/providers/credentials'
import { getBackend } from '../../src/lib/registry/backends'
import type { ChatRequest, CodeTaskRequest } from '../../src/lib/adapters/types'

const ENV_KEYS = ['BEAN_PROVIDER_ANTHROPIC_API_KEY', 'BEAN_PROVIDER_ANTHROPIC_BASE_URL', 'BEAN_PROVIDER_ANTHROPIC_MODEL'] as const

let savedFetch: typeof fetch
let requests: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }> = []

function installFetch(handler: (req: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers as Record<string, string>
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v)
    }
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const req = { url, method: init?.method ?? 'GET', headers, body }
    requests.push(req)
    return await handler(req)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  savedFetch = globalThis.fetch
  _resetUpstreamCooldownForTests()
  for (const k of ENV_KEYS) delete process.env[k]
  requests = []
  return () => {
    globalThis.fetch = savedFetch
  }
})

function chatReq(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    messages: [
      { role: 'assistant', content: 'You are RIISHE, the BEAN assistant protocol.' },
      { role: 'user', content: 'hello' },
    ],
    maxPromptChars: 12000,
    maxHistoryMessages: 24,
    timeoutMs: 5000,
    ...overrides,
  }
}

const okResponse = () =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 12, output_tokens: 3 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('Anthropic slot — registry wiring', () => {
  test('backend registered, dormant without credentials, honest reason', () => {
    const b = getBackend(ANTHROPIC_BACKEND_ID)
    expect(b).toBeDefined()
    expect(b?.task).toBe('chat')
    expect(b?.enabled).toBe(false)
    expect(b?.unavailableReason).toContain('BEAN_PROVIDER_ANTHROPIC_API_KEY')
    // Never appended to an automatic fallback chain (cost policy).
    expect(getBackend('bean-llm-hosted-primary')?.fallbacks).not.toContain(ANTHROPIC_BACKEND_ID)
  })

  test('slot activates when the operator env credential exists (credential contract)', () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    // The registry evaluates `enabled` once at module load (with env unset in
    // tests) — the activation CONTRACT is: the same sync check feeds the
    // registry flag, so setting the credential turns the slot on in a fresh
    // process and the adapter resolves it at request time.
    expect(getBackend(ANTHROPIC_BACKEND_ID)?.secrets).toContain('BEAN_PROVIDER_ANTHROPIC_API_KEY')
    expect(resolveAnthropicCredential().present).toBe(true)
  })
})

describe('Anthropic slot — dormant behavior', () => {
  test('health reports not-configured with ZERO fetches', async () => {
    installFetch(() => okResponse())
    const h = await anthropicAdapter.health()
    expect(h.healthy).toBe(false)
    expect(h.failureCategory).toBe('not-configured')
    expect(requests).toHaveLength(0)
  })

  test('chat refuses with a typed not-attempted error and zero fetches', async () => {
    installFetch(() => okResponse())
    await expect(anthropicAdapter.chat!(chatReq())).rejects.toThrow(/not configured/)
    expect(requests).toHaveLength(0)
  })
})

describe('Anthropic slot — Messages wire protocol', () => {
  test('buildAnthropicBody maps the BEAN leading assistant turn to the system field', () => {
    const body = buildAnthropicBody(chatReq(), false, 'claude-haiku-4-5')
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.system).toBe('You are RIISHE, the BEAN assistant protocol.')
    expect(body.max_tokens).toBe(4096)
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('hello')
    expect(body.stream).toBe(false)
  })

  test('buildAnthropicBody refuses a conversation not ending with a user turn', () => {
    expect(() =>
      buildAnthropicBody(
        chatReq({ messages: [{ role: 'assistant', content: 'sys' }] }),
        false,
        'm',
      ),
    ).toThrow(/final turn to be a user message/)
  })

  test('chat sends x-api-key + anthropic-version and parses content blocks', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    installFetch(() => okResponse())
    const result = await anthropicAdapter.chat!(chatReq())
    expect(result.content).toBe('OK')
    expect(result.tokensInEst).toBe(12)
    expect(result.tokensOutEst).toBe(3)
    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant-test-key')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    expect((req.body as Record<string, unknown>).system).toBe('You are RIISHE, the BEAN assistant protocol.')
  })

  test('streaming decodes content_block_delta events into text deltas', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    const sse = [
      'event: message_start',
      'data: {"type":"message_start"}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo!"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n')
    installFetch(
      () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const deltas: string[] = []
    for await (const d of anthropicAdapter.chatStream!(chatReq())) deltas.push(d)
    expect(deltas.join('')).toBe('Hello!')
  })

  test('a provider that ignores stream:true still yields one JSON delta', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    installFetch(() => okResponse())
    const deltas: string[] = []
    for await (const d of anthropicAdapter.chatStream!(chatReq())) deltas.push(d)
    expect(deltas.join('')).toBe('OK')
  })

  test('429 opens the dedicated chat-anthropic breaker class with the retry hint', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    installFetch(
      () =>
        new Response('{"error":"slow down"}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '7' },
        }),
    )
    try {
      await anthropicAdapter.chat!(chatReq())
      expect.unreachable()
    } catch (e) {
      const rec = e as { endpointClass?: string; retryAfterMs?: number | null; message?: string }
      expect(rec.endpointClass ?? '').toBe('chat-anthropic')
      expect(rec.retryAfterMs).toBe(7000)
      expect(String(rec.message)).not.toContain('sk-ant-test-key')
    }
    expect(requests).toHaveLength(1)
    // While cooling, the adapter skips the attempt honestly (no second fetch).
    await expect(anthropicAdapter.chat!(chatReq())).rejects.toThrow(/rate-limited/)
    expect(requests).toHaveLength(1)
  })

  test('invalid credentials fail with an honest auth error and NO secret in the message', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-very-secret-value'
    installFetch(
      () =>
        new Response('{"error":{"type":"authentication_error"}}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    )
    try {
      await anthropicAdapter.chat!(chatReq())
      expect.unreachable()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      expect(msg).toMatch(/rejected credentials \(HTTP 401\)/)
      expect(msg).not.toContain('sk-ant-very-secret-value')
      expect(msg).not.toContain('sk-ant')
    }
    const h = await anthropicAdapter.health()
    expect(h.healthy).toBe(false)
    expect(h.failureCategory).toBe('auth')
    expect(h.detail).not.toContain('sk-ant-very-secret-value')
  })

  test('health verifies chat capability through a REAL tiny completion', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    installFetch((req) => {
      const body = req.body as { messages?: Array<{ role: string; content: string }>; max_tokens?: number }
      expect(body.max_tokens).toBe(8)
      expect(body.messages?.[0]?.content).toContain('OK')
      return okResponse()
    })
    const h = await anthropicAdapter.health()
    expect(h.healthy).toBe(true)
    expect(h.detail).toContain('real completion probe')
  })

  test('codeTask parses the same Messages contract', async () => {
    process.env.BEAN_PROVIDER_ANTHROPIC_API_KEY = 'sk-ant-test-key'
    installFetch(() => okResponse())
    const req: CodeTaskRequest = {
      messages: [{ role: 'user', content: 'write a function' }],
      mode: 'generate',
      maxPromptChars: 12000,
      timeoutMs: 5000,
    }
    const result = await anthropicAdapter.codeTask!(req)
    expect(result.content).toBe('OK')
  })
})

describe('Anthropic slot — SSE event mapping (unit)', () => {
  test('only content_block_delta text_delta events produce text', () => {
    expect(anthropicSseEventToDelta({ type: 'message_start' })).toBeNull()
    expect(anthropicSseEventToDelta({ type: 'ping' })).toBeNull()
    expect(anthropicSseEventToDelta({ type: 'content_block_delta', delta: { type: 'input_json_delta' } })).toBeNull()
    expect(
      anthropicSseEventToDelta({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }),
    ).toBe('x')
    expect(anthropicSseEventToDelta(null)).toBeNull()
  })
})
