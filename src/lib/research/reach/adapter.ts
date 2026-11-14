/**
 * BEAN Intelligence — shared research gateway: Agent Reach adapter.
 *
 * Server-only subprocess boundary. Invariants:
 *   - argv-array execution only (no shell, no string interpolation);
 *   - fixed allowlisted command surface (see ./allowlist.ts);
 *   - per-call wall-clock timeout + hard stdout cap + child kill on cancel;
 *   - minimal child environment (PATH/HOME/locale) — no app secrets, no
 *     DATABASE_URL, no session material, no provider credentials;
 *   - upstream JSON envelope is zod-validated; unexpected shapes fail as
 *     honest upstream errors (never parsed as success, never fabricated);
 *   - retrieved text is sanitized + injection-scanned before leaving this
 *     module (content is DATA, never instructions);
 *   - every failure is classified and returned, never thrown past the seam.
 *
 * BEAN never invokes `agent-reach login`, `login --import-existing`,
 * `browser profiles/use`, `configure` or any management command: those are
 * owner-controlled, interactive host operations (see SECURITY docs).
 */

import { spawn } from 'node:child_process'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { recordAudit } from '@/lib/observability/metering'
import {
  reachBinary,
  reachConcurrency,
  reachDisabled,
  reachDisabledChannels,
  reachMaxItems,
  reachMaxStdoutBytes,
  reachMaxTextChars,
  reachRatePerMin,
  reachTimeoutMs,
} from './config'
import { buildReachCommand, findActionSpec } from './allowlist'
import { scanRetrievedText } from './injection'
import type { ReachAttempt, ReachFailureKind, ReachInvocation, ReachItem, ReachOutcome } from './types'

// ---------------------------------------------------------------------------
// Envelope validation (upstream contract, schema_version 1)
// ---------------------------------------------------------------------------

