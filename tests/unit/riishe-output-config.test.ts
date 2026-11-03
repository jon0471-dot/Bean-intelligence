/**
 * BEAN Intelligence — RIISHE output-token configuration + truncation
 * detection at the SDK boundary. Run: bun test tests/unit/riishe-output-config.test.ts
 *
 * Pins the work-order §2 contract:
 *  - RIISHE_MAX_OUTPUT_TOKENS set   -> the provider body carries `max_tokens`;
 *  - RIISHE_MAX_OUTPUT_TOKENS unset -> NO `max_tokens` field is sent at all
 *    (the provider default applies — BEAN never silently caps output);
 *  - a non-streaming completion that ends with finish_reason "length" raises
 *    the typed UpstreamTruncatedError carrying the truncated text (never a
 *    silent short answer, never a generic failure).
 * The SDK is the only mocked boundary; bodies are captured, not invented.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import type { UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'

const state = {
  bodies: [] as unknown[],
  chatResponse: { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] } as unknown,
  streamFactory: (() => {
    throw new Error('no stream configured for this test')
  }) as () => AsyncIterable<unknown>,
}

function resetFake() {
  state.bodies = []
  state.chatResponse = { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }
  state.streamFactory = () => {
    throw new Error('no stream configured for this test')
  }
}

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      chat: {
        completions: {
          create: async (body: unknown) => {
            state.bodies.push(body)
            if (body && typeof body === 'object' && (body as { stream?: boolean }).stream === true) {
              return state.streamFactory()
            }
            return state.chatResponse
          },
        },
      },
    }),
  },
}))

// Import AFTER the mock registers.
const { hostedLlmAdapter, UpstreamTruncatedError: UpstreamTruncatedErrorCtor } = await import(
  '../../src/lib/adapters/hosted-llm'
)
const { _reloadStreamConfigForTests } = await import('../../src/lib/riishe/stream-config')

const ENV_KEY = 'RIISHE_MAX_OUTPUT_TOKENS'
const saved = process.env[ENV_KEY]

beforeEach(() => {
  resetFake()
  if (saved === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = saved
  _reloadStreamConfigForTests()
})

const req = {
  messages: [{ role: 'user' as const, content: 'hello' }],
  maxPromptChars: 20_000,
  maxHistoryMessages: 12,
  timeoutMs: 90_000,
  thinkingEnabled: false,
}

describe('RIISHE_MAX_OUTPUT_TOKENS — passthrough to the provider body', () => {
  test('unset: no max_tokens field is sent (provider default applies)', async () => {
    delete process.env.RIISHE_MAX_OUTPUT_TOKENS
    _reloadStreamConfigForTests()
    await hostedLlmAdapter.chat!(req)
    state.streamFactory = () =>
      (async function* () {
        yield new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`,
        )
      })()
    for await (const _ of hostedLlmAdapter.chatStream!(req)) void _
    expect(state.bodies.length).toBe(2)
    for (const body of state.bodies) {
      expect((body as { max_tokens?: number }).max_tokens).toBeUndefined()
    }
  })

  test('set: both chat and chatStream send the configured ceiling', async () => {
    process.env.RIISHE_MAX_OUTPUT_TOKENS = '8192'
    _reloadStreamConfigForTests()
    await hostedLlmAdapter.chat!(req)
    state.streamFactory = () =>
      (async function* () {
        yield new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`,
        )
      })()
    for await (const _ of hostedLlmAdapter.chatStream!(req)) void _
    expect(state.bodies.length).toBe(2)
    for (const body of state.bodies) {
      expect((body as { max_tokens?: number }).max_tokens).toBe(8192)
    }
  })
})

describe('non-streaming truncation — finish_reason "length" is its own honest class', () => {
  test('a length-capped completion raises UpstreamTruncatedError with the partial text', async () => {
    state.chatResponse = { choices: [{ message: { content: 'truncated answe' }, finish_reason: 'length' }] }
    let caught: UpstreamTruncatedError | null = null
    try {
      await hostedLlmAdapter.chat!(req)
      expect.unreachable()
    } catch (e) {
      caught = e as UpstreamTruncatedError
    }
    expect(caught).toBeInstanceOf(UpstreamTruncatedErrorCtor)
    expect(caught?.partialText).toBe('truncated answe')
    expect(caught?.message).toContain('finish_reason: length')
  })

  test('finish_reason "stop" still completes normally (no false truncation)', async () => {
    const result = await hostedLlmAdapter.chat!(req)
    expect(result.content).toBe('answer')
  })
})
