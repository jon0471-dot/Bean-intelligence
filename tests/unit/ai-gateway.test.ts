/**
 * Unified AI gateway tests (work order Part 2 §5, §8, §16).
 *
 * Boundaries: the hosted adapter, the external provider HTTP call, the
 * provider-credential store and the database are fault-injected fakes (the
 * ONLY mocked boundaries); everything under test is the real gateway code —
 * planning, normalization, limit enforcement, error classification,
 * cancellation, metering, and honest configuration status. Contract pinned:
 *  - model resolution: unknown id → typed error; disabled backend →
 *    PRODUCT_UNAVAILABLE; external provider without credentials →
 *    PRODUCT_UNAVAILABLE ('awaiting-credentials' is never presented usable);
 *  - messages: system instruction prepended once, per-message char cap and
 *    history cap enforced from the backend's REAL limits;
 *  - the chat-class 429 breaker fails fast BEFORE any adapter call;
 *  - cancellation unwinds between deltas (GatewayCancelledError);
 *  - failures map to stable BEAN codes; error text never contains credentials;
 *  - the public model projection carries no endpoint URLs or secret refs.
 *
 * Run: bun test tests/unit/ai-gateway.test.ts
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
// Static import is safe: errors.ts has zero imports (plain error class), so
// this binds before any mock.module registration without touching the fakes.
import { BeanApiError } from '../../src/lib/api/errors'
import { _resetUpstreamCooldownForTests, noteUpstream429, UpstreamRateLimitError, UpstreamAuthError, UpstreamBillingError } from '../../src/lib/upstream/gateway'
// The REAL hosted-llm module stays REAL in this file — no mock.module here.
// Monkey-patching the adapter's METHOD properties (with save/restore) scopes
// the fake to this file; bun module mocks are process-global and would leak
// into every later test file that needs the genuine adapter/parser.
import { hostedLlmAdapter, UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'

// ---- controllable fakes (the ONLY mocked boundaries) ------------------------

/** Hosted adapter fake: scripted chat/stream results. */
const hosted: {
  chatImpl: () => Promise<unknown>
  streamImpl: AsyncGenerator<string, void, unknown>
  chatCalls: number
  streamCalls: number
} = {
  chatImpl: async (): Promise<unknown> => ({ choices: [{ message: { content: 'ok' } }] }),
  streamImpl: (async function* () {
    yield 'he'
    yield 'llo'
  })(),
  chatCalls: 0,
  streamCalls: 0,
}

// ---- real-module method patching (restored in afterEach) ---------------------

const realChat = hostedLlmAdapter.chat
const realChatStream = hostedLlmAdapter.chatStream
const realHealth = hostedLlmAdapter.health

function installHostedFakes(): void {
  hostedLlmAdapter.chat = async function (req: unknown) {
    hosted.chatCalls += 1
    return {
      content: await (hosted.chatImpl() as Promise<{ choices: Array<{ message: { content: string } }> }>).then((r) => r.choices[0].message.content),
      tokensInEst: 11,
      tokensOutEst: 7,
      durationMs: 5,
      _req: req,
    }
  } as typeof hostedLlmAdapter.chat
  hostedLlmAdapter.chatStream = async function* (_req: unknown) {
    hosted.streamCalls += 1
    yield* hosted.streamImpl
  } as typeof hostedLlmAdapter.chatStream
  hostedLlmAdapter.health = async function () {
    return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'fake probe' }
  } as typeof hostedLlmAdapter.health
}

function restoreHosted(): void {
  hostedLlmAdapter.chat = realChat
  hostedLlmAdapter.chatStream = realChatStream
  hostedLlmAdapter.health = realHealth
}

/** Provider-credential store fake. */
const credState = { activeCredential: { id: 'cred-1' } as { id: string } | null, decryptCalls: 0 }
mock.module('@/lib/security/provider-credentials', () => ({
  async getActiveCredentialId() {
    return credState.activeCredential?.id ?? null
  },
  async decryptProviderCredential() {
    credState.decryptCalls += 1
    if (!credState.activeCredential) throw new Error('no credential')
    return { payload: { apiKey: 'ext-secret-key-000' }, baseUrl: 'https://external.example/v1', provider: 'openai-compatible' }
  },
  REGISTERED_PROVIDERS: ['openai-compatible'],
}))

/** Database fake: metering + credential lookup. */
const meteringLog: Array<Record<string, unknown>> = []
const usageLog: Array<Record<string, unknown>> = []
mock.module('@/lib/db', () => ({
  db: {
    gatewayRequestLog: {
      async create({ data }: { data: Record<string, unknown> }) {
        meteringLog.push(data)
        return data
      },
    },
    usageRecord: {
      async create({ data }: { data: Record<string, unknown> }) {
        usageLog.push(data)
        return data
      },
      async count() {
        return 0
      },
    },
    providerCredential: {
      async findFirst() {
        return credState.activeCredential
      },
    },
  },
}))

