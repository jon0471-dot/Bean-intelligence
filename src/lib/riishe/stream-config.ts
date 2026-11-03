/**
 * BEAN Intelligence — RIISHE streaming & output configuration.
 *
 * SINGLE source for the tunable streaming/timeout/output settings (2026-11-03
 * reliability work order). Every value is environment-configurable with a
 * CONSERVATIVE default that matches the behavior already verified live on the
 * hosting platform — configuring nothing reproduces the proven behavior.
 *
 *   RIISHE_STREAM_IDLE_TIMEOUT_MS   — upstream stream: max silence between
 *                                     tokens before the guard fires (the
 *                                     "slow response vs dead connection"
 *                                     distinction). Tokens flowing = no limit.
 *   RIISHE_STREAM_MAX_DURATION_MS   — upstream stream: TOTAL wall-clock cap.
 *                                     Resource backstop against a pathological
 *                                     slow-drip stream; deliberately far above
 *                                     any legitimate turn (research + long
 *                                     generation) so it never cuts a healthy
 *                                     answer. 0 disables the cap entirely.
 *   RIISHE_UPSTREAM_TIMEOUT_MS      — non-streaming upstream call cap (JSON
 *                                     path, digests).
 *   RIISHE_HEARTBEAT_INTERVAL_MS    — SSE `: keepalive` comment cadence. Must
 *                                     stay BELOW the client's idle watchdog
 *                                     (60s) so a live connection always shows
 *                                     bytes; clamped accordingly.
 *   RIISHE_MAX_OUTPUT_TOKENS        — provider `max_tokens` passthrough. When
 *                                     unset NOTHING is sent (the provider's
 *                                     own default applies — no silent BEAN
 *                                     cap). When set it must be a sane
 *                                     integer; it is a ceiling handed to the
 *                                     provider, never a server-side truncation.
 *
 * Honesty contract: no setting here hides a failure. Idle/total guards raise
 * LABELED timeout errors; truncation raises the typed UpstreamTruncatedError;
 * the heartbeat is an SSE comment (never content).
 */

export interface RiisheStreamConfig {
  streamIdleTimeoutMs: number
  streamMaxDurationMs: number
  upstreamTimeoutMs: number
  heartbeatIntervalMs: number
  /** null = do not send max_tokens (provider default applies). */
  maxOutputTokens: number | null
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function readConfig(): RiisheStreamConfig {
  const heartbeatIntervalMs = envInt('RIISHE_HEARTBEAT_INTERVAL_MS', 15_000, 5_000, 30_000)
  const maxRaw = process.env.RIISHE_MAX_OUTPUT_TOKENS
  let maxOutputTokens: number | null = null
  if (maxRaw !== undefined && maxRaw.trim() !== '') {
    const parsed = Math.round(Number(maxRaw))
    // A nonsensical value is ignored (provider default applies) rather than
    // turned into a broken request — and never silently "fixed" to a cap.
    if (Number.isFinite(parsed) && parsed >= 256) maxOutputTokens = parsed
  }
  return {
    streamIdleTimeoutMs: envInt('RIISHE_STREAM_IDLE_TIMEOUT_MS', 120_000, 5_000, 600_000),
    // 0 = disabled (explicitly allowed: rely on the idle guard alone).
    streamMaxDurationMs: envInt('RIISHE_STREAM_MAX_DURATION_MS', 600_000, 0, 3_600_000),
    upstreamTimeoutMs: envInt('RIISHE_UPSTREAM_TIMEOUT_MS', 90_000, 5_000, 600_000),
    heartbeatIntervalMs,
    maxOutputTokens,
  }
}

const g = globalThis as unknown as Record<string, unknown>
const STORE_KEY = '__bean_riishe_stream_config__'

function instance(): RiisheStreamConfig {
  if (!g[STORE_KEY]) g[STORE_KEY] = readConfig()
  return g[STORE_KEY] as RiisheStreamConfig
}

/** The process-wide streaming configuration (computed once). */
export function streamConfig(): RiisheStreamConfig {
  return instance()
}

/** Test hook: recompute from the current environment. */
export function _reloadStreamConfigForTests(): RiisheStreamConfig {
  const next = readConfig()
  g[STORE_KEY] = next
  return next
}
