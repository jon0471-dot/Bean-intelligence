/**
 * BEAN Intelligence — RIISHE wrapped-upstream classification tests
 * (2026-11-12 approved minimal live-research reliability fix).
 *
 * Pins the measured defect: the gateway wraps its OWN upstream failure in an
 * OUTER HTTP 500 whose body carries the real inner status (42900 / 42206
 * families). classifyUpstreamError previously matched the FIRST `status NNN`
 * — the outer 500 — so wrapped 429s became generic 'other' and the documented
 * fail-fast/breaker path never engaged. The tests use the REAL error strings
 * captured live (dev.log:68482 / 68506) and pin that every pre-existing
 * classification (auth, billing, timeout, truncation, network, plain 429)
 * is preserved verbatim.
 */
import { describe, test, expect } from 'bun:test'

import { classifyUpstreamError } from '../../src/lib/upstream/gateway'

// The REAL wrapped error captured live (2026-11-12 04:10Z, dev.log:68482).
const REAL_WRAPPED_429 =
  'Failed to invoke remote function: Error: Function invoke failed with status 500: ' +
  '{"result":null,"error":"Search failed: request failed with status 429: ' +
  '{\\"code\\":429,\\"message\\":\\"Primary search failed: ReadTimeout(ReadTimeoutError(' +
  '\\"HTTPSConnectionPool(host=\'google.serper.dev.psmoe.com\', port=443): Read timed out. ' +
  '(read timeout=4)\\"))\\",\\"name\\":\\"UpstreamAPIError\\",\\"status\\":42900}",' +
  '"name":"UpstreamAPIError","status":42900}'

// The REAL authoritative zero-results response captured in the same window.
const REAL_WRAPPED_422 =
  'Failed to invoke remote function: Error: Function invoke failed with status 500: ' +
  '{"result":null,"error":"Search failed: request failed with status 422: ' +
  '{\\"code\\":422,\\"message\\":\\"No search results available for query ' +
  '\\\"new AI model\\\" launch 2026-11-05..2026-11-12\\",\\"name\\":\\"UpstreamAPIError\\",' +
  '\\"status\\":42206}","name":"UpstreamAPIError","status":42206}'

describe('wrapped upstream statuses classify by their INNER signal', () => {
  test('the real wrapped 500/429/42900 search failure is rate_limited', () => {
    const f = classifyUpstreamError(new Error(REAL_WRAPPED_429))
    expect(f.kind).toBe('rate_limited')
    expect(f.status).toBe(429)
  })

  test('the real wrapped 422/42206 zero-results response is no_results (not an outage)', () => {
    const f = classifyUpstreamError(new Error(REAL_WRAPPED_422))
    expect(f.kind).toBe('no_results')
    expect(f.status).toBe(422)
  })

  test('wrapped 429 without the "request failed" wording (bare JSON status field) is rate_limited', () => {
    const f = classifyUpstreamError(
      new Error('Function invoke failed with status 500: {"error":"too busy","status":42900}'),
    )
    expect(f.kind).toBe('rate_limited')
    expect(f.status).toBe(429)
  })

  test('wrapped 429 survives the provider.ts normalization wording (web_search failed: …)', () => {
    const normalized =
      'web_search failed: ' + REAL_WRAPPED_429.slice(0, 300)
    const f = classifyUpstreamError(new Error(normalized))
    expect(f.kind).toBe('rate_limited')
  })

  test('a wrapped upstream ReadTimeout WITHOUT a 429 is an honest timeout', () => {
    const f = classifyUpstreamError(
      new Error(
        'Function invoke failed with status 500: {"error":"Search failed: request failed with status 504: ' +
        '{\\"message\\":\\"Primary search failed: ReadTimeout(ReadTimeoutError(\\\"Read timed out\\\"))\\",\\"status\\":50400}"}',
      ),
    )
    expect(f.kind).toBe('timeout')
    expect(f.status).toBe(504)
  })

  test('a wrapped AUTH failure keeps its auth classification', () => {
    const f = classifyUpstreamError(
      new Error('Function invoke failed with status 500: {"error":"request failed with status 401: invalid key","status":40100}'),
    )
    expect(f.kind).toBe('auth')
    expect(f.status).toBe(401)
  })
})

describe('unwrapped classifications are preserved verbatim (regression)', () => {
  test('plain HTTP statuses', () => {
    expect(classifyUpstreamError(new Error('status 429: Too Many Requests')).kind).toBe('rate_limited')
    expect(classifyUpstreamError(new Error('HTTP 401: unauthorized')).kind).toBe('auth')
    expect(classifyUpstreamError(new Error('status 403: forbidden')).kind).toBe('auth')
    expect(classifyUpstreamError(new Error('HTTP 402: payment required')).kind).toBe('billing')
    expect(classifyUpstreamError(new Error('status 500: boom')).kind).toBe('other')
    expect(classifyUpstreamError(new Error('status 500: boom')).status).toBe(500)
  })

  test('truncation, timeout wording and transport-network classes', () => {
    expect(classifyUpstreamError(new Error('finish_reason: length')).kind).toBe('truncated')
    expect(classifyUpstreamError(new Error('the stream timed out with no status')).kind).toBe('timeout')
    expect(classifyUpstreamError(new Error('fetch failed: ECONNRESET')).kind).toBe('network')
  })

  test('a 422 WITHOUT the zero-results wording does NOT become no_results', () => {
    const f = classifyUpstreamError(new Error('Function invoke failed with status 500: {"error":"request failed with status 422: unprocessable","status":42200}'))
    expect(f.kind).not.toBe('no_results')
  })

  test('no_results requires the explicit zero-results wording', () => {
    const f = classifyUpstreamError(new Error('request failed with status 422: {"code":422,"message":"No search results available for query \\"x\\"","status":42206}'))
    expect(f.kind).toBe('no_results')
  })
})
