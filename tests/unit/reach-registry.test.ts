/**
 * Reach gateway — source capability registry (hermetic: adapter probes are
 * mocked; no processes, no network).
 *
 * Regression contract (Phase 2): status reflects MEASURED reality —
 *   - runtime absent → every channel `unavailable`;
 *   - doctor "ready" + no login → `available`;
 *   - login-declaring channel without a logged-in session → `requires_login`;
 *   - doctor "not_added"/"needs_setup"/"unverified" → `requires_configuration`;
 *   - regressed channel → `unavailable` (its own state only);
 *   - operator-disabled channels → `disabled`;
 *   - channels NOT in the BEAN allowlist → `disabled` (BEAN policy), never
 *     invented as available;
 *   - one channel failing never changes another channel's state.
 */

import { describe, expect, test, mock } from 'bun:test'

const adapterState: {
  runtime: { available: boolean; version: string | null; reason: string | null }
  doctor: { ok: boolean; channels: Array<Record<string, unknown>> }
} = {
  runtime: { available: true, version: '1.6.1', reason: null },
  doctor: { ok: true, channels: [] },
}

mock.module('../../src/lib/research/reach/adapter', () => ({
  probeReachRuntime: async () => ({ ...adapterState.runtime, checkedAt: new Date().toISOString() }),
  fetchReachDoctor: async () => ({
    ok: adapterState.doctor.ok,
    channels: adapterState.doctor.channels,
    checkedAt: new Date().toISOString(),
  }),
  runReachInvocation: async () => ({
    ok: false,
    items: [],
    backend: null,
    elapsedMs: 0,
    attempts: [],
    error: { kind: 'not-configured', code: null, message: 'mocked' },
  }),
  auditReachInvocation: () => {},
  clearReachHealthCacheForTests: () => {},
}))

mock.module('../../src/lib/research/browser/obscura', () => ({
  obscuraHealthCheck: async () => ({
    available: false,
    version: null,
    reason: 'browser rendering runtime is not available',
    checkedAt: new Date().toISOString(),
  }),
  obscuraExtractText: async () => ({ ok: false, kind: 'not-configured', reason: 'mocked', url: '', text: '', injectionFlags: [], elapsedMs: 0 }),
}))

const { getResearchGatewayStatus } = await import('../../src/lib/research/reach/registry')

function doctorEntry(channel: string, status: string, extra: Record<string, unknown> = {}) {
  return { channel, status, level: 'default', regressed: false, problems: [], login: null, ...extra }
}

describe('research gateway source registry (honest states)', () => {
  test('runtime unavailable → every allowlisted channel is unavailable with a reason', async () => {
    adapterState.runtime = { available: false, version: null, reason: 'runtime not available' }
    adapterState.doctor = { ok: false, channels: [] }
    const status = await getResearchGatewayStatus()
    const github = status.sources.find((s) => s.id === 'github')
    expect(github?.state).toBe('unavailable')
    expect(github?.note).toContain('runtime')
    const reddit = status.sources.find((s) => s.id === 'reddit')
    expect(reddit?.state).toBe('unavailable')
  })

  test('ready channels are available; login channels require owner login', async () => {
    adapterState.runtime = { available: true, version: '1.6.1', reason: null }
    adapterState.doctor = {
      ok: true,
      channels: [
        doctorEntry('github', 'ready'),
        doctorEntry('web', 'ready'),
        doctorEntry('youtube', 'ready'),
        doctorEntry('bilibili', 'ready'),
        doctorEntry('v2ex', 'ready'),
        doctorEntry('reddit', 'ready'),
      ],
    }
    const status = await getResearchGatewayStatus()
    expect(status.sources.find((s) => s.id === 'github')?.state).toBe('available')
    // reddit declares a login in the allowlist metadata — ready doctor does
    // NOT imply a logged-in session.
    expect(status.sources.find((s) => s.id === 'reddit')?.state).toBe('requires_login')
  })

  test('a logged-in session flips the login channel to available', async () => {
    adapterState.doctor = {
      ok: true,
      channels: [
        doctorEntry('github', 'ready'),
        doctorEntry('reddit', 'ready', { login: { via: 'browser', loggedIn: true } }),
      ],
    }
    const status = await getResearchGatewayStatus()
    expect(status.sources.find((s) => s.id === 'reddit')?.state).toBe('available')
  })

  test('not_added / needs_setup / unverified map to requires_configuration; regressed to unavailable', async () => {
    adapterState.doctor = {
      ok: true,
      channels: [
        doctorEntry('github', 'ready'),
        doctorEntry('youtube', 'not_added'),
        doctorEntry('bilibili', 'needs_setup', { problems: ['bili-cli not installed'] }),
        doctorEntry('v2ex', 'unverified'),
        doctorEntry('web', 'ready', { regressed: true }),
      ],
    }
    const status = await getResearchGatewayStatus()
    expect(status.sources.find((s) => s.id === 'youtube')?.state).toBe('requires_configuration')
    expect(status.sources.find((s) => s.id === 'bilibili')?.state).toBe('requires_configuration')
    expect(status.sources.find((s) => s.id === 'bilibili')?.note).toContain('bili-cli')
    expect(status.sources.find((s) => s.id === 'v2ex')?.state).toBe('requires_configuration')
    // A regressed channel is honestly unavailable — and ISOLATED: github
    // (ready in the same doctor output) stays available.
    expect(status.sources.find((s) => s.id === 'web')?.state).toBe('unavailable')
    expect(status.sources.find((s) => s.id === 'github')?.state).toBe('available')
  })

  test('upstream channels outside the BEAN allowlist are reported disabled, never available', async () => {
    adapterState.doctor = { ok: true, channels: [doctorEntry('twitter', 'ready')] }
    const status = await getResearchGatewayStatus()
    const twitter = status.sources.find((s) => s.id === 'twitter')
    expect(twitter?.state).toBe('disabled')
    expect(twitter?.actions).toEqual([])
  })

  test('optional Obscura backend reports its own honest state', async () => {
    adapterState.doctor = { ok: true, channels: [doctorEntry('github', 'ready')] }
    const status = await getResearchGatewayStatus()
    const obscura = status.sources.find((s) => s.id === 'obscura')
    expect(obscura?.kind).toBe('browser')
    expect(obscura?.state).toBe('unavailable')
    expect(obscura?.note).toContain('browser rendering runtime')
  })
})
