/**
 * CHAT-RECOVERY (2026-11-10) — the quota contract tests.
 *
 * Measured defect this pins down (docs/reports/RIISHE-CHAT-RECOVERY.md):
 *  1. /api/health burned REAL inference quota (2 completions + 1 web_search
 *     per fresh poll) and its concurrent burst tripped the provider's
 *     authoritative 2-QPS limit every dashboard refresh — the observed 429
 *     re-opened the chat breaker each poll, so chat rendered "rate-limited"
 *     for hours while the account was serving. Health probes now fire ZERO
 *     metered requests.
 *  2. Four research-path completions (query generation, semantic freshness
 *     routing, claims verification, cross-lingual expansion) bypassed the
 *     chat-class 429 breaker entirely, firing raw completions into an
 *     actively throttling gateway. They now share ONE guarded entry point
 *     and degrade through their existing honest fallbacks.
 *  3. Real chat/search attempts are recorded (in-memory) so the quota-free
 *     probes still carry REAL traffic evidence.
 *
 * The ONLY mocked boundary is the SDK fake (same discipline as
 * upstream-429.test.ts); the adapter/guard/pipeline code under test is the
 * real production code.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

const state = {
  invokeImpl: async (_fn: string, _args: unknown): Promise<unknown> => [],
  createImpl: async (_body: unknown): Promise<unknown> => ({
    choices: [{ message: { content: 'OK' } }],
  }),
  invokeCalls: 0,
  createCalls: 0,
}

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' },
      functions: {
        invoke: async (fn: string, args: unknown) => {
          state.invokeCalls += 1
          return state.invokeImpl(fn, args)
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

const { guardedChatCompletion } = await import('../../src/lib/adapters/hosted-llm')
const { _resetUpstreamCooldownForTests, upstreamCoolingDown } = await import(
  '../../src/lib/upstream/gateway'
)
const { _resetRealAttemptsForTests, lastRealAttempt } = await import(
  '../../src/lib/adapters/last-attempts'
)
const { generateQueries } = await import('../../src/lib/research/pipeline')
const { semanticFreshnessCheck } = await import('../../src/lib/research/semantic-router')
const { checkClaims } = await import('../../src/lib/verify/claims')
const { englishQueryVariant } = await import('../../src/lib/intel/crosslingual')
const { webSearch, probeResearchHealth } = await import('../../src/lib/research/provider')
const { UpstreamRateLimitError } = await import('../../src/lib/upstream/gateway')

const realFetch = globalThis.fetch
beforeEach(() => {
  _resetUpstreamCooldownForTests()
  _resetRealAttemptsForTests()
  state.invokeImpl = async () => []
  state.createImpl = async () => ({ choices: [{ message: { content: 'OK' } }] })
  state.invokeCalls = 0
  state.createCalls = 0
  globalThis.fetch = (async () => new Response('404 page not found', { status: 404 })) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const chat429 = () =>
  new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}')

describe('guardedChatCompletion — the one guarded entry for out-of-adapter chat calls', () => {
  test('passes through to the gateway when it is healthy and records the real attempt', async () => {
    const result = (await guardedChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    })) as { choices?: Array<{ message?: { content?: string } }> }
    expect(result.choices?.[0]?.message?.content).toBe('OK')
    expect(state.createCalls).toBe(1)
    const attempt = lastRealAttempt('chat-completion')
    expect(attempt?.ok).toBe(true)
  })

  test('fail-fasts while the chat breaker is open: typed skip error, ZERO network, no attempt record', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await expect(guardedChatCompletion({ messages: [] })).rejects.toBeInstanceOf(UpstreamRateLimitError)
    expect(upstreamCoolingDown('chat')).toBe(true)
    const calls = state.createCalls
    const attemptsBefore = lastRealAttempt('chat-completion')

    await expect(guardedChatCompletion({ messages: [] })).rejects.toThrow(/not attempted/)
    expect(state.createCalls).toBe(calls) // zero new traffic
    expect(lastRealAttempt('chat-completion')).toBe(attemptsBefore) // a skip is NOT an attempt
  })

  test('an observed 429 is recorded as a failed upstream attempt (health evidence)', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await expect(guardedChatCompletion({ messages: [] })).rejects.toBeInstanceOf(UpstreamRateLimitError)
    const attempt = lastRealAttempt('chat-completion')
    expect(attempt?.ok).toBe(false)
    expect(attempt?.upstream).toBe(true)
    expect(attempt?.failureCategory).toBe('rate-limited')
    expect(attempt?.httpStatus).toBe(429)
  })
})

describe('the four formerly-raw research-path completions honor the breaker', () => {
  test('generateQueries falls back to the raw question with ZERO completion traffic while throttled', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await guardedChatCompletion({ messages: [] }).catch(() => undefined) // open the breaker
    const calls = state.createCalls

    const out = await generateQueries('What changed in the EU AI Act this month?', {
      search: true,
      risk: 'high',
      recencyDays: 30,
      reason: 'test',
    })
    expect(out.usedFallback).toBe(true)
    expect(out.queries.length).toBeGreaterThan(0)
    expect(state.createCalls).toBe(calls) // the breaker absorbed the query-gen call
  })

  test('semanticFreshnessCheck degrades to null (deterministic decision) with ZERO traffic while throttled', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await guardedChatCompletion({ messages: [] }).catch(() => undefined)
    const calls = state.createCalls

    const out = await semanticFreshnessCheck('Should I book tickets for the match tomorrow?')
    expect(out).toBeNull()
    expect(state.createCalls).toBe(calls)
  })

  test('checkClaims degrades honestly (ran:false) with ZERO traffic while throttled', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await guardedChatCompletion({ messages: [] }).catch(() => undefined)
    const calls = state.createCalls

    const out = await checkClaims({
      answer: 'The CM announced the scheme on 10 November 2026 [1].',
      evidenceBlock: '[1] Example (2026-11-10). The CM announced the scheme.',
    })
    expect(out.ran).toBe(false)
    expect(out.degraded.length).toBeGreaterThan(0)
    expect(out.claims).toHaveLength(0)
    expect(state.createCalls).toBe(calls)
  })

  test('englishQueryVariant drops the variant honestly with ZERO traffic while throttled', async () => {
    state.createImpl = async () => {
      throw chat429()
    }
    await guardedChatCompletion({ messages: [] }).catch(() => undefined)
    const calls = state.createCalls

    const out = await englishQueryVariant('தமிழ்நாட்டின் தலைநகர் எது?')
    expect(out).toBeNull()
    expect(state.createCalls).toBe(calls)
  })

  test('with a healthy gateway the guarded paths still work end-to-end', async () => {
    state.createImpl = async (body: unknown) => {
      const b = body as { messages: Array<{ role: string; content: string }> }
      const last = b.messages[b.messages.length - 1]?.content ?? ''
      if (last.includes('queries')) return { choices: [{ message: { content: '{"queries":["eu ai act update"]}' } }] }
      // The router's user turn is the BARE question.
      if (last.includes('book tickets')) return { choices: [{ message: { content: '{"needsCurrent":true,"reason":"freshness matters for act changes"}' } }] }
      // The claims checker's user turn carries the EVIDENCE/ANSWER block.
      if (last.includes('ANSWER TO VERIFY')) return { choices: [{ message: { content: '{"claims":[{"text":"The CM announced the scheme","changing":true,"verdict":"supported","evidenceIds":[1],"dateConflict":false}]}' } }] }
      return { choices: [{ message: { content: 'Announced in November 2026' } }] }
    }
    const gen = await generateQueries('What changed in the EU AI Act this month?', {
      search: true,
      risk: 'high',
      reason: 'test',
    })
    expect(gen.usedFallback).toBe(false)
    expect(gen.queries).toContain('eu ai act update')

    const routed = await semanticFreshnessCheck('Should I book tickets for the match tomorrow?')
    expect(routed?.needsCurrent).toBe(true)

    const claims = await checkClaims({
      answer: 'The CM announced the scheme on 10 November 2026 [1].',
      evidenceBlock: '[1] Example (2026-11-10). The CM announced the scheme.',
    })
    expect(claims.ran).toBe(true)
    expect(claims.claims[0]?.verdict).toBe('supported')

    const variant = await englishQueryVariant('தமிழ்நாட்டின் தலைநகர் எது?')
    expect(typeof variant === 'string' || variant === null).toBe(true)
  })
})

describe('research (functions class) attempt recording + quota-free probe', () => {
  test('a real search records success evidence the probe can cite', async () => {
    state.invokeImpl = async () => [
      { url: 'https://example.com/a', name: 'A', snippet: 'real', host_name: 'example.com' },
    ]
    await webSearch('attempt evidence query')
    const attempt = lastRealAttempt('research-search')
    expect(attempt?.ok).toBe(true)

    const health = await probeResearchHealth()
    expect(health.healthy).toBe(true)
    expect(health.detail).toContain('succeeded at')
    expect(health.detail).toContain('No search was fired')
    expect(state.invokeCalls).toBe(1) // ONLY the customer search — the probe added none
  })

  test('an observed search 429 opens the breaker; the probe reports rate-limited and fires NO search', async () => {
    state.invokeImpl = async () => {
      throw new Error('Function invoke failed with status 429: {"error":"Too many requests"}')
    }
    await expect(webSearch('throttled query')).rejects.toBeInstanceOf(UpstreamRateLimitError)
    const calls = state.invokeCalls

    const health = await probeResearchHealth()
    expect(health.healthy).toBe(false)
    expect(health.failureCategory).toBe('rate-limited')
    expect(health.httpStatus).toBe(429)
    expect(state.invokeCalls).toBe(calls) // zero probe traffic
  })

  test('the probe never fires a search even with no evidence (reachability + config only)', async () => {
    const health = await probeResearchHealth()
    expect(health.healthy).toBe(true)
    expect(health.detail).toContain('no real research attempt evidence yet')
    expect(state.invokeCalls).toBe(0)
  })

  test('a fresh failed search attempt keeps the research status honest', async () => {
    state.invokeImpl = async () => {
      throw new Error('Function invoke failed with status 503: down')
    }
    await expect(webSearch('failing query')).rejects.toBeInstanceOf(Error)
    // 503 is not rate-limiting; the breaker stays open-free but the attempt
    // record carries the failure. category: backend-error (non-upstream).
    const attempt = lastRealAttempt('research-search')
    expect(attempt?.ok).toBe(false)

    // An UPSTREAM-class failure (timeout) does affect the probe outcome.
    state.invokeImpl = async () => {
      throw new Error('web_search timed out after 20000ms')
    }
    await expect(webSearch('slow query')).rejects.toBeInstanceOf(Error)
    const health = await probeResearchHealth()
    expect(health.healthy).toBe(false)
    expect(health.failureCategory).toBe('timeout')
  })
})
