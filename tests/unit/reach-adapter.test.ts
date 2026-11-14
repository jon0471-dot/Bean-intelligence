/**
 * Reach gateway — adapter subprocess boundary (uses a REAL fake binary, no
 * network). Regression contract (Phase 1 + Phase 6):
 *   - the child receives an argv ARRAY with the allowlisted words (no shell);
 *   - the upstream JSON envelope is validated; contract violations fail honestly;
 *   - upstream error codes map to typed failure kinds (NEED_LOGIN, TIMEOUT...);
 *   - wall-clock timeout kills the child (SIGKILL) and reports `timeout`;
 *   - stdout overflow is killed and reported, never truncated-into-success;
 *   - missing runtime is an honest `not-configured` outcome;
 *   - the child env contains NO application secrets (only PATH/HOME/locale).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReachInvocation, clearReachHealthCacheForTests, probeReachRuntime, pendingReachChildrenForTests } from '../../src/lib/research/reach/adapter'

let dir: string
const REAL_FETCH = globalThis.fetch

const FAKE = `#!/usr/bin/env bash
# Fake agent-reach: records argv, prints a canned envelope per action.
echo "$@" > "${join('@DIR@', 'last-argv.txt')}"
echo "SECRET_SHOULD_NOT_PROPAGATE=\${DATABASE_URL:-unset}" > "${join('@DIR@', 'env-probe.txt')}" || true
case "$1 $2" in
  "github search")
    echo '{"schema_version":1,"ok":true,"channel":"github","action":"search","backend":"github-api","items":[{"title":"yt-dlp/yt-dlp","url":"https://github.com/yt-dlp/yt-dlp","author":"yt-dlp","published_at":"2010-01-01T00:00:00Z","text":"A youtube-dl fork","raw":{"stargazers_count":1}}],"meta":{"elapsed_ms":5,"attempts":[{"backend":"gh","error":{"code":"NEED_SETUP","message":"gh missing"}}]}}'
    ;;
  "github read")
    echo '{"schema_version":1,"ok":false,"channel":"github","action":"read","error":{"code":"NEED_LOGIN","message":"login required"},"meta":{"elapsed_ms":3,"attempts":[]}}'
    ;;
  "web search")
    echo 'not json at all'
    ;;
  "web read")
    echo '{"schema_version":2,"ok":true,"items":[]}'
    ;;
  *)
    if [ "$1" = "sleepy" ]; then sleep 30; echo '{}'; exit 0; fi
    if [ "$1" = "flood" ]; then head -c 4000000 /dev/zero | tr '\\0' 'x'; exit 0; fi
    echo '{"schema_version":1,"ok":true,"items":[]}'
    ;;
esac
`
const SLEEPY = `#!/usr/bin/env bash
sleep 30
echo '{"schema_version":1,"ok":true,"items":[]}'
`
const FLOOD = `#!/usr/bin/env bash
head -c 4000000 /dev/zero | tr '\\0' 'x'
echo '{"schema_version":1,"ok":true,"items":[]}'
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bean-reach-test-'))
  const fake = join(dir, 'agent-reach')
  await writeFile(fake, FAKE.replaceAll('@DIR@', dir))
  await chmod(fake, 0o755)
  const sleepy = join(dir, 'sleepy-reach')
  await writeFile(sleepy, SLEEPY)
  await chmod(sleepy, 0o755)
  const flood = join(dir, 'flood-reach')
  await writeFile(flood, FLOOD)
  await chmod(flood, 0o755)
  process.env.BEAN_RESEARCH_AGENT_REACH_BIN = fake
  clearReachHealthCacheForTests()
})

afterAll(async () => {
  delete process.env.BEAN_RESEARCH_AGENT_REACH_BIN
  clearReachHealthCacheForTests()
  await rm(dir, { recursive: true, force: true })
  globalThis.fetch = REAL_FETCH
})

describe('runReachInvocation (real fake binary)', () => {
  test('happy path: envelope parsed, items normalized, backend + attempts preserved', async () => {
    const out = await runReachInvocation({ channel: 'github', action: 'search', params: { query: 'yt-dlp', limit: 2 } })
    expect(out.ok).toBeTrue()
    expect(out.backend).toBe('github-api')
    expect(out.items).toHaveLength(1)
    expect(out.items[0].title).toBe('yt-dlp/yt-dlp')
    expect(out.items[0].raw?.stargazers_count).toBe(1)
    expect(out.attempts[0]?.backend).toBe('gh')
    // argv was an array of exactly the allowlisted words (no shell string).
    const argv = (await readFile(join(dir, 'last-argv.txt'), 'utf8')).trim().split(' ')
    expect(argv[0]).toBe('github')
    expect(argv[1]).toBe('search')
    expect(argv).toContain('--timeout')
  })

  test('child environment carries no DATABASE_URL (secrets never propagate)', async () => {
    await runReachInvocation({ channel: 'github', action: 'search', params: { query: 'x' } })
    const envProbe = await readFile(join(dir, 'env-probe.txt'), 'utf8')
    expect(envProbe).toContain('unset')
  })

  test('NEED_LOGIN maps to the typed needs-login kind', async () => {
    const out = await runReachInvocation({ channel: 'github', action: 'read', params: { target: 'a/b' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('needs-login')
    expect(out.error?.code).toBe('NEED_LOGIN')
  })

  test('unreadable output is an honest upstream failure (never fabricated success)', async () => {
    const out = await runReachInvocation({ channel: 'web', action: 'search', params: { query: 'x' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('upstream')
    expect(out.items).toHaveLength(0)
  })

  test('unsupported envelope schema version is rejected', async () => {
    const out = await runReachInvocation({ channel: 'web', action: 'read', params: { target: 'https://example.com/' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.message).toContain('envelope version')
  })

  test('non-allowlisted action never spawns', async () => {
    const out = await runReachInvocation({ channel: 'github', action: 'clone', params: { target: 'a/b' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('bad-input')
    expect(out.elapsedMs).toBeLessThan(50)
  })

  test('wall-clock timeout kills the child and reports timeout', async () => {
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'sleepy-reach')
    clearReachHealthCacheForTests()
    const out = await runReachInvocation(
      { channel: 'github', action: 'search', params: { query: 'x' } },
      { timeoutMs: 1_000 },
    )
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('timeout')
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'agent-reach')
    clearReachHealthCacheForTests()
  })

  test('stdout overflow is killed and reported honestly', async () => {
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'flood-reach')
    clearReachHealthCacheForTests()
    const out = await runReachInvocation({ channel: 'github', action: 'search', params: { query: 'x' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.message).toContain('limit')
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'agent-reach')
    clearReachHealthCacheForTests()
  })

  test('missing binary is an honest not-configured outcome (zero fabrication)', async () => {
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'does-not-exist')
    clearReachHealthCacheForTests()
    const out = await runReachInvocation({ channel: 'github', action: 'search', params: { query: 'x' } })
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('not-configured')
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'agent-reach')
    clearReachHealthCacheForTests()
  })

  test('cancellation via AbortSignal kills the child', async () => {
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'sleepy-reach')
    clearReachHealthCacheForTests()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const out = await runReachInvocation(
      { channel: 'github', action: 'search', params: { query: 'x' } },
      { timeoutMs: 10_000, signal: controller.signal },
    )
    expect(out.ok).toBeFalse()
    expect(out.error?.kind).toBe('cancelled')
    process.env.BEAN_RESEARCH_AGENT_REACH_BIN = join(dir, 'agent-reach')
    clearReachHealthCacheForTests()
  })

  test('probeReachRuntime reports availability honestly from --version', async () => {
    const health = await probeReachRuntime()
    expect(health.available).toBeTrue()
    expect(health.reason).toBeNull()
  })

  test('concurrency slots are released after every outcome', async () => {
    await runReachInvocation({ channel: 'github', action: 'search', params: { query: 'a' } })
    await runReachInvocation({ channel: 'github', action: 'read', params: { target: 'a/b' } })
    expect(pendingReachChildrenForTests()).toBe(0)
  })

  test('per-user rate limit honestly stops the lane (typed rate-limited, zero spawns)', async () => {
    // Default limit is 30/min (config). Fire 30 fast invocations, then
    // expect the 31st to be refused WITHOUT spawning a process.
    let ok = 0
    let limited: string | null = null
    for (let i = 0; i < 31; i += 1) {
      const out = await runReachInvocation(
        { channel: 'github', action: 'search', params: { query: `q${i}` } },
        { rateLimitKey: 'research:reach:rate-test-user' },
      )
      if (out.ok) ok += 1
      else if (out.error?.kind === 'rate-limited') {
        limited = out.error.message
        break
      }
    }
    expect(ok).toBe(30)
    expect(limited).toContain('rate limit')
  })
})