const reachItemSchema = z.object({
  title: z.string().nullable(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  published_at: z.string().nullable(),
  text: z.string().nullable(),
  raw: z.record(z.string(), z.unknown()).nullable().optional(),
})

const reachEnvelopeSchema = z.object({
  schema_version: z.number(),
  ok: z.boolean(),
  channel: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  backend: z.string().nullable().optional(),
  items: z.array(z.unknown()).optional(),
  meta: z
    .object({
      elapsed_ms: z.number().optional(),
      attempts: z
        .array(
          z.object({
            backend: z.string().optional(),
            error: z
              .object({ code: z.string().optional(), message: z.string().optional() })
              .nullable()
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      hint: z.string().optional(),
    })
    .nullable()
    .optional(),
})

type ReachEnvelope = z.infer<typeof reachEnvelopeSchema>

function mapErrorCode(code: string | undefined): ReachFailureKind {
  switch (code) {
    case 'NEED_SETUP':
      return 'needs-setup'
    case 'NEED_LOGIN':
      return 'needs-login'
    case 'TIMEOUT':
      return 'timeout'
    case 'RATE_LIMITED':
      return 'rate-limited'
    case 'PLATFORM_BLOCKED':
      return 'platform-blocked'
    case 'NOT_FOUND':
      return 'not-found'
    case 'BAD_INPUT':
      return 'bad-input'
    case 'BUSY':
      return 'busy'
    default:
      return 'upstream'
  }
}

function cleanUpstreamText(raw: string | null | undefined, maxChars: number): string | null {
  if (raw === null || raw === undefined) return null
  const { sanitized } = scanRetrievedText(raw, maxChars)
  return sanitized.length > 0 ? sanitized : null
}

// ---------------------------------------------------------------------------
// Process-wide concurrency bound (all spawn paths go through here)
// ---------------------------------------------------------------------------

let activeChildren = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  const limit = reachConcurrency()
  if (activeChildren < limit) {
    activeChildren += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  activeChildren += 1
}

function releaseSlot(): void {
  activeChildren = Math.max(0, activeChildren - 1)
  const next = waiters.shift()
  if (next) next()
}

export function pendingReachChildrenForTests(): number {
  return activeChildren
}

// ---------------------------------------------------------------------------
// Invocation runner
// ---------------------------------------------------------------------------

export interface RunReachOptions {
  timeoutMs?: number
  maxItems?: number
  /** Abort signal — cancels the child (SIGKILL) when the caller gives up. */
  signal?: AbortSignal
}

function notConfiguredOutcome(reason: string): ReachOutcome {
  return {
    ok: false,
    items: [],
    backend: null,
    elapsedMs: 0,
    attempts: [],
    error: { kind: 'not-configured', code: null, message: reason },
  }
}

/**
 * Run ONE allowlisted Agent Reach invocation. Never throws: every failure
 * mode — including the tool being absent — comes back as a classified,
 * honest outcome. Each call is rate-limited (user key, when provided).
 */
export async function runReachInvocation(
  invocation: ReachInvocation,
  options: RunReachOptions & { rateLimitKey?: string | null } = {},
): Promise<ReachOutcome> {
  const t0 = Date.now()

  if (reachDisabled()) return notConfiguredOutcome('Agent Reach integration is disabled by configuration')
  if (reachDisabledChannels().has(invocation.channel.trim().toLowerCase())) {
    return notConfiguredOutcome(`channel "${invocation.channel.slice(0, 40)}" is disabled by configuration`)
  }
  if (!findActionSpec(invocation.channel, invocation.action)) {
    return {
      ok: false,
      items: [],
      backend: null,
      elapsedMs: Date.now() - t0,
      attempts: [],
      error: { kind: 'bad-input', code: null, message: 'action is not allowlisted' },
    }
  }

  if (options.rateLimitKey) {
    const rl = checkRateLimit(options.rateLimitKey, reachRatePerMin(), 60_000)
    if (!rl.allowed) {
      return {
        ok: false,
        items: [],
        backend: null,
        elapsedMs: Date.now() - t0,
        attempts: [],
        error: { kind: 'rate-limited', code: null, message: 'research retrieval rate limit reached; try again shortly' },
      }
    }
  }

  const timeoutMs = options.timeoutMs ?? reachTimeoutMs()
  const built = buildReachCommand(invocation.channel, invocation.action, invocation.params, timeoutMs)
  if (!built.ok) {
    return {
      ok: false,
      items: [],
      backend: null,
      elapsedMs: Date.now() - t0,
      attempts: [],
      error: { kind: built.kind === 'blocked-url' ? 'bad-input' : built.kind, code: null, message: built.message },
    }
  }

  await acquireSlot()
  try {
    return await spawnReachChild(built.args, {
      // BEAN's own wall-clock kill bound is the CALLER's timeout (the argv
      // --timeout sent upstream stays clamped to the 5–60 s upstream range);
      // a shorter caller budget must actually kill the child sooner.
      timeoutMs,
      maxItems: options.maxItems ?? reachMaxItems(),
      signal: options.signal,
    })
  } finally {
    releaseSlot()
  }
}

function spawnReachChild(
  args: string[],
  opts: { timeoutMs: number; maxItems: number; signal?: AbortSignal },
): Promise<ReachOutcome> {
  const t0 = Date.now()
  return new Promise<ReachOutcome>((resolve) => {
    // Minimal, explicit environment — never spread process.env: the child
    // must not see DATABASE_URL, provider keys, session cookies or any other
    // application secret.
    const childEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
      NODE_ENV: process.env.NODE_ENV,
    }

    let stdout = Buffer.alloc(0)
    let stdoutOverflow = false
    let settled = false
    let killedFor: 'timeout' | 'cancel' | 'overflow' | null = null
    const maxStdout = reachMaxStdoutBytes()

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(reachBinary(), args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      resolve(notConfiguredOutcome('research retrieval runtime is not available'))
      return
    }

    const finish = (outcome: ReachOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }

    const fail = (kind: ReachFailureKind, message: string, code: string | null = null): ReachOutcome => ({
      ok: false,
      items: [],
      backend: null,
      elapsedMs: Date.now() - t0,
      attempts: [],
      error: { kind, code, message },
    })

    const killTimer = setTimeout(() => {
      killedFor = 'timeout'
      killChild()
    }, opts.timeoutMs)

    const onAbort = () => {
      killedFor = 'cancel'
      killChild()
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutOverflow) return
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > maxStdout) {
        stdoutOverflow = true
        killedFor = 'overflow'
        killChild()
      }
    })
    // stderr is diagnostic only — capped and discarded.
    let stderrLen = 0
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrLen = Math.min(65_536, stderrLen + chunk.length)
    })

    child.on('error', () => finish(notConfiguredOutcome('research retrieval runtime is not available')))

    /**
     * Kill the process TREE's pipe holders: SIGKILL alone is not enough when
     * the child spawned its own children (e.g. a script wrapping `sleep`) —
     * the grandchild inherits stdout/stderr and keeps `close` from firing
     * for the full lifetime of the grandchild. Destroying our ends of the
     * pipes makes the close event immediate.
     */
    function killChild(): void {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      try {
        child.stdout?.destroy()
        child.stderr?.destroy()
      } catch {
        /* streams already gone */
      }
    }

    child.on('close', (code) => {
      if (stdoutOverflow) {
        finish(fail('upstream', 'retrieval output exceeded the configured limit'))
        return
      }
      if (opts.signal?.aborted || killedFor === 'cancel') {
        finish(fail('cancelled', 'retrieval was cancelled'))
        return
      }
      if (killedFor === 'timeout') {
        finish(fail('timeout', 'retrieval exceeded its time budget and was stopped'))
        return
      }
      const stdoutText = stdout.toString('utf8')
      const parsedEnvelope = parseEnvelope(stdoutText)
      if (!parsedEnvelope.ok) {
        // Exit 0 without a valid envelope is an upstream contract violation —
        // honest failure, never fabricated success.
        finish(fail(code === 0 ? 'upstream' : 'upstream', parsedEnvelope.message))
        return
      }
      const env = parsedEnvelope.envelope
      const attempts: ReachAttempt[] = (env.meta?.attempts ?? []).map((a) => ({
        backend: String(a.backend ?? '').slice(0, 64),
        error: a.error ? { code: String(a.error.code ?? '').slice(0, 64), message: String(a.error.message ?? '').slice(0, 200) } : null,
      }))
      const maxTextChars = reachMaxTextChars()
      if (!env.ok) {
        const kind = mapErrorCode(env.error?.code)
        finish({
          ok: false,
          items: [],
          backend: null,
          elapsedMs: Date.now() - t0,
          attempts,
          error: {
            kind,
            code: env.error?.code?.slice(0, 64) ?? null,
            message: (env.error?.message ?? 'retrieval failed').slice(0, 200),
          },
        })
        return
      }
      const rawItems = (env.items ?? []).slice(0, opts.maxItems)
      const items: ReachItem[] = []
      for (const it of rawItems) {
        const checked = reachItemSchema.safeParse(it)
        if (!checked.success) continue // malformed item skipped — never fabricated
        const r = checked.data
        items.push({
          title: cleanUpstreamText(r.title, 300),
          url: r.url ? r.url.slice(0, 2048) : null,
          author: r.author ? r.author.slice(0, 200) : null,
          publishedAt: r.published_at ? r.published_at.slice(0, 64) : null,
          text: cleanUpstreamText(r.text, maxTextChars),
          raw: r.raw ?? null,
        })
      }
      finish({
        ok: true,
        items,
        backend: env.backend ? env.backend.slice(0, 64) : null,
        elapsedMs: Date.now() - t0,
        attempts,
        error: null,
      })
    })
  })
}

