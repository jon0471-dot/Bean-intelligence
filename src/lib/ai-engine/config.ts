/**
 * BEAN Intelligence — engine configuration (env-tunable, server-only).
 *
 * Every knob has a safe default so the engine works with zero configuration;
 * operators can tune behavior per environment without code changes. All
 * numeric values are clamped to sane bounds (a misconfigured value must be
 * able to neither spam providers nor wedge the queue).
 */

import { clampInt } from './clamp'

export interface EngineConfig {
  /** Embedded workers enabled inside the Next.js server process. */
  embeddedWorkers: boolean
  /** Worker queue poll interval (ms). */
  pollMs: number
  /** Claim lease duration (ms) — a worker must heartbeat within this window. */
  leaseMs: number
  /** Worker heartbeat cadence (ms), must be < leaseMs. */
  heartbeatMs: number
  /** Max execution attempts per job (first run + bounded retries). */
  maxAttempts: number
  /** RETRY_WAIT backoff schedule (ms) by attempt number. */
  retryBackoffMs: number[]
  /** Concurrency per product (worker pools). */
  concurrency: Record<string, number>
  /** Per-user cap of simultaneously ACTIVE background jobs per product. */
  perUserActiveLimit: number
  /** Job-event retention (hours) for terminal jobs — the event log is
   *  streaming transport, not permanent storage; results persist in the job. */
  eventRetentionHours: number
}

function envIntOf(name: string, dflt: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return dflt
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return dflt
  return parsed
}

function boolEnv(name: string, dflt: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return dflt
  return v !== '0' && v.toLowerCase() !== 'false'
}

let cached: EngineConfig | null = null

export function engineConfig(): EngineConfig {
  if (cached) return cached
  const leaseMs = clampInt(envIntOf('BEAN_ENGINE_LEASE_MS', 120_000), 15_000, 600_000)
  const heartbeatMs = clampInt(
    envIntOf('BEAN_ENGINE_HEARTBEAT_MS', Math.floor(leaseMs / 4)),
    5_000,
    60_000,
  )
  const maxAttempts = clampInt(envIntOf('BEAN_ENGINE_MAX_ATTEMPTS', 2), 1, 3)
  cached = {
    embeddedWorkers: boolEnv('BEAN_ENGINE_EMBEDDED', true),
    pollMs: clampInt(envIntOf('BEAN_ENGINE_POLL_MS', 1_500), 250, 30_000),
    leaseMs,
    heartbeatMs,
    maxAttempts,
    retryBackoffMs: [15_000, 60_000],
    concurrency: {
      riishe: clampInt(envIntOf('BEAN_ENGINE_CONCURRENCY_RIISHE', 2), 1, 8),
      laxii: clampInt(envIntOf('BEAN_ENGINE_CONCURRENCY_LAXII', 2), 1, 4),
      jazmii: clampInt(envIntOf('BEAN_ENGINE_CONCURRENCY_JAZMII', 2), 1, 4),
      'code-giftz': clampInt(envIntOf('BEAN_ENGINE_CONCURRENCY_GIFTZ', 2), 1, 8),
    },
    perUserActiveLimit: clampInt(envIntOf('BEAN_ENGINE_PER_USER_ACTIVE', 3), 1, 10),
    eventRetentionHours: clampInt(envIntOf('BEAN_ENGINE_EVENT_RETENTION_HOURS', 72), 1, 24 * 30),
  }
  return cached
}

/** Reset the cached config (tests). */
export function resetEngineConfigCache(): void {
  cached = null
}
