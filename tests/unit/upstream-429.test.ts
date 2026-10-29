/**
 * Upstream HTTP 429 root-cause regression tests (2026-10-29).
 *
 * Root cause proven from server logs + spaced live probes: the shared z-ai
 * gateway rate-limits per time window; one research turn fans out to many
 * upstream calls (5 parallel searches × bounded retry + page reads + LLM
 * solve passes), and the OLD code retried 429s into the throttling gateway
 * (1.2s search retry, 2.5s chat retry), deepening the throttle until whole
 * turns failed. The throttle body is generic ("Too many requests..."), with
 * no Retry-After header exposed by the SDK.
 *
 * These tests pin the FIX contract at the SDK boundary ONLY (fault-injected
 * statuses); the pipeline/adapter logic under test is the real production
 * code:
 *   1. status classification (429 vs 401/403 vs 402 vs timeout vs other);
 *   2. an observed 429 opens a per-endpoint-class cooldown breaker and the
 *      next calls fail fast WITHOUT new network traffic (no retry storm);
 *   3. searchWithBoundedRetry does NOT retry a 429 (exactly one attempt) but
 *      STILL retries transient failures (503 / empty-then-success);
 *   4. bounded concurrency for the pipeline's search fan-out;
 *   5. recovery: after the breaker clears, real calls go out and succeed;
 *   6. chat completions: no blind 429 retry; typed auth/billing errors;
 *   7. customer-facing error payloads distinguish throttling from
 *      auth/billing from application failure.
 * No fake search RESULTS are produced for failure scenarios: mocked calls
 * only ever FAIL until the recovery tests explicitly allow success.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controllable fake SDK (the ONLY mocked boundary) ----------------------
const state = {
  invokeImpl: async (_fn: string, _args: unknown): Promise<unknown> => [],
  createImpl: async (_body: unknown): Promise<unknown> => ({
    choices: [{ message: { content: 'OK' } }],
  }),
  invokeCalls: 0,
  createCalls: 0,
  invokeConcurrent: 0,
  invokeMaxConcurrent: 0,
}

function resetFake() {
  state.invokeImpl = async () => []
  state.createImpl = async () => ({ choices: [{ message: { content: 'OK' } }] })
  state.invokeCalls = 0
  state.createCalls = 0
  state.invokeConcurrent = 0
  state.invokeMaxConcurrent = 0
}

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      functions: {
        invoke: async (fn: string, args: unknown) => {
          state.invokeCalls += 1
          state.invokeConcurrent += 1
          state.invokeMaxConcurrent = Math.max(state.invokeMaxConcurrent, state.invokeConcurrent)
          try {
            return await state.invokeImpl(fn, args)
          } finally {
            state.invokeConcurrent -= 1
          }
        },
      },
      chat: {
        completions: {
          create: async (body: unknown) => {
            state.createCalls += 1
            return state.createImpl(body)
          },
        },
      },
    }),
  },
}))

// Import AFTER the mock registers so the modules bind to the fake SDK.
const {
  classifyUpstreamError,
  upstreamCoolingDown,
  upstreamCooldownRemainingMs,
  noteUpstream429,
  _resetUpstreamCooldownForTests,
  upstreamStreamErrorPayload,
  upstreamErrorCode,
  UpstreamRateLimitError,
  UpstreamAuthError,
  UpstreamBillingError,
  UPSTREAM_429_COOLDOWN_MS,
} = await import('../../src/lib/upstream/gateway')
const { webSearch, readPage, ResearchToolError } = await import('../../src/lib/research/provider')
const { searchWithBoundedRetry, runResearch, mapWithConcurrency } = await import('../../src/lib/research/pipeline')
const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
const { isDanglingDuplicateUserRow } = await import('../../src/app/api/riishe/chat/route')

/** The exact error shape the real SDK throws on a non-OK response. */
const sdk429 = (body = '{"error":"Too many requests, please try again later"}') =>
  new Error(`Function invoke failed with status 429: ${body}`)
const sdkChat429 = () =>
  new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}')

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  resetFake()
})

// ---- 1. classification ------------------------------------------------------

