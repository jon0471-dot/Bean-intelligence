/**
 * BEAN Intelligence — unit tests for the CSRF origin check.
 * Run: bun test tests/unit/origin.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { isAllowedApiMutation, originHost } from '../../src/lib/api/origin'

describe('originHost', () => {
  test('parses host with and without port', () => {
    expect(originHost('https://preview-x.space-z.ai')).toBe('preview-x.space-z.ai')
    expect(originHost('http://localhost:3000')).toBe('localhost:3000')
  })

  test('returns null for null origin and garbage', () => {
    expect(originHost('null')).toBeNull()
    expect(originHost('')).toBeNull()
    expect(originHost('not a url')).toBeNull()
  })
})

describe('isAllowedApiMutation (CSRF origin check)', () => {
  test('safe methods are always allowed', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isAllowedApiMutation(method, 'https://evil.example', 'bean.app')).toBe(true)
      expect(isAllowedApiMutation(method, null, null)).toBe(true)
    }
  })

  test('missing Origin header is allowed (non-browser clients)', () => {
    expect(isAllowedApiMutation('POST', null, 'localhost:3000')).toBe(true)
    expect(isAllowedApiMutation('DELETE', null, null)).toBe(true)
  })

  test('matching origin host is allowed (with and without proxy header)', () => {
    expect(isAllowedApiMutation('POST', 'http://localhost:3000', 'localhost:3000')).toBe(true)
    expect(isAllowedApiMutation('POST', 'https://preview-x.space-z.ai', 'preview-x.space-z.ai')).toBe(true)
    expect(
      isAllowedApiMutation('POST', 'https://preview-x.space-z.ai', 'preview-x.space-z.ai', ),
    ).toBe(true)
  })

  test('cross-site origin is rejected', () => {
    expect(isAllowedApiMutation('POST', 'https://evil.example', 'bean.app')).toBe(false)
    expect(isAllowedApiMutation('DELETE', 'https://bean.app.evil.io', 'bean.app')).toBe(false)
    expect(isAllowedApiMutation('PATCH', 'http://localhost:3001', 'localhost:3000')).toBe(false)
  })

  test('unparsable (null) origin on unsafe method is rejected', () => {
    expect(isAllowedApiMutation('POST', 'null', 'bean.app')).toBe(false)
  })

  test('missing request host with present origin is rejected', () => {
    expect(isAllowedApiMutation('POST', 'https://bean.app', null)).toBe(false)
  })

  test('scheme mismatch on the same host is allowed (host-level check)', () => {
    // Behind TLS-terminating proxies the browser Origin scheme may differ
    // from the forwarded scheme; host equality is the CSRF boundary.
    expect(isAllowedApiMutation('POST', 'https://bean.app', 'bean.app')).toBe(true)
  })
})
