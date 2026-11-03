/**
 * BEAN Intelligence — RIISHE streaming/output configuration tests.
 * Run: bun test tests/unit/riishe-stream-config.test.ts
 *
 * Pins the configurable settings contract (2026-11-03 reliability work
 * order): every work-order setting is env-tunable with a conservative
 * default, values are clamped to sane ranges, and an unset
 * RIISHE_MAX_OUTPUT_TOKENS means NO cap is sent (provider default applies —
 * never a silent server-side length limit).
 */
import { describe, test, expect, afterEach } from 'bun:test'
import {
  streamConfig,
  _reloadStreamConfigForTests,
} from '../../src/lib/riishe/stream-config'

const ENV_KEYS = [
  'RIISHE_STREAM_IDLE_TIMEOUT_MS',
  'RIISHE_STREAM_MAX_DURATION_MS',
  'RIISHE_UPSTREAM_TIMEOUT_MS',
  'RIISHE_HEARTBEAT_INTERVAL_MS',
  'RIISHE_MAX_OUTPUT_TOKENS',
] as const

const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  _reloadStreamConfigForTests()
})

describe('stream config — conservative defaults with no environment', () => {
  test('defaults reproduce the previously verified live behavior', () => {
    delete process.env.RIISHE_STREAM_IDLE_TIMEOUT_MS
    delete process.env.RIISHE_STREAM_MAX_DURATION_MS
    delete process.env.RIISHE_UPSTREAM_TIMEOUT_MS
    delete process.env.RIISHE_HEARTBEAT_INTERVAL_MS
    delete process.env.RIISHE_MAX_OUTPUT_TOKENS
    const cfg = _reloadStreamConfigForTests()
    expect(cfg.streamIdleTimeoutMs).toBe(120_000)
    expect(cfg.streamMaxDurationMs).toBe(600_000)
    expect(cfg.upstreamTimeoutMs).toBe(90_000)
    expect(cfg.heartbeatIntervalMs).toBe(15_000)
    // No output cap unless explicitly configured.
    expect(cfg.maxOutputTokens).toBeNull()
  })
})

describe('stream config — environment overrides are honored and clamped', () => {
  test('valid values pass through', () => {
    process.env.RIISHE_STREAM_IDLE_TIMEOUT_MS = '45000'
    process.env.RIISHE_STREAM_MAX_DURATION_MS = '900000'
    process.env.RIISHE_UPSTREAM_TIMEOUT_MS = '60000'
    process.env.RIISHE_HEARTBEAT_INTERVAL_MS = '10000'
    process.env.RIISHE_MAX_OUTPUT_TOKENS = '16384'
    const cfg = _reloadStreamConfigForTests()
    expect(cfg.streamIdleTimeoutMs).toBe(45_000)
    expect(cfg.streamMaxDurationMs).toBe(900_000)
    expect(cfg.upstreamTimeoutMs).toBe(60_000)
    expect(cfg.heartbeatIntervalMs).toBe(10_000)
    expect(cfg.maxOutputTokens).toBe(16_384)
  })

  test('insane values are clamped to safe bounds (never a broken stream)', () => {
    process.env.RIISHE_STREAM_IDLE_TIMEOUT_MS = '1'
    process.env.RIISHE_STREAM_MAX_DURATION_MS = '99999999'
    process.env.RIISHE_HEARTBEAT_INTERVAL_MS = '999999'
    const cfg = _reloadStreamConfigForTests()
    expect(cfg.streamIdleTimeoutMs).toBe(5_000)
    expect(cfg.streamMaxDurationMs).toBe(3_600_000)
    // Heartbeat stays below the client's 60s idle watchdog, always.
    expect(cfg.heartbeatIntervalMs).toBe(30_000)
  })

  test('garbage values fall back to defaults', () => {
    process.env.RIISHE_STREAM_IDLE_TIMEOUT_MS = 'not-a-number'
    process.env.RIISHE_UPSTREAM_TIMEOUT_MS = ''
    const cfg = _reloadStreamConfigForTests()
    expect(cfg.streamIdleTimeoutMs).toBe(120_000)
    expect(cfg.upstreamTimeoutMs).toBe(90_000)
  })

  test('stream total cap can be explicitly disabled with 0', () => {
    process.env.RIISHE_STREAM_MAX_DURATION_MS = '0'
    expect(_reloadStreamConfigForTests().streamMaxDurationMs).toBe(0)
  })

  test('a nonsensical RIISHE_MAX_OUTPUT_TOKENS is ignored, not coerced into a cap', () => {
    process.env.RIISHE_MAX_OUTPUT_TOKENS = '-5'
    expect(_reloadStreamConfigForTests().maxOutputTokens).toBeNull()
    process.env.RIISHE_MAX_OUTPUT_TOKENS = 'abc'
    expect(_reloadStreamConfigForTests().maxOutputTokens).toBeNull()
    // Below the sane floor (256): ignored rather than turned into a tiny cap.
    process.env.RIISHE_MAX_OUTPUT_TOKENS = '10'
    expect(_reloadStreamConfigForTests().maxOutputTokens).toBeNull()
  })
})

describe('stream config — heartbeat can never outrun the client watchdog', () => {
  test('max configured heartbeat (30s) stays under the 60s client idle watchdog', () => {
    process.env.RIISHE_HEARTBEAT_INTERVAL_MS = '30000'
    const cfg = _reloadStreamConfigForTests()
    expect(cfg.heartbeatIntervalMs).toBeLessThan(60_000)
  })
})