describe('classifyUpstreamError', () => {
  test('429 -> rate_limited with the parsed status', () => {
    expect(classifyUpstreamError(sdk429())).toEqual({ kind: 'rate_limited', status: 429 })
    expect(classifyUpstreamError(sdkChat429())).toEqual({ kind: 'rate_limited', status: 429 })
  })
  test('401/403 -> auth; 402 -> billing', () => {
    expect(classifyUpstreamError(new Error('Function invoke failed with status 401: bad key')).kind).toBe('auth')
    expect(classifyUpstreamError(new Error('API request failed with status 403: forbidden')).kind).toBe('auth')
    expect(classifyUpstreamError(new Error('API request failed with status 402: payment required')).kind).toBe('billing')
  })
  test('timeouts and plain failures stay distinct from throttling', () => {
    expect(classifyUpstreamError(new Error('web_search timed out after 20000ms'))).toEqual({ kind: 'timeout', status: null })
    expect(classifyUpstreamError(new Error('Function invoke failed with status 503: down'))).toEqual({ kind: 'other', status: 503 })
    expect(classifyUpstreamError('no status here')).toEqual({ kind: 'other', status: null })
  })
  test('a bare number or year-like text is not misclassified as a status', () => {
    expect(classifyUpstreamError(new Error('search failed: the term appeared 429 times in the corpus')).kind).toBe('other')
    expect(classifyUpstreamError(new Error('empty completion (length 0)')).kind).toBe('other')
  })
  test('typed breaker-skip errors (message says "HTTP 429", not "status 429") classify as rate_limited', () => {
    // Live-observed regression (2026-10-29): a breaker-skip surfaced as
    // BACKEND_FAILURE because the classifier only matched `status NNN`.
    const skip = new UpstreamRateLimitError(
      'chat',
      'chat completion not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago); call skipped to avoid worsening the throttle',
      false,
    )
    expect(classifyUpstreamError(skip)).toEqual({ kind: 'rate_limited', status: 429 })
    expect(upstreamStreamErrorPayload(skip).code).toBe('UPSTREAM_RATE_LIMITED')
  })
})

// ---- 2. provider boundary: typed errors + breaker ---------------------------

describe('webSearch / readPage 429 handling', () => {
  test('an observed 429 throws UpstreamRateLimitError and opens the functions breaker', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    await expect(webSearch('probe query one')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    expect(upstreamCoolingDown('functions')).toBe(true)
    expect(upstreamCoolingDown('chat')).toBe(false) // breaker is per endpoint class
  })

  test('while the breaker is open, searches fail fast WITHOUT new network calls', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    await expect(webSearch('probe query two')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    const callsAfterFirst = state.invokeCalls
    await expect(webSearch('probe query two')).rejects.toThrow(/not attempted/)
    await expect(webSearch('probe query two')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    expect(state.invokeCalls).toBe(callsAfterFirst) // zero extra upstream traffic
  })

  test('readPage also honors the shared functions breaker', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    await expect(readPage('https://example.com/a')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    await expect(readPage('https://example.com/a')).rejects.toThrow(/not attempted/)
    expect(state.invokeCalls).toBe(1)
  })

  test('auth failures are typed but do NOT open the rate-limit breaker', async () => {
    state.invokeImpl = async () => {
      throw new Error('Function invoke failed with status 401: invalid token')
    }
    await expect(webSearch('probe query three')).rejects.toBeInstanceOf(UpstreamAuthError)
    expect(upstreamCoolingDown('functions')).toBe(false)
    // The next call genuinely attempts the network again (auth needs no cooldown).
    await expect(webSearch('probe query three')).rejects.toBeInstanceOf(UpstreamAuthError)
    expect(state.invokeCalls).toBe(2)
  })

  test('billing failures are typed as UpstreamBillingError', async () => {
    state.invokeImpl = async () => {
      throw new Error('Function invoke failed with status 402: payment required')
    }
    await expect(webSearch('probe query four')).rejects.toBeInstanceOf(UpstreamBillingError)
  })

  test('non-HTTP failures stay ResearchToolError with the real provider text', async () => {
    state.invokeImpl = async () => {
      throw new Error('simulated outage: provider returned 503')
    }
    await expect(webSearch('probe query five')).rejects.toBeInstanceOf(ResearchToolError)
    await expect(webSearch('probe query five')).rejects.toThrow(/web_search failed: simulated outage/)
  })

  test('breaker expiry is verified by a real call, which can succeed (recovery)', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    await expect(webSearch('recovery probe query')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    expect(upstreamCooldownRemainingMs('functions')).toBeLessThanOrEqual(UPSTREAM_429_COOLDOWN_MS)
    // The provider recovers; clear BEAN's breaker exactly like expiry would.
    _resetUpstreamCooldownForTests()
    state.invokeImpl = async () => [
      { url: 'https://example.com/x', name: 'Example', snippet: 'real result', host_name: 'example.com' },
    ]
    const results = await webSearch('recovery probe query')
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com/x')
  })

  test('an explicit noteUpstream429 opens the breaker without any call', () => {
    noteUpstream429('functions')
    expect(upstreamCoolingDown('functions')).toBe(true)
  })
})

// ---- 3. bounded search retry: no retry into a 429 ---------------------------

describe('searchWithBoundedRetry under throttling', () => {
  test('a 429 makes EXACTLY ONE attempt (no second burst into the throttle)', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    const outcome = await searchWithBoundedRetry('throttle probe query', {})
    expect(outcome.results).toHaveLength(0)
    expect(outcome.attempts).toBe(1)
    expect(outcome.retried).toBe(false)
    expect(state.invokeCalls).toBe(1)
    expect(outcome.error).toContain('429')
  })

  test('transient 5xx failures still get the single bounded retry', async () => {
    let calls = 0
    state.invokeImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('Function invoke failed with status 503: transient')
      return [{ url: 'https://example.com/y', name: 'Y', snippet: 'ok', host_name: 'example.com' }]
    }
    const outcome = await searchWithBoundedRetry('transient probe query', {})
    expect(outcome.attempts).toBe(2)
    expect(outcome.retried).toBe(true)
    expect(outcome.results).toHaveLength(1)
    expect(state.invokeCalls).toBe(2)
  })

  test('empty-then-success keeps the measured single same-query retry', async () => {
    let calls = 0
    state.invokeImpl = async () => {
      calls += 1
      return calls === 1 ? [] : [{ url: 'https://example.com/z', name: 'Z', snippet: 'late', host_name: 'example.com' }]
    }
    const outcome = await searchWithBoundedRetry('empty probe query', {})
    expect(outcome.attempts).toBe(2)
    expect(outcome.results).toHaveLength(1)
  })
})