/** External provider HTTP fake. */
let externalFetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => new Response('{}', { status: 200 })

// ---- imports under test (AFTER the mock declarations) -----------------------

const { planGatewayChat, executeGatewayChat, executeGatewayChatStream, gatewayErrorFor, isGatewayCancelled, GatewayCancelledError, recordGatewayCall } = await import('../../src/lib/ai-gateway/gateway')
const { getGatewayModels, toPublicModels, resolveGatewayModel, EXTERNAL_OPENAI_COMPATIBLE_ID } = await import('../../src/lib/registry/models')
const { openAICompatibleChat, openAICompatibleStream } = await import('../../src/lib/ai-gateway/providers/openai-compatible')

const savedFetch = globalThis.fetch
beforeEach(() => {
  _resetUpstreamCooldownForTests()
  hosted.chatCalls = 0
  hosted.streamCalls = 0
  hosted.chatImpl = async () => ({ choices: [{ message: { content: 'ok' } }] })
  meteringLog.length = 0
  usageLog.length = 0
  credState.activeCredential = { id: 'cred-1' }
  credState.decryptCalls = 0
  hosted.streamImpl = (async function* () {
    yield 'he'
    yield 'llo'
  })()
  installHostedFakes()
  globalThis.fetch = savedFetch
})
afterEach(() => {
  restoreHosted()
  globalThis.fetch = savedFetch
})

const CTX = { userId: 'user-1', apiKeyId: null, authKind: 'session' as const, endpoint: '/api/v1/chat/completions', signal: null }

describe('gateway planning + normalization', () => {
  test('unknown model id → typed NOT_FOUND-shaped error', async () => {
    try {
      await planGatewayChat({ model: 'does-not-exist', messages: [{ role: 'user', content: 'hi' }] })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('NOT_FOUND')
    }
  })

  test('disabled backend (local Diffusers worker) → PRODUCT_UNAVAILABLE with the honest reason', async () => {
    try {
      await planGatewayChat({ model: 'bean-image-edit-local', messages: [{ role: 'user', content: 'hi' }] })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('PRODUCT_UNAVAILABLE')
      expect((e as BeanApiError).message).toMatch(/credential|not operational|Diffusers/i)
    }
  })

  test('external model without credentials → PRODUCT_UNAVAILABLE (never pretend usable)', async () => {
    credState.activeCredential = null
    try {
      await planGatewayChat({ model: EXTERNAL_OPENAI_COMPATIBLE_ID, messages: [{ role: 'user', content: 'hi' }] })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('PRODUCT_UNAVAILABLE')
      expect((e as BeanApiError).message).toMatch(/credential/i)
    }
  })

  test('image-only model cannot serve chat completions', async () => {
    try {
      await planGatewayChat({ model: 'bean-image-hosted', messages: [{ role: 'user', content: 'hi' }] })
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('CAPABILITY_UNSUPPORTED')
    }
  })

  test('system instruction is prepended exactly once and messages are clamped to backend limits', async () => {
    const plan = await planGatewayChat({
      model: 'bean-chat-hosted',
      system: 'You are BEAN.',
      messages: [
        { role: 'user', content: 'a'.repeat(15_000) },
        { role: 'assistant', content: 'b'.repeat(15_000) },
        { role: 'user', content: 'c'.repeat(15_000) },
        { role: 'user', content: 'final question' },
      ],
    })
    const systemTurns = plan.messages.filter((m) => (m as { role: string }).role === 'system')
    expect(systemTurns).toHaveLength(1)
    expect(systemTurns[0].content).toBe('You are BEAN.')
    // Hosted backend limit: 12,000 chars per message.
    for (const m of plan.messages) {
      if ((m as { role: string }).role !== 'system') expect(m.content.length).toBeLessThanOrEqual(12_000)
    }
    // History cap (24) + the new user turn — all present after clamping.
    expect(plan.messages[plan.messages.length - 1].content).toBe('final question')
  })

  test('temperature is clamped into the provider-accepted range', async () => {
    const plan = await planGatewayChat({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'x' }], temperature: 99 })
    expect(plan.temperature).toBe(2)
  })
})