function parseEnvelope(stdout: string): { ok: true; envelope: ReachEnvelope } | { ok: false; message: string } {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return { ok: false, message: 'retrieval runtime returned no output' }
  // The upstream contract is ONE JSON object on stdout. Tolerate stray
  // non-JSON log lines by taking the LAST line that parses.
  let parsed: unknown = null
  const lines = trimmed.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      parsed = JSON.parse(line)
      break
    } catch {
      /* try the next line up */
    }
  }
  if (parsed === null) return { ok: false, message: 'retrieval runtime returned an unreadable response' }
  const checked = reachEnvelopeSchema.safeParse(parsed)
  if (!checked.success) return { ok: false, message: 'retrieval runtime returned an unexpected response shape' }
  if (checked.data.schema_version !== 1) return { ok: false, message: 'retrieval runtime envelope version is not supported' }
  return { ok: true, envelope: checked.data }
}

// ---------------------------------------------------------------------------
// Runtime health (version probe + doctor inventory, cached)
// ---------------------------------------------------------------------------

export interface ReachRuntimeHealth {
  available: boolean
  version: string | null
  /** Honest reason when unavailable — safe for client display. */
  reason: string | null
  checkedAt: string
}

export interface ReachDoctorChannel {
  channel: string
  status: string
  level: string
  regressed: boolean
  problems: string[]
  login: { via: string; loggedIn: boolean | null } | null
}

export interface ReachDoctorReport {
  ok: boolean
  channels: ReachDoctorChannel[]
  checkedAt: string
}