// ---- 4. bounded concurrency --------------------------------------------------

describe('mapWithConcurrency', () => {
  test('runs at most `limit` workers at once and settles every item', async () => {
    let active = 0
    let maxActive = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      if (n === 4) throw new Error('boom')
      return n * 2
    })
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(out).toHaveLength(5)
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(4)
    const rejected = out.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(Error)
  })
})

// ---- 5. runResearch end-to-end under a 429ing gateway ------------------------

describe('runResearch under a throttled gateway (honest degradation, no storm)', () => {
  test('one research question makes ONE search attempt, degrades honestly, and a retry inside the breaker window makes ZERO new calls', async () => {
    state.invokeImpl = async () => {
      throw sdk429()
    }
    const decision = { search: true, risk: 'high' as const, recencyDays: 30, reason: 'test' }
    const pack = await runResearch('What is the latest stable version of Next.js?', decision)
    expect(pack.sources).toHaveLength(0)
    expect(pack.degraded.join(' ')).toContain('429')
    const callsAfterFirst = state.invokeCalls
    // A second turn moments later must not hammer the throttled gateway:
    const pack2 = await runResearch('What is the latest stable version of React?', decision)
    expect(pack2.sources).toHaveLength(0)
    expect(state.invokeCalls).toBe(callsAfterFirst) // breaker absorbed the fan-out
    expect(upstreamCoolingDown('functions')).toBe(true)
  })

  test('after the breaker clears, a research question retrieves real sources (recovery)', async () => {
    state.invokeImpl = async (fn: string, args: unknown) => {
      if (fn === 'page_reader') {
        const url = (args as { url?: string })?.url ?? ''
        return { data: { url, title: 'Recovered page', html: `<html><body><article>${'<p>Real recovered article body text. </p>'.repeat(40)}</article></body></html>`, publishedTime: '2026-10-29T00:00:00Z' } }
      }
      const q = (args as { query?: string })?.query ?? ''
      return [
        { url: `https://example.com/r/${encodeURIComponent(q.slice(0, 12))}`, name: `Result for ${q}`, snippet: 'substantive result body', host_name: 'example.com', date: '2026-10-29' },
      ]
    }
    const decision = { search: true, risk: 'moderate' as const, reason: 'test' }
    const pack = await runResearch('Who wrote the original RFC for TCP?', decision)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0)
  })
})

// ---- 6. chat completions: no blind 429 retry ---------------------------------

