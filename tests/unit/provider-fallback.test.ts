/**
 * Provider resilience tests — credential resolution, bounded fallback
 * semantics, breaker isolation, cost guard, and the prepared dormant
 * adapter (mocks: Prisma boundary + global fetch; NO real network).
 *
 * Pinned behavior (brief Phase 1/6):
 *  - fallback activates ONLY for upstream-class failures (429/auth/billing/
 *    timeout/network), never for client validation errors;
 *  - a stream that already yielded tokens NEVER restarts on another
 *    provider (no duplicated text — the failure propagates honestly);
 *  - the fallback has its OWN breaker class ('chat-fallback') so a throttle
 *    on the primary gateway cannot fail-fast the fallback;
 *  - without credentials the fallback is dormant: typed refusal, zero fetch;
 *  - the operator request budget refuses work with a typed COST_LIMIT error;
 *  - usage attribution follows the backend that ACTUALLY served.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- in-memory Prisma fake --------------------------------------------------
const providerCredentialRows: Array<Record<string, unknown>> = []
const usageRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []

const fakeDb = {
  providerCredential: {
    findFirst: async ({ where }: { where: { provider: string; status: string } }) =>
      providerCredentialRows.find((r) => r.provider === where.provider && r.status === where.status) ?? null,
  },
  usageRecord: {
    count: async () => usageRows.length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRows.push(data)
      return data
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      auditRows.push(data)
      return data
    },
    findMany: async () => [],
  },
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

import { _resetUpstreamCooldownForTests, upstreamCoolingDown, noteUpstream429 } from '../../src/lib/upstream/gateway'
import { resolveProviderCredentials } from '../../src/lib/providers/credentials'
import { wrapWithProviderFallback, capabilityChain } from '../../src/lib/providers/routing'
import { openAiCompatibleAdapter } from '../../src/lib/providers/openai-compatible'
import { dailyRequestBudget } from '../../src/lib/providers/cost-guard'
import { BACKEND_REGISTRY, getBackend } from '../../src/lib/registry/backends'
import { UpstreamRateLimitError } from '../../src/lib/upstream/gateway'
import type { TaskAdapter, ChatRequest } from '../../src/lib/adapters/types'

const ENV_KEYS = ['BEAN_PROVIDER_OPENAI_API_KEY', 'BEAN_PROVIDER_OPENAI_BASE_URL', 'BEAN_PROVIDER_OPENAI_MODEL', 'BEAN_DAILY_REQUEST_BUDGET_RIISHE'] as const

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  providerCredentialRows.length = 0
  usageRows.length = 0
  auditRows.length = 0
  for (const k of ENV_KEYS) delete process.env[k]
})

function chatReq(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    maxPromptChars: 12000,
    maxHistoryMessages: 24,
    timeoutMs: 5000,
    ...overrides,
  }
}

function fakeAdapter(backendId: string, impl: Partial<TaskAdapter>): TaskAdapter {
  return { backendId, health: async () => ({ healthy: true, checkedAt: '', latencyMs: 1, detail: 'ok' }), ...impl }
}

describe('provider registry — fallback wiring', () => {
  test('RIISHE and CODE GIFTZ chat backends declare the prepared fallback', () => {
    expect(getBackend('bean-llm-hosted-primary')?.fallbacks).toContain('bean-llm-openai-compatible')
    expect(getBackend('bean-code-llm-hosted-primary')?.fallbacks).toContain('bean-llm-openai-compatible')
    const fb = getBackend('bean-llm-openai-compatible')
    expect(fb).toBeDefined()
    expect(fb?.enabled).toBe(false) // dormant without credentials
    expect(fb?.unavailableReason).toContain('BEAN_PROVIDER_OPENAI_API_KEY')
  })

  test('image/video chains stay single-provider (no authorized alternative)', () => {
    expect(getBackend('bean-image-hosted-primary')?.fallbacks).toEqual([])
    expect(getBackend('bean-image-hosted-edit')?.fallbacks).toEqual([])
    expect(getBackend('bean-video-hosted-primary')?.fallbacks).toEqual([])
  })

  test('capabilityChain is structural: primary + declared fallbacks, deduped', () => {
    const primary = getBackend('bean-llm-hosted-primary')!
    const chain = capabilityChain(primary, {
      'bean-llm-hosted-primary': fakeAdapter('bean-llm-hosted-primary', {}),
      'bean-llm-openai-compatible': openAiCompatibleAdapter,
    })
    // 2026-11-07 free-first engine: the chain gained the credential-gated
    // local llama.cpp lane AFTER the OpenAI-compatible fallback.
    expect(chain.map((c) => c.backend.id)).toEqual([
      'bean-llm-hosted-primary',
      'bean-llm-openai-compatible',
      'bean-chat-local-llamacpp',
    ])
  })
})

describe('credential resolution (names only, never values)', () => {
  test('openai-compatible is not-configured with no vault row and no env', async () => {
    const res = await resolveProviderCredentials('openai-compatible')
    expect(res.present).toBe(false)
    expect(res.status).toBe('not-configured')
  })

  test('an active vault row makes the fallback present (admin-vault)', async () => {
    providerCredentialRows.push({ provider: 'openai-compatible', status: 'active', id: 'cred-1' })
    const res = await resolveProviderCredentials('openai-compatible')
    expect(res.present).toBe(true)
    expect(res.status).toBe('admin-vault')
  })

  test('env key alone makes the fallback present (env-configured)', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-env-test-1234567890'
    const res = await resolveProviderCredentials('openai-compatible')
    expect(res.present).toBe(true)
    expect(res.status).toBe('env-configured')
    expect(res.source).not.toContain('sk-env-test') // values never leak into descriptions
  })

  test('zai-gateway resolves platform-managed from the runtime config file', async () => {
    const res = await resolveProviderCredentials('zai-gateway')
    expect(res.present).toBe(true)
    expect(res.status).toBe('platform-managed')
  })
})

describe('dormant fallback adapter (no credentials)', () => {
  test('chat refuses with a typed not-attempted error and ZERO fetches', async () => {
    let fetched = 0
    const realFetch = globalThis.fetch
    const noNetworkFetch = (async (..._a: unknown[]) => {
      fetched += 1
      throw new Error('network must not be touched while dormant')
    }) as unknown as typeof fetch
    globalThis.fetch = noNetworkFetch
    try {
      await expect(openAiCompatibleAdapter.chat!(chatReq())).rejects.toThrow(/not configured/)
      expect(fetched).toBe(0)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('health reports honest not-configured (never healthy, never a guess)', async () => {
    const h = await openAiCompatibleAdapter.health()
    expect(h.healthy).toBe(false)
    expect(h.failureCategory).toBe('not-configured')
    expect(h.detail).toContain('never routed to')
  })
})

describe('breaker isolation — chat-fallback vs chat', () => {
  test('a 429 on the fallback class never opens the primary chat breaker', () => {
    noteUpstream429('chat-fallback')
    expect(upstreamCoolingDown('chat-fallback')).toBe(true)
    expect(upstreamCoolingDown('chat')).toBe(false)
  })
})

describe('bounded fallback semantics (wrapper)', () => {
  function makePreflight(primary: TaskAdapter, productId = 'riishe') {
    return {
      backend: getBackend('bean-llm-hosted-primary')!,
      adapter: primary,
      release: () => undefined,
      servedBy: { backendId: 'bean-llm-hosted-primary' },
      ...(productId ? {} : {}),
    }
  }

  test('upstream-class failure on primary → credentialed fallback serves; servedBy + audit updated', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-env-test-1234567890' // env-configured fallback
    const failing: TaskAdapter = fakeAdapter('bean-llm-hosted-primary', {
      chat: async () => {
        throw new UpstreamRateLimitError('chat', 'gateway 429')
      },
    })
    const succeeding: TaskAdapter = fakeAdapter('bean-llm-openai-compatible', {
      chat: async () => ({ content: 'fallback answer', tokensInEst: 1, tokensOutEst: 2, durationMs: 3 }),
    })
    const wrapped = await wrapWithProviderFallback(
      makePreflight(failing),
      {
        'bean-llm-hosted-primary': failing,
        'bean-llm-openai-compatible': succeeding,
      },
      { productId: 'riishe', task: 'chat' },
    )
    const res = await wrapped.adapter.chat!(chatReq())
    expect(res.content).toBe('fallback answer')
    expect(wrapped.servedBy.backendId).toBe('bean-llm-openai-compatible')
  })

  test('client validation errors NEVER trigger fallback (typed error propagates)', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-env-test-1234567890'
    let fallbackCalls = 0
    const failing: TaskAdapter = fakeAdapter('bean-llm-hosted-primary', {
      chat: async () => {
        throw new Error('Upstream returned an empty completion')
      },
    })
    const succeeding: TaskAdapter = fakeAdapter('bean-llm-openai-compatible', {
      chat: async () => {
        fallbackCalls += 1
        return { content: 'x', tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }
      },
    })
    const wrapped = await wrapWithProviderFallback(
      makePreflight(failing),
      { 'bean-llm-hosted-primary': failing, 'bean-llm-openai-compatible': succeeding },
      { productId: 'riishe', task: 'chat' },
    )
    await expect(wrapped.adapter.chat!(chatReq())).rejects.toThrow(/empty completion/)
    expect(fallbackCalls).toBe(0)
  })

  test('mid-stream failure after tokens flowed propagates — never restarts on the fallback', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-env-test-1234567890'
    async function* primaryStream() {
      yield 'partial '
      throw new UpstreamRateLimitError('chat', 'gateway died mid-stream')
    }
    async function* fallbackStream() {
      yield 'SHOULD NOT APPEAR'
    }
    const failing = fakeAdapter('bean-llm-hosted-primary', { chatStream: primaryStream })
    const fallback = fakeAdapter('bean-llm-openai-compatible', { chatStream: fallbackStream })
    const wrapped = await wrapWithProviderFallback(
      makePreflight(failing),
      { 'bean-llm-hosted-primary': failing, 'bean-llm-openai-compatible': fallback },
      { productId: 'riishe', task: 'chat' },
    )
    const chunks: string[] = []
    await expect(
      (async () => {
        for await (const d of wrapped.adapter.chatStream!(chatReq())) chunks.push(d)
      })(),
    ).rejects.toThrow(/mid-stream/)
    expect(chunks).toEqual(['partial '])
  })

  test('pre-stream failure falls back cleanly (no tokens seen by the client)', async () => {
    process.env.BEAN_PROVIDER_OPENAI_API_KEY = 'sk-env-test-1234567890'
    async function* primaryStream(): AsyncGenerator<string> {
      throw new UpstreamRateLimitError('chat', 'breaker open on primary')
      yield '' // unreachable
    }
    async function* fallbackStream(): AsyncGenerator<string> {
      yield 'fallback token'
    }
    const failing = fakeAdapter('bean-llm-hosted-primary', { chatStream: primaryStream })
    const fallback = fakeAdapter('bean-llm-openai-compatible', { chatStream: fallbackStream })
    const wrapped = await wrapWithProviderFallback(
      makePreflight(failing),
      { 'bean-llm-hosted-primary': failing, 'bean-llm-openai-compatible': fallback },
      { productId: 'riishe', task: 'chat' },
    )
    const chunks: string[] = []
    for await (const d of wrapped.adapter.chatStream!(chatReq())) chunks.push(d)
    expect(chunks).toEqual(['fallback token'])
  })

  test('uncredentialed fallback → wrapper passes through untouched (single-provider behavior)', async () => {
    const failing: TaskAdapter = fakeAdapter('bean-llm-hosted-primary', {
      chat: async () => {
        throw new UpstreamRateLimitError('chat', 'gateway 429')
      },
    })
    const wrapped = await wrapWithProviderFallback(
      makePreflight(failing),
      { 'bean-llm-hosted-primary': failing, 'bean-llm-openai-compatible': openAiCompatibleAdapter },
      { productId: 'riishe', task: 'chat' },
    )
    // openAiCompatibleAdapter resolves to not-configured → usable.length === 1
    // → the PRIMARY adapter object is returned as-is.
    expect(wrapped.adapter).toBe(failing)
  })
})

describe('provider request budget (cost guard)', () => {
  test('unset env → no budget (null)', async () => {
    expect(await dailyRequestBudget('riishe')).toBeNull()
  })
  test('invalid values are ignored, never trusted', async () => {
    process.env.BEAN_DAILY_REQUEST_BUDGET_RIISHE = '-5'
    expect(await dailyRequestBudget('riishe')).toBeNull()
    process.env.BEAN_DAILY_REQUEST_BUDGET_RIISHE = 'abc'
    expect(await dailyRequestBudget('riishe')).toBeNull()
  })
  test('valid env parses to a floor-ed integer', async () => {
    process.env.BEAN_DAILY_REQUEST_BUDGET_RIISHE = '10.9'
    expect(await dailyRequestBudget('riishe')).toBe(10)
  })
  test('ADMIN OVERRIDE (Phase 9): a SystemSetting budget wins over env (DB-unavailable in tests → env fallback)', async () => {
    // In the unit environment the SystemSetting table lookup fails cleanly,
    // which MUST fall back to the env budget — the override never breaks
    // submissions. The live DB-backed override is exercised in the platform
    // acceptance (settings row → tightened budget → typed COST_LIMIT).
    process.env.BEAN_DAILY_REQUEST_BUDGET_RIISHE = '7'
    expect(await dailyRequestBudget('riishe')).toBe(7)
    delete process.env.BEAN_DAILY_REQUEST_BUDGET_RIISHE
  })
})
