/**
 * BEAN Intelligence — shared research gateway: configuration.
 *
 * Environment variable NAMES only — secret values never live here. All
 * numeric knobs are clamped so a bad deploy config cannot remove the safety
 * bounds. Agent Reach is OPTIONAL: when its binary is not configured/found
 * the gateway reports `unavailable` honestly and the existing BEAN research
 * pipeline continues unchanged.
 */

import { spawnSync } from 'node:child_process'

/** Env names (documented in .env.example — never secret values). */
export const REACH_ENV = {
  binary: 'BEAN_RESEARCH_AGENT_REACH_BIN',
  disabled: 'BEAN_RESEARCH_REACH_DISABLED',
  disabledChannels: 'BEAN_RESEARCH_REACH_DISABLED_CHANNELS',
  timeoutMs: 'BEAN_RESEARCH_REACH_TIMEOUT_MS',
  laneBudgetMs: 'BEAN_RESEARCH_REACH_LANE_BUDGET_MS',
  maxItems: 'BEAN_RESEARCH_REACH_MAX_ITEMS',
  maxTextChars: 'BEAN_RESEARCH_REACH_MAX_TEXT_CHARS',
  maxStdoutBytes: 'BEAN_RESEARCH_REACH_MAX_STDOUT_BYTES',
  ratePerMin: 'BEAN_RESEARCH_REACH_RATE_PER_MIN',
  concurrency: 'BEAN_RESEARCH_REACH_CONCURRENCY',
  obscuraBinary: 'BEAN_RESEARCH_OBSCURA_BIN',
  obscuraTimeoutMs: 'BEAN_RESEARCH_OBSCURA_TIMEOUT_MS',
} as const

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Per-invocation timeout: default 20 s, clamped 5–60 s. */
export function reachTimeoutMs(): number {
  return clampInt(process.env[REACH_ENV.timeoutMs], 20_000, 5_000, 60_000)
}

/** Whole-lane budget for one research turn: default 12 s, clamped 3–30 s. */
export function reachLaneBudgetMs(): number {
  return clampInt(process.env[REACH_ENV.laneBudgetMs], 12_000, 3_000, 30_000)
}

/** Max items kept per invocation: default 8, clamped 1–20. */
export function reachMaxItems(): number {
  return clampInt(process.env[REACH_ENV.maxItems], 8, 1, 20)
}

/** Max chars kept per item text/excerpt: default 24,000, clamped 200–60,000. */
export function reachMaxTextChars(): number {
  return clampInt(process.env[REACH_ENV.maxTextChars], 24_000, 200, 60_000)
}

/** Hard stdout cap for one child process: default 2 MiB, clamped 64 KiB–8 MiB. */
export function reachMaxStdoutBytes(): number {
  return clampInt(process.env[REACH_ENV.maxStdoutBytes], 2 * 1024 * 1024, 65_536, 8 * 1024 * 1024)
}

/** User-level reach rate limit (actions/min): default 30, clamped 1–120. */
export function reachRatePerMin(): number {
  return clampInt(process.env[REACH_ENV.ratePerMin], 30, 1, 120)
}

/** Process-wide concurrent reach children: default 2, clamped 1–4. */
export function reachConcurrency(): number {
  return clampInt(process.env[REACH_ENV.concurrency], 2, 1, 4)
}

/** Obscura per-navigation timeout: default 25 s, clamped 5–60 s. */
export function obscuraTimeoutMs(): number {
  return clampInt(process.env[REACH_ENV.obscuraTimeoutMs], 25_000, 5_000, 60_000)
}

/** True when the operator explicitly disabled the reach lane. */
export function reachDisabled(): boolean {
  const v = String(process.env[REACH_ENV.disabled] ?? '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/** Operator-disabled channels (comma-separated channel names). */
export function reachDisabledChannels(): Set<string> {
  const raw = String(process.env[REACH_ENV.disabledChannels] ?? '')
  return new Set(
    raw
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0),
  )
}

/** Configured Agent Reach binary (name on PATH or absolute path). */
export function reachBinary(): string {
  const configured = String(process.env[REACH_ENV.binary] ?? '').trim()
  return configured.length > 0 ? configured : 'agent-reach'
}

/** Configured Obscura binary (name on PATH or absolute path). */
export function obscuraBinary(): string {
  const configured = String(process.env[REACH_ENV.obscuraBinary] ?? '').trim()
  return configured.length > 0 ? configured : 'obscura'
}

export interface BinaryProbe {
  available: boolean
  /** Reason is honest and SAFE for client display (no paths, no args). */
  reason: string | null
  version: string | null
}

/**
 * Probe whether a binary exists and runs, via `<bin> --version` with a short
 * wall clock. Never raises. Result is safe to surface to clients (no paths).
 */
export function probeBinaryVersion(bin: string, timeoutMs = 5_000): BinaryProbe {
  try {
    const res = spawnSync(bin, ['--version'], {
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (res.error || res.status !== 0) {
      return { available: false, reason: 'runtime not available', version: null }
    }
    const out = `${res.stdout ?? ''}`.trim()
    const version = out.split(/\s+/).slice(-1)[0]?.slice(0, 32) || null
    return { available: true, reason: null, version }
  } catch {
    return { available: false, reason: 'runtime not available', version: null }
  }
}