describe('hostedLlmAdapter under throttling', () => {
  const req = {
    messages: [{ role: 'user' as const, content: 'Hello' }],
    maxPromptChars: 12_000,
    maxHistoryMessages: 20,
    timeoutMs: 90_000,
    thinkingEnabled: false,
  }

  test('a chat 429 is typed and NOT retried (exactly one upstream call)', async () => {
    state.createImpl = async () => {
      throw sdkChat429()
    }
    await expect(hostedLlmAdapter.chat!(req)).rejects.toBeInstanceOf(UpstreamRateLimitError)
    expect(state.createCalls).toBe(1)
    expect(upstreamCoolingDown('chat')).toBe(true)
    expect(upstreamCoolingDown('functions')).toBe(false) // endpoint classes independent
  })

  test('while the chat breaker is open, solve calls fail fast with zero new traffic', async () => {
    state.createImpl = async () => {
      throw sdkChat429()
    }
    await expect(hostedLlmAdapter.chat!(req)).rejects.toBeInstanceOf(UpstreamRateLimitError)
    const calls = state.createCalls
    await expect(hostedLlmAdapter.chat!(req)).rejects.toThrow(/not attempted/)
    await expect(hostedLlmAdapter.health()).resolves.toMatchObject({ healthy: false })
    expect(state.createCalls).toBe(calls)
  })

  test('auth/billing chat failures are typed, not mislabeled as throttling', async () => {
    state.createImpl = async () => {
      throw new Error('API request failed with status 403: forbidden')
    }
    await expect(hostedLlmAdapter.chat!(req)).rejects.toBeInstanceOf(UpstreamAuthError)
    expect(upstreamCoolingDown('chat')).toBe(false)
    state.createImpl = async () => {
      throw new Error('API request failed with status 402: payment required')
    }
    await expect(hostedLlmAdapter.chat!(req)).rejects.toBeInstanceOf(UpstreamBillingError)
  })

  test('after the breaker clears, chat succeeds for real (recovery)', async () => {
    state.createImpl = async () => {
      throw sdkChat429()
    }
    await expect(hostedLlmAdapter.chat!(req)).rejects.toBeInstanceOf(UpstreamRateLimitError)
    _resetUpstreamCooldownForTests()
    state.createImpl = async () => ({ choices: [{ message: { content: 'Recovered answer' } }] })
    const result = await hostedLlmAdapter.chat!(req)
    expect(result.content).toBe('Recovered answer')
  })

  test('health reports the rate-limited state honestly during an open breaker', async () => {
    noteUpstream429('chat')
    const health = await hostedLlmAdapter.health()
    expect(health.healthy).toBe(false)
    expect(health.detail).toContain('429')
  })
})

// ---- 7. customer-facing payload classification -------------------------------

describe('upstreamStreamErrorPayload / upstreamErrorCode', () => {
  test('429 -> UPSTREAM_RATE_LIMITED wording that never claims a reset time', () => {
    const p = upstreamStreamErrorPayload(sdkChat429())
    expect(p.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(p.partial).toBe(true)
    expect(p.error).toContain('429')
    expect(p.error).not.toMatch(/resets? (at|in) \d/)
    expect(p.error).not.toContain('quota exhausted')
  })
  test('401/403 -> UPSTREAM_AUTH saying an operator action is required', () => {
    const p = upstreamStreamErrorPayload(new Error('API request failed with status 401: bad token'))
    expect(p.code).toBe('UPSTREAM_AUTH')
    expect(p.error).toContain('401')
    expect(p.error).toContain('operator')
  })
  test('402 -> UPSTREAM_BILLING saying an account action is required', () => {
    const p = upstreamStreamErrorPayload(new Error('API request failed with status 402: payment required'))
    expect(p.code).toBe('UPSTREAM_BILLING')
    expect(p.error).toContain('402')
  })
  test('anything else stays the honest generic failure', () => {
    const p = upstreamStreamErrorPayload(new Error('upstream returned an empty completion'))
    expect(p.code).toBe('BACKEND_FAILURE')
  })
  test('upstreamErrorCode maps 429 to RATE_LIMITED for the JSON path', () => {
    expect(upstreamErrorCode(sdkChat429())).toBe('RATE_LIMITED')
    expect(upstreamErrorCode(new Error('API request failed with status 500: oops'))).toBe('BACKEND_FAILURE')
  })
})

// ---- 8. duplicate submissions: dangling-retry collapse ------------------------

describe('isDanglingDuplicateUserRow (duplicate-submission regression)', () => {
  test('a trailing unanswered user row identical to the incoming message is a dangling retry', () => {
    expect(
      isDanglingDuplicateUserRow({ role: 'user', content: 'Research a current topic: Gingee girl missing' }, 'Research a current topic: Gingee girl missing'),
    ).toBe(true)
    expect(isDanglingDuplicateUserRow(null, 'anything')).toBe(false)
  })

  test('never collapses after an ANSWERED turn or a DIFFERENT question', () => {
    expect(isDanglingDuplicateUserRow({ role: 'assistant', content: 'previous answer' }, 'previous answer')).toBe(false)
    expect(isDanglingDuplicateUserRow({ role: 'user', content: 'first question' }, 'second question')).toBe(false)
  })
})