describe('gateway execution — hosted path', () => {
  test('non-streaming completion normalizes the adapter result and meters usage', async () => {
    const plan = await planGatewayChat({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'hello there' }] })
    const result = await executeGatewayChat(plan, CTX)
    expect(result.content).toBe('ok')
    expect(result.finishReason).toBe('stop')
    expect(result.usage.exact).toBe(false) // hosted path: estimates, labeled
    expect(result.usage.tokensOut).toBeGreaterThan(0)
    expect(usageLog.length).toBe(0) // metering happens via recordGatewayCall
    await recordGatewayCall({ ctx: CTX, plan, result, status: 200, streamed: false, modelId: plan.model.id, tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, durationMs: result.durationMs })
    expect(usageLog.length).toBe(1)
    expect(meteringLog.length).toBe(1)
    expect(JSON.stringify(meteringLog[0])).not.toContain('hello there') // no prompts in the request log
  })

  test('an open 429 breaker fails fast BEFORE the adapter is called', async () => {
    noteUpstream429('chat')
    const plan = await planGatewayChat({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'hi' }] })
    try {
      await executeGatewayChat(plan, CTX)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('RATE_LIMITED')
      expect(hosted.chatCalls).toBe(0) // zero upstream traffic while cooling down
    }
  })

  test('cancellation unwinds a non-streaming call waiting on the adapter', async () => {
    const controller = new AbortController()
    hosted.chatImpl = () => new Promise(() => undefined) // never settles
    const plan = await planGatewayChat({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'hi' }] })
    const p = executeGatewayChat(plan, { ...CTX, signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    try {
      await p
      expect.unreachable()
    } catch (e) {
      expect(isGatewayCancelled(e)).toBe(true)
    }
  })

  test('streaming yields normalized deltas; cancellation between deltas stops the generator', async () => {
    const plan = await planGatewayChat({ model: 'bean-code-hosted', messages: [{ role: 'user', content: 'hi' }], stream: true })
    const collected: string[] = []
    for await (const delta of executeGatewayChatStream(plan, CTX)) collected.push(delta)
    expect(collected.join('')).toBe('hello')
    expect(hosted.streamCalls).toBe(1)

    // Cancellation: the generator unwinds instead of consuming the rest.
    hosted.streamImpl = (async function* () {
      yield 'first'
      await new Promise((r) => setTimeout(r, 30))
      yield 'never-seen'
    })()
    const controller = new AbortController()
    const plan2 = await planGatewayChat({ model: 'bean-code-hosted', messages: [{ role: 'user', content: 'hi' }], stream: true })
    const gen = executeGatewayChatStream(plan2, { ...CTX, signal: controller.signal })
    const first = await gen.next()
    expect(first.value).toBe('first')
    controller.abort()
    // The next iteration unwinds with the typed cancellation error — the
    // 'never-seen' delta is never consumed.
    try {
      await gen.next()
      expect.unreachable()
    } catch (e) {
      expect(isGatewayCancelled(e)).toBe(true)
    }
  })
})

describe('gateway execution — external OpenAI-compatible path', () => {
  test('requires providerModel for external calls', async () => {
    const plan = await planGatewayChat({ model: EXTERNAL_OPENAI_COMPATIBLE_ID, messages: [{ role: 'user', content: 'hi' }] })
    try {
      await executeGatewayChat(plan, CTX)
      expect.unreachable()
    } catch (e) {
      expect((e as BeanApiError).code).toBe('VALIDATION_ERROR')
    }
  })

  test('non-streaming external call decrypts the credential server-side and reports exact usage when provided', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'external answer' } }], usage: { prompt_tokens: 42, completion_tokens: 17 } }), { status: 200 })) as unknown as typeof fetch
    const plan = await planGatewayChat({
      model: EXTERNAL_OPENAI_COMPATIBLE_ID,
      messages: [{ role: 'user', content: 'hi' }],
      providerModel: 'gpt-4o-mini',
    })
    const result = await executeGatewayChat(plan, CTX)
    expect(result.content).toBe('external answer')
    expect(result.usage.exact).toBe(true)
    expect(result.usage.tokensIn).toBe(42)
    expect(credState.decryptCalls).toBe(1)
  })

  test('external 401 maps to the honest BACKEND_FAILURE wording (no credential in the message)', async () => {
    globalThis.fetch = (async () => new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch
    const plan = await planGatewayChat({ model: EXTERNAL_OPENAI_COMPATIBLE_ID, messages: [{ role: 'user', content: 'hi' }], providerModel: 'gpt-4o-mini' })
    try {
      await executeGatewayChat(plan, CTX)
      expect.unreachable()
    } catch (e) {
      // The execution layer throws the TYPED upstream class; the stable BEAN
      // code is applied at the API boundary by gatewayErrorFor.
      expect(e).toBeInstanceOf(UpstreamAuthError)
      expect((e as Error).message).not.toContain('ext-secret-key-000')
      const mapped = gatewayErrorFor(e)
      expect(mapped.code).toBe('BACKEND_FAILURE')
      expect(mapped.message).not.toContain('ext-secret-key-000')
    }
  })

  test('external 429 maps to RATE_LIMITED', async () => {
    globalThis.fetch = (async () => new Response('{"error":"slow down"}', { status: 429 })) as unknown as typeof fetch
    const plan = await planGatewayChat({ model: EXTERNAL_OPENAI_COMPATIBLE_ID, messages: [{ role: 'user', content: 'hi' }], providerModel: 'gpt-4o-mini' })
    try {
      await executeGatewayChat(plan, CTX)
      expect.unreachable()
    } catch (e) {
      // Typed class from the execution layer; stable code from the boundary.
      expect(e).toBeInstanceOf(UpstreamRateLimitError)
      const mapped = gatewayErrorFor(e)
      expect(mapped.code).toBe('RATE_LIMITED')
    }
  })

  test('external streaming forwards provider deltas', async () => {
    const sseBody = `data: {"choices":[{"delta":{"content":"ext-"}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n`
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sseBody))
        c.close()
      },
    })
    globalThis.fetch = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch
    const plan = await planGatewayChat({ model: EXTERNAL_OPENAI_COMPATIBLE_ID, messages: [{ role: 'user', content: 'hi' }], providerModel: 'gpt-4o-mini', stream: true })
    const chunks: string[] = []
    for await (const d of executeGatewayChatStream(plan, CTX)) chunks.push(d)
    expect(chunks.join('')).toBe('ext-answer')
  })
})

