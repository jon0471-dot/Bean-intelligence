/**
 * Reach gateway — allowlisted command builder (hermetic, no processes).
 *
 * SECURITY REGRESSION: the ONLY way BEAN may invoke Agent Reach is through
 * buildReachCommand. Unknown channels/actions/params, control characters,
 * oversized values and non-public URLs must be rejected BEFORE any process
 * starts, and the produced argv must contain exactly the allowlisted words.
 */

import { describe, expect, test } from 'bun:test'
import { buildReachCommand, findActionSpec, REACH_CHANNELS } from '../../src/lib/research/reach/allowlist'

describe('reach allowlist inventory', () => {
  test('declares the audited priority channels with bounded actions', () => {
    const names = REACH_CHANNELS.map((c) => c.channel)
    expect(names).toContain('github')
    expect(names).toContain('web')
    expect(names).toContain('youtube')
    expect(names).toContain('bilibili')
    expect(names).toContain('reddit')
    expect(names).toContain('v2ex')
    // Never-allowlisted upstream channels stay out (they are reported disabled).
    expect(names).not.toContain('twitter')
    expect(names).not.toContain('linkedin')
    expect(names).not.toContain('xiaohongshu')
  })

  test('github.read exists and guards its target parameter', () => {
    const read = findActionSpec('github', 'read')
    expect(read).not.toBeNull()
    expect(read!.params.some((p) => p.name === 'target' && p.urlGuard)).toBeTrue()
  })
})

describe('buildReachCommand validation (fail-closed)', () => {
  test('happy path: github search builds argv exactly', () => {
    const built = buildReachCommand('github', 'search', { query: 'yt-dlp', limit: 3 }, 20_000)
    expect(built.ok).toBeTrue()
    if (!built.ok) return
    expect(built.args[0]).toBe('github')
    expect(built.args[1]).toBe('search')
    expect(built.args).toContain('yt-dlp')
    expect(built.args).toContain('--limit')
    expect(built.args).toContain('3')
    expect(built.args[built.args.length - 2]).toBe('--timeout')
    expect(Number(built.args[built.args.length - 1])).toBe(20)
  })

  test('unknown channel / action / param are rejected', () => {
    expect(buildReachCommand('twitter', 'search', { query: 'x' }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'clone', { target: 'a/b' }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'search', { query: 'x', evil: '1' }, 20_000).ok).toBeFalse()
  })

  test('missing required parameter is rejected', () => {
    expect(buildReachCommand('github', 'search', {}, 20_000).ok).toBeFalse()
    expect(buildReachCommand('web', 'read', {}, 20_000).ok).toBeFalse()
  })

  test('control characters and oversized strings are rejected', () => {
    expect(buildReachCommand('github', 'search', { query: 'bad\u0000value' }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'search', { query: 'bad\nrm -rf /' }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'search', { query: 'x'.repeat(401) }, 20_000).ok).toBeFalse()
  })

  test('numeric params are bounded integers', () => {
    expect(buildReachCommand('github', 'search', { query: 'x', limit: 0 }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'search', { query: 'x', limit: 101 }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'search', { query: 'x', limit: 2.5 }, 20_000).ok).toBeFalse()
  })

  test('web.read blocks private and internal URLs before any process starts', () => {
    for (const target of [
      'http://127.0.0.1:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.1.2.3/secret',
      'file:///etc/passwd',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://user:pass@example.com/',
    ]) {
      const built = buildReachCommand('web', 'read', { target }, 20_000)
      expect(built.ok).toBeFalse()
      if (!built.ok) expect(built.kind).toBe('blocked-url')
    }
  })

  test('web.read accepts a public URL and carries it as one argv element', () => {
    const built = buildReachCommand('web', 'read', { target: 'https://nodejs.org/en/about' }, 20_000)
    expect(built.ok).toBeTrue()
    if (!built.ok) return
    // The URL is ONE argv element — never split, never shell-interpolated.
    expect(built.args).toContain('https://nodejs.org/en/about')
  })

  test('github.read accepts owner/repo and github.com URLs, rejects other hosts', () => {
    expect(buildReachCommand('github', 'read', { target: 'yt-dlp/yt-dlp' }, 20_000).ok).toBeTrue()
    expect(buildReachCommand('github', 'read', { target: 'https://github.com/yt-dlp/yt-dlp/issues/1' }, 20_000).ok).toBeTrue()
    expect(buildReachCommand('github', 'read', { target: 'https://evil.com/yt-dlp/yt-dlp' }, 20_000).ok).toBeFalse()
    expect(buildReachCommand('github', 'read', { target: 'http://127.0.0.1/a/b' }, 20_000).ok).toBeFalse()
  })

  test('timeout is clamped into the 5–60 s upstream range', () => {
    const low = buildReachCommand('github', 'search', { query: 'x' }, 1_000)
    const high = buildReachCommand('github', 'search', { query: 'x' }, 600_000)
    if (low.ok && high.ok) {
      expect(Number(low.args[low.args.length - 1])).toBe(5)
      expect(Number(high.args[high.args.length - 1])).toBe(60)
    } else {
      throw new Error('expected both to build')
    }
  })
})