const HEALTH_CACHE_TTL_MS = 60_000
let runtimeHealthCache: { value: ReachRuntimeHealth; at: number } | null = null
let doctorCache: { value: ReachDoctorReport; at: number } | null = null

function fromCache<T>(cache: { value: T; at: number } | null): T | null {
  if (cache && Date.now() - cache.at < HEALTH_CACHE_TTL_MS) return cache.value
  return null
}

/** Fast availability probe (`<bin> --version`), cached 60 s. */
export async function probeReachRuntime(): Promise<ReachRuntimeHealth> {
  const cached = fromCache(runtimeHealthCache)
  if (cached) return cached
  const { probeBinaryVersion } = await import('./config')
  const probe = probeBinaryVersion(reachBinary())
  const value: ReachRuntimeHealth = {
    available: probe.available,
    version: probe.version,
    reason: probe.available ? null : probe.reason,
    checkedAt: new Date().toISOString(),
  }
  runtimeHealthCache = { value, at: Date.now() }
  return value
}

/** Quota-free channel inventory from `agent-reach doctor` (no network), cached 60 s. */
export async function fetchReachDoctor(timeoutMs = 15_000): Promise<ReachDoctorReport> {
  const cached = fromCache(doctorCache)
  if (cached) return cached
  const runtime = await probeReachRuntime()
  if (!runtime.available) {
    const value: ReachDoctorReport = { ok: false, channels: [], checkedAt: new Date().toISOString() }
    doctorCache = { value, at: Date.now() }
    return value
  }
  const outcome = await new Promise<ReachDoctorReport>((resolve) => {
    let stdout = Buffer.alloc(0)
    let settled = false
    const finish = (report: ReachDoctorReport) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(report)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      try {
        child.stdout?.destroy()
        child.stderr?.destroy()
      } catch {
        /* streams already gone */
      }
    }, timeoutMs)
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(reachBinary(), ['doctor'], {
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME ?? '/tmp',
          LANG: process.env.LANG ?? 'C.UTF-8',
          LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
          NODE_ENV: process.env.NODE_ENV,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      finish({ ok: false, channels: [], checkedAt: new Date().toISOString() })
      return
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk])
    })
    child.on('error', () => finish({ ok: false, channels: [], checkedAt: new Date().toISOString() }))
    child.on('close', () => {
      const parsed = parseEnvelope(stdout.toString('utf8'))
      if (!parsed.ok || !parsed.envelope.ok) {
        finish({ ok: false, channels: [], checkedAt: new Date().toISOString() })
        return
      }
      const result = (parsed.envelope as { result?: unknown }).result as
        | { channels?: Array<Record<string, unknown>> }
        | undefined
      const channels: ReachDoctorChannel[] = (result?.channels ?? []).slice(0, 32).map((c) => ({
        channel: String(c.channel ?? '').slice(0, 40),
        status: String(c.status ?? '').slice(0, 32),
        level: String(c.level ?? '').slice(0, 16),
        regressed: c.regressed === true,
        problems: Array.isArray(c.problems) ? c.problems.slice(0, 4).map((p) => String(p).slice(0, 120)) : [],
        login:
          c.login && typeof c.login === 'object'
            ? {
                via: String((c.login as Record<string, unknown>).via ?? '').slice(0, 16),
                loggedIn:
                  typeof (c.login as Record<string, unknown>).logged_in === 'boolean'
                    ? ((c.login as Record<string, unknown>).logged_in as boolean)
                    : null,
              }
            : null,
      }))
      finish({ ok: true, channels, checkedAt: new Date().toISOString() })
    })
  })
  doctorCache = { value: outcome, at: Date.now() }
  return outcome
}

export function clearReachHealthCacheForTests(): void {
  runtimeHealthCache = null
  doctorCache = null
}

/** Audit helper — one bounded audit row per reach invocation outcome. */
export function auditReachInvocation(
  actorId: string | null,
  invocation: ReachInvocation,
  outcome: ReachOutcome,
): void {
  try {
    void recordAudit({
      actorId,
      action: 'research.reach',
      target: `${invocation.channel}.${invocation.action}`,
      meta: {
        ok: outcome.ok,
        backend: outcome.backend,
        kind: outcome.error?.kind ?? null,
        elapsedMs: outcome.elapsedMs,
        items: outcome.items.length,
      },
    })
  } catch {
    // Audit must never break retrieval; logging gaps are acceptable.
  }
}