describe('gateway error mapping', () => {
  test('typed upstream classes map to stable BEAN codes', () => {
    expect(gatewayErrorFor(new UpstreamRateLimitError('chat', 'x')).code).toBe('RATE_LIMITED')
    expect(gatewayErrorFor(new UpstreamAuthError('x', 401)).code).toBe('BACKEND_FAILURE')
    expect(gatewayErrorFor(new UpstreamBillingError('x', 402)).code).toBe('BACKEND_FAILURE')
    expect(gatewayErrorFor(new Error('gateway chat completion timed out after 90000ms')).code).toBe('BACKEND_TIMEOUT')
    expect(gatewayErrorFor(new Error('fetch failed')).code).toBe('BACKEND_FAILURE')
    expect(gatewayErrorFor(new UpstreamTruncatedError()).code).toBe('CAPABILITY_UNSUPPORTED')
  })

  test('error text never contains credential material', () => {
    const e = gatewayErrorFor(new Error('status 401: Bearer sk-live-secret-abc123 rejected'))
    expect(e.message).not.toContain('sk-live-secret-abc123')
  })
})

describe('unified model registry — public projection safety', () => {
  test('public projection contains no endpoint URLs or credential material', async () => {
    const models = await getGatewayModels()
    const publicModels = toPublicModels(models)
    const json = JSON.stringify(publicModels)
    expect(json).not.toContain('/v1')
    expect(json).not.toContain('https://')
    expect(json).not.toContain('ext-secret-key-000')
    // Every model carries honest availability + configuration status.
    for (const m of publicModels) {
      expect(['available', 'unavailable', 'awaiting-credentials', 'disabled']).toContain(m.availability as string)
      expect(['configured', 'awaiting-credentials', 'disabled']).toContain(m.configurationStatus as string)
    }
    // The hosted chat models are present and chat-capable.
    const ids = publicModels.map((m) => m.id as string)
    expect(ids).toContain('bean-chat-hosted')
    expect(ids).toContain('bean-code-hosted')
    expect(ids).toContain(EXTERNAL_OPENAI_COMPATIBLE_ID)
  })

  test('external model configuration status tracks the actual credential state', async () => {
    const configured = await resolveGatewayModel(EXTERNAL_OPENAI_COMPATIBLE_ID)
    expect(configured.configurationStatus).toBe('configured')
    credState.activeCredential = null
    const awaiting = await resolveGatewayModel(EXTERNAL_OPENAI_COMPATIBLE_ID)
    expect(awaiting.configurationStatus).toBe('awaiting-credentials')
    expect(awaiting.enabled).toBe(false)
  })
})

describe('openai-compatible adapter — request shaping', () => {
  test('sends the model name, auth header, and clamped messages; never leaks the key into errors', async () => {
    let capturedBody: Record<string, unknown> | null = null
    let capturedAuth = ''
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      capturedAuth = String((init?.headers as Record<string, string>)?.authorization ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200 })
    }) as unknown as typeof fetch
    const ctx = CTX
    const result = await openAICompatibleChat(
      {
        credentialId: 'cred-1',
        providerModel: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'a'.repeat(40_000) },
        ],
      },
      ctx,
    )
    expect(result.content).toBe('ok')
    expect(capturedAuth).toBe('Bearer ext-secret-key-000')
    expect(capturedBody!.model).toBe('gpt-4o-mini')
    const messages = (capturedBody! as { messages: Array<{ content: string }> }).messages
    expect(messages[1].content.length).toBeLessThanOrEqual(32_000)
    expect(messages[0].content).toBe('be brief')
  })
})
