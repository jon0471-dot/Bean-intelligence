/**
 * BEAN Intelligence — local llama.cpp GGUF chat adapter (SERVER ONLY).
 *
 * Free-first policy, RIISHE local lane: a `llama-server` (llama.cpp) started
 * by the operator on BEAN's own hardware serves an OpenAI-compatible
 * /v1/chat/completions endpoint. This adapter routes RIISHE (and CODE GIFTZ
 * coding, when the model is coding-capable) to it with:
 *  - REAL capability verification (health = tiny completion, never assumed);
 *  - its own breaker class ('chat-llamacpp') — a wedged local server never
 *    poisons the hosted gateway's breaker state;
 *  - honest dormancy: with no server configured, nothing is ever requested.
 *
 * Activation requirements (all three, documented in docs/ai/WORKER-OPERATIONS.md):
 *  1. A running llama-server with a GGUF model (llama.cpp releases or source).
 *  2. BEAN_LLAMACPP_BASE_URL (default http://127.0.0.1:8081/v1).
 *  3. BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1 — the SSRF guard rejects
 *     loopback endpoints otherwise (this is a deliberate operator opt-in).
 *
 * LANE MANAGER (docs/ai/LOCAL-MODEL-LANES.md): a configured loopback lane
 * whose server is not yet answering is started on demand — a running server
 * is ADOPTED, otherwise llama-server is spawned as a DETACHED child, RAM-gated
 * through detectHardware() (a spawn that would push the host toward OOM is
 * refused with the measured reason), bounded to 3 spawns/hour/lane, with a
 * 20 s start deadline. Non-loopback lanes (operator LAN GPU hosts) are never
 * spawned — they are operator-managed infrastructure. A refused/failed start
 * never blocks the request: the connection failure surfaces through the
 * normal honest failure path and the router's fallback chain moves on.
 *
 * No Ollama — llama.cpp only, per policy.
 */

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  classifyUpstreamError,
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  upstreamCoolingDown,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import { sseDeltas } from '@/lib/adapters/hosted-llm'
import { estimateTokens } from '@/lib/api/validate'
import { detectHardware } from '@/lib/ai-engine/gpu'
import { localProviderEndpointsAllowed } from '@/lib/security/url-guard'
import { logger } from '@/lib/observability/logger'
import type {
  ChatRequest,
  ChatResult,
  CodeTaskRequest,
  CodeTaskResult,
  HealthReport,
  TaskAdapter,
} from '@/lib/adapters/types'

export const LLAMACPP_BACKEND_ID = 'bean-chat-local-llamacpp'
const BREAKER_CLASS = 'chat-llamacpp'

/**
 * Local timeout floor (measured, docs/ai/LOCAL-MODEL-LANES.md): cold prompt
 * processing of a ~2.5k-token grounded turn takes ~60-120 s on 2 cores — the
 * inherited hosted 90 s budget kills the FIRST turn of every cold lane.
 * Real turns never wait less than this; health probes keep their short budget.
 */
export const LLAMACPP_LOCAL_TIMEOUT_FLOOR_MS = 180_000

/** Measured lane defaults (docs/ai/LOCAL-MODEL-LANES.md, 2026-11-08 host). */
const LANE_DEFAULTS = {
  chatModelPath: '/home/z/bean-models/Qwen3-1.7B-Q4_K_M.gguf',
  codeModelPath: '/home/z/bean-models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
  ctxSize: 8192, // measured: grounded turns are ~4.4k tokens (intel live acceptance 2026-11-08)
  chatMinFreeRamMb: 1900,
  codeMinFreeRamMb: 800,
  chatPort: 8081,
  codePort: 8082,
}

/** One local inference lane (RIISHE chat / CODE GIFTZ code). */
export interface LaneConfig {
  laneId: 'riishe-chat' | 'giftz-code'
  /** TCP port parsed from the lane base URL (fallback: measured default). */
  port: number
  /** Verbatim configured base URL (env value as given). */
  baseUrl: string
  /** GGUF weights path — OUTSIDE the repo (Turbopack trace limit, measured). */
  modelPath: string
  /** llama.cpp context size for the lane. */
  ctxSize: number
  /** Spawn gate: refuse to start the lane below this MemAvailable. */
  minFreeRamMb: number
  /** Optional operator overrides for the lane manager (spawn path/logs). */
  bin: string | null
  logDir: string | null
}

function lanePort(baseUrl: string, fallback: number): number {
  try {
    const p = new URL(baseUrl).port
    return p ? Number(p) : fallback
  } catch {
    return fallback
  }
}

/**
 * Resolve BOTH local lanes from env — pure configuration, no I/O, no spawns.
 * A lane is null unless the SSRF opt-in AND its base URL are both present
 * (the same two-gate dormancy the adapter itself enforces at request time).
 * The request-time loopback guard (resolveLlamaCred) stays the security
 * boundary; this resolver only mirrors what the operator configured, so a
 * LAN GPU host (10.x/192.168.x) is a valid lane configuration.
 */
export function resolveLaneConfigs(): { riishe: LaneConfig | null; code: LaneConfig | null } {
  // M26 G-9: canonical parse (both documented spellings '1' and 'true')
  const allowLocal = localProviderEndpointsAllowed()
  const chatBase = process.env.BEAN_LLAMACPP_BASE_URL?.trim()
  const codeBase = process.env.BEAN_LLAMACPP_CODE_BASE_URL?.trim()
  const bin = process.env.BEAN_LLAMACPP_BIN?.trim() || null
  const logDir = process.env.BEAN_LLAMACPP_LOG_DIR?.trim() || null
  const riishe = allowLocal && chatBase
    ? {
        laneId: 'riishe-chat' as const,
        port: lanePort(chatBase, LANE_DEFAULTS.chatPort),
        baseUrl: chatBase,
        modelPath: process.env.BEAN_LLAMACPP_MODEL_PATH?.trim() || LANE_DEFAULTS.chatModelPath,
        ctxSize: Number(process.env.BEAN_LLAMACPP_CTX_SIZE || LANE_DEFAULTS.ctxSize),
        minFreeRamMb: Number(process.env.BEAN_LLAMACPP_MIN_FREE_RAM_MB || LANE_DEFAULTS.chatMinFreeRamMb),
        bin,
        logDir,
      }
    : null
  const code = allowLocal && codeBase
    ? {
        laneId: 'giftz-code' as const,
        port: lanePort(codeBase, LANE_DEFAULTS.codePort),
        baseUrl: codeBase,
        modelPath: process.env.BEAN_LLAMACPP_CODE_MODEL_PATH?.trim() || LANE_DEFAULTS.codeModelPath,
        ctxSize: Number(process.env.BEAN_LLAMACPP_CODE_CTX_SIZE || LANE_DEFAULTS.ctxSize),
        minFreeRamMb: Number(process.env.BEAN_LLAMACPP_CODE_MIN_FREE_RAM_MB || LANE_DEFAULTS.codeMinFreeRamMb),
        bin,
        logDir,
      }
    : null
  return { riishe, code }
}

/**
 * Model-specific chat-completion body extras. Qwen3 family thinks by default;
 * its thinking tokens burn the local lane's small context and slow every
 * turn — the hosted lane disables it the same way. Everything else: no
 * template kwargs (never send a server can reject).
 */
export function chatBodyExtrasFor(model: string): Record<string, unknown> {
  if (/qwen3/i.test(model)) return { chat_template_kwargs: { enable_thinking: false } }
  return {}
}

/** Which local lane a request uses (chat = RIISHE, code = CODE GIFTZ). */
type LaneKind = 'chat' | 'code'

/**
 * Resolve the base URL for a lane after the SAME gating as before: the SSRF
 * opt-in must be present and the URL must be loopback/private (enforced in
 * resolveLlamaCred). Backward compatible: with no BEAN_LLAMACPP_CODE_BASE_URL
 * configured, coding tasks ride the chat lane exactly as they always have.
 */
export function resolveLaneEndpoint(kind: LaneKind): string | null {
  // M26 G-9: canonical parse (both documented spellings '1' and 'true')
  const allowLocal = localProviderEndpointsAllowed()
  const chatBase = process.env.BEAN_LLAMACPP_BASE_URL?.trim()
  const codeBase = process.env.BEAN_LLAMACPP_CODE_BASE_URL?.trim()
  if (!allowLocal) return null
  if (kind === 'code' && codeBase && /^https?:\/\//.test(codeBase)) return codeBase
  return chatBase && /^https?:\/\//.test(chatBase) ? chatBase : null
}

interface LlamaCred {
  baseUrl: string
  apiKey: string | null
  model: string | null
}

/** Registry-time presence check (env names only, values never read). */
export function isLlamaCppConfigured(): boolean {
  // The registry descriptor is the RIISHE chat lane; coding rides the same
  // credential gates (its own base URL when configured, chat URL otherwise).
  return resolveLlamaCred('chat') !== null || resolveLlamaCred('code') !== null
}

/** Resolve the local server coordinates from env; null when not configured. */
function resolveLlamaCred(kind: LaneKind): LlamaCred | null {
  const base = resolveLaneEndpoint(kind)
  if (!base) return null
  // Loopback/private enforcement: this adapter is FOR local inference.
  const host = new URL(base).hostname
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host) || host.startsWith('192.168.') || host.startsWith('10.')
  if (!isLocal) return null
  return {
    baseUrl: base.replace(/\/+$/, ''),
    apiKey: process.env.BEAN_LLAMACPP_API_KEY?.trim() || null,
    model: kind === 'code' ? process.env.BEAN_LLAMACPP_CODE_MODEL?.trim() || null : process.env.BEAN_LLAMACPP_MODEL?.trim() || null,
  }
}

/* ------------------------------------------------------------------ */
/* Lane manager (docs/ai/LOCAL-MODEL-LANES.md)                         */
/* ------------------------------------------------------------------ */

const LANE_PROBE_TTL_MS = 60_000
const LANE_MAX_SPAWNS_PER_HOUR = 3
const LANE_START_DEADLINE_MS = 20_000
const LANE_POLL_INTERVAL_MS = 500

interface LaneManagerState {
  probe?: { at: number; up: boolean }
  spawns: number[]
  /** Shared in-flight ensure (duplicate-spawn mutex, M26 LANE-1). */
  inflight?: Promise<LaneEnsureResult>
}

const laneStore = globalThis as unknown as Record<string, unknown>
const LANE_STORE_KEY = '__bean_llamacpp_lanes__'

function laneState(laneId: string): LaneManagerState {
  if (!laneStore[LANE_STORE_KEY]) laneStore[LANE_STORE_KEY] = new Map<string, LaneManagerState>()
  const map = laneStore[LANE_STORE_KEY] as Map<string, LaneManagerState>
  if (!map.has(laneId)) map.set(laneId, { spawns: [] })
  return map.get(laneId)!
}

/** Test isolation: clear the per-process lane state (probe cache, spawn ledger, mutex, RAM reservations). */
export function resetLaneManagerForTests(): void {
  (laneStore as Record<string, unknown>)[LANE_STORE_KEY] = undefined;
  (laneStore as Record<string, unknown>)[LANE_RAM_KEY] = undefined
}

/* ------------------------------------------------------------------ */
/* Cross-lane spawn-RAM reservation (M26 LANE-2)                       */
/*                                                                     */
/* The per-lane RAM gate reads a 60s-cached hardware report, so two    */
/* lanes spawning concurrently would each admit themselves against the */
/* same (stale) measurement and jointly overshoot toward OOM. While a  */
/* lane's spawn is in flight its full minFreeRamMb requirement is      */
/* RESERVED here (the same pattern as gpu.ts VRAM reservations) and    */
/* the admission gate sees MemAvailable MINUS all pending reservations */
/* — a conservative admission policy measured against the real OS      */
/* value, never an invented VRAM/RAM guarantee.                        */
/* ------------------------------------------------------------------ */

const LANE_RAM_KEY = '__bean_llamacpp_lane_ram__'

interface LaneRamReservation {
  laneId: string
  ramMb: number
  reservedAt: number
}

function laneRamMap(): Map<string, LaneRamReservation> {
  const g = laneStore as Record<string, unknown>
  if (!g[LANE_RAM_KEY]) g[LANE_RAM_KEY] = new Map<string, LaneRamReservation>()
  return g[LANE_RAM_KEY] as Map<string, LaneRamReservation>
}

/** Total RAM currently reserved by in-flight lane spawns across ALL lanes. */
export function pendingLaneSpawnRamMb(): number {
  let total = 0
  for (const r of laneRamMap().values()) total += r.ramMb
  return total
}

/** Reserve the lane's admission RAM for the duration of its spawn attempt. */
function reserveLaneSpawnRam(laneId: string, ramMb: number): void {
  laneRamMap().set(laneId, { laneId, ramMb, reservedAt: Date.now() })
}

function releaseLaneSpawnRam(laneId: string): void {
  laneRamMap().delete(laneId)
}

/** Reap reservations orphaned by a crashed ensure (safety net, 5-min cap). */
function reapLaneSpawnRam(maxAgeMs = 5 * 60_000): void {
  const now = Date.now()
  for (const [k, r] of laneRamMap()) {
    if (now - r.reservedAt > maxAgeMs) laneRamMap().delete(k)
  }
}

function recentSpawnCount(s: LaneManagerState, now: number): number {
  s.spawns = s.spawns.filter((t) => now - t < 3_600_000)
  return s.spawns.length
}

/** Probe whether a llama-server answers on the lane (short budget, never throws). */
async function probeLane(lane: LaneConfig): Promise<boolean> {
  try {
    const res = await fetch(`${lane.baseUrl}/models`, { signal: AbortSignal.timeout(2_000) })
    return res.ok
  } catch {
    return false
  }
}

export interface LaneStartPlan {
  action: 'adopt' | 'spawn' | 'skip' | 'refuse'
  reason: string
}

/**
 * PURE lane-start decision (documented contract, docs/ai/LOCAL-MODEL-LANES.md):
 * adopt an answering server; never spawn non-loopback lanes; rate-bound
 * spawns to 3/hour/lane; require the weights on disk; refuse any spawn that
 * would push the host toward OOM (measured MemAvailable via detectHardware).
 */
export function planLaneStart(
  lane: LaneConfig,
  facts: {
    serverAnswering: boolean
    spawnsLastHour: number
    modelFileExists: boolean
    freeRamMb: number
    loopback: boolean
  },
): LaneStartPlan {
  if (facts.serverAnswering) {
    return { action: 'adopt', reason: `llama-server already answering at ${lane.baseUrl}` }
  }
  if (!facts.loopback) {
    return { action: 'skip', reason: `non-loopback lane ${lane.baseUrl} is operator-managed; BEAN never spawns remote inference` }
  }
  if (facts.spawnsLastHour >= LANE_MAX_SPAWNS_PER_HOUR) {
    return { action: 'refuse', reason: `spawn bound reached: ${LANE_MAX_SPAWNS_PER_HOUR} starts/hour for lane ${lane.laneId} (crash-loop protection)` }
  }
  if (!facts.modelFileExists) {
    return { action: 'refuse', reason: `GGUF weights not found at ${lane.modelPath} (weights live OUTSIDE the repo; set BEAN_LLAMACPP_MODEL_PATH / BEAN_LLAMACPP_CODE_MODEL_PATH)` }
  }
  if (facts.freeRamMb < lane.minFreeRamMb) {
    return {
      action: 'refuse',
      reason: `lane ${lane.laneId} needs >= ${lane.minFreeRamMb} MB available RAM to start without risking OOM; measured ${facts.freeRamMb} MB`,
    }
  }
  return { action: 'spawn', reason: `lane ${lane.laneId} is down and every gate passed` }
}

export interface LaneEnsureResult {
  up: boolean
  adopted: boolean
  spawned: boolean
  detail: string
}

/**
 * Injectable dependencies for the ensure orchestration (tests inject fakes;
 * production resolves the real probe/hardware/fs/spawn). The DECISION stays
 * the pure planLaneStart contract — only the I/O seams are injectable.
 */
interface LaneEnsureDeps {
  probe: (lane: LaneConfig) => Promise<boolean>
  hardware: () => Promise<{ freeRamMb: number }>
  fileExists: (path: string) => boolean
  spawn: (lane: LaneConfig) => Promise<{ started: boolean; pid: number | null }>
}

const defaultLaneDeps: LaneEnsureDeps = {
  probe: probeLane,
  hardware: async () => await detectHardware(),
  fileExists: (p) => fs.existsSync(p),
  spawn: spawnLaneServer,
}

/**
 * Ensure the lane's server is running: adopt it, or spawn one through the
 * gated decision above. NEVER throws and NEVER blocks the caller's request
 * on refusal — the caller proceeds and the connection failure (if the lane
 * really is down) surfaces through the normal honest failure path.
 *
 * M26 reliability contract:
 *  - Duplicate-spawn mutex: concurrent ensures for the SAME lane share one
 *    in-flight attempt (they can never double-spawn one port);
 *  - Cross-lane RAM admission: MemAvailable minus every pending lane spawn
 *    reservation feeds the same documented RAM gate (conservative admission,
 *    real OS measurement);
 *  - A spawn that never opens its port inside the deadline is cleaned up:
 *    the just-spawned (never-answered) child is terminated — our own child
 *    only; operator-managed processes are never touched.
 */
export async function ensureLaneServer(lane: LaneConfig): Promise<LaneEnsureResult> {
  return ensureLaneServerWithDeps(lane, defaultLaneDeps)
}

export async function ensureLaneServerWithDeps(
  lane: LaneConfig,
  deps: LaneEnsureDeps,
): Promise<LaneEnsureResult> {
  const s = laneState(lane.laneId)
  const now = Date.now()
  if (s.probe && now - s.probe.at < LANE_PROBE_TTL_MS && s.probe.up) {
    return { up: true, adopted: true, spawned: false, detail: `lane ${lane.laneId} recently proven up (cached probe)` }
  }
  // Duplicate-spawn mutex (LANE-1): if another ensure for THIS lane is
  // already probing/deciding/spawning, share its result — never fork a
  // second spawn for the same port. The promise removes itself in `finally`.
  if (s.inflight) return s.inflight
  const attempt = (async (): Promise<LaneEnsureResult> => {
    const answering = await deps.probe(lane)
    s.probe = { at: Date.now(), up: answering }
    if (answering) {
      return { up: true, adopted: true, spawned: false, detail: `llama-server answering at ${lane.baseUrl}` }
    }

    let loopback = false
    try {
      loopback = ['127.0.0.1', 'localhost', '::1'].includes(new URL(lane.baseUrl).hostname)
    } catch {
      loopback = false
    }
    const hw = await deps.hardware()
    // LANE-2: the RAM gate sees MemAvailable minus every pending lane-spawn
    // reservation (cross-lane admission). Reservation ledger reaped first so
    // a crashed ensure cannot permanently shrink admission.
    reapLaneSpawnRam()
    const admissibleRamMb = Math.max(0, hw.freeRamMb - pendingLaneSpawnRamMb())
    const plan = planLaneStart(lane, {
      serverAnswering: answering,
      spawnsLastHour: recentSpawnCount(s, Date.now()),
      modelFileExists: deps.fileExists(lane.modelPath),
      freeRamMb: admissibleRamMb,
      loopback,
    })
    if (plan.action !== 'spawn') {
      logger.warn('llamacpp.lane_not_started', { laneId: lane.laneId, action: plan.action, reason: plan.reason })
      return { up: answering, adopted: false, spawned: false, detail: plan.reason }
    }
    // LANE-2: hold this lane's requirement as a reservation for the whole
    // spawn window (weights load + start deadline), released in `finally`.
    reserveLaneSpawnRam(lane.laneId, lane.minFreeRamMb)
    try {
      const outcome = await deps.spawn(lane)
      return {
        up: outcome.started,
        adopted: false,
        spawned: outcome.started,
        detail: outcome.started
          ? `lane ${lane.laneId} started on demand (llama-server detached, port ${lane.port})`
          : `lane ${lane.laneId} spawn did not open its port within ${LANE_START_DEADLINE_MS}ms (the failed child was terminated)`,
      }
    } finally {
      releaseLaneSpawnRam(lane.laneId)
    }
  })()
  s.inflight = attempt
  try {
    return await attempt
  } finally {
    if (s.inflight === attempt) s.inflight = undefined
  }
}

/**
 * Spawn llama-server exactly as measured in docs/ai/LOCAL-MODEL-LANES.md
 * (quantized KV cache, 256 batch, MALLOC_ARENA_MAX=2): a DETACHED child that
 * survives this process, logs bounded to the operator's log dir when given.
 *
 * M26 LANE-3 cleanup: the spawned PID is tracked; if the server never opens
 * its port inside the deadline, the JUST-SPAWNED child is terminated
 * (SIGTERM, escalating to SIGKILL) — it would otherwise keep loading weights
 * into RAM indefinitely. Only this function's own never-answered child is ever
 * killed; an adopted/operator server is never signaled. M26 LANE-4: the
 * parent's log fd is closed once the child owns it (bounded fd leak fix).
 */
async function spawnLaneServer(lane: LaneConfig): Promise<{ started: boolean; pid: number | null }> {
  const s = laneState(lane.laneId)
  const bin = lane.bin || 'llama-server'
  const threads = Math.max(1, os.cpus().length)
  let logFd: number | null = null
  let child: ReturnType<typeof spawn> | null = null
  try {
    let stdio: 'ignore' | Array<number | 'ignore'> = 'ignore'
    if (lane.logDir) {
      fs.mkdirSync(lane.logDir, { recursive: true })
      logFd = fs.openSync(path.join(lane.logDir, `llamacpp-${lane.laneId}.log`), 'a')
      stdio = ['ignore', logFd, logFd]
    }
    child = spawn(
      bin,
      [
        '-m', lane.modelPath,
        '--host', '127.0.0.1',
        '--port', String(lane.port),
        '--ctx-size', String(lane.ctxSize),
        '-b', '256', '-ub', '256',
        '-ctk', 'q8_0', '-ctv', 'q8_0',
        '--threads', String(threads),
      ],
      {
        env: { ...process.env, MALLOC_ARENA_MAX: '2' },
        detached: true,
        stdio,
      },
    )
    child.unref()
    // LANE-4: the child owns the log fds after spawn — close ours.
    if (logFd !== null) {
      try { fs.closeSync(logFd) } catch { /* already closed */ }
      logFd = null
    }
    const pid = typeof child.pid === 'number' ? child.pid : null
    s.spawns.push(Date.now())
    logger.info('llamacpp.lane_spawning', { laneId: lane.laneId, port: lane.port, ctxSize: lane.ctxSize, threads, pid })
    const deadline = Date.now() + LANE_START_DEADLINE_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LANE_POLL_INTERVAL_MS))
      if (await probeLane(lane)) {
        s.probe = { at: Date.now(), up: true }
        logger.info('llamacpp.lane_started', { laneId: lane.laneId, port: lane.port, pid })
        return { started: true, pid }
      }
    }
    // LANE-3: deadline expired without an answering port — terminate OUR
    // never-answered child so it cannot sit loading weights into RAM
    // indefinitely (bounded cleanup of our own spawn, never of an adopted
    // or operator-managed server).
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL')
        }, 2_000).unref?.()
      } catch { /* child already gone */ }
      logger.warn('llamacpp.lane_spawn_abandoned', { laneId: lane.laneId, pid, deadlineMs: LANE_START_DEADLINE_MS })
    }
    logger.warn('llamacpp.lane_start_timeout', { laneId: lane.laneId, deadlineMs: LANE_START_DEADLINE_MS })
    return { started: false, pid }
  } catch (e) {
    logger.warn('llamacpp.spawn_failed', {
      laneId: lane.laneId,
      message: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    })
    return { started: false, pid: null }
  } finally {
    if (logFd !== null) {
      try { fs.closeSync(logFd) } catch { /* already closed */ }
    }
  }
}

/** The lane config a request kind rides on (null = dormant, same gates as cred). */
function laneFor(kind: LaneKind): LaneConfig | null {
  const lanes = resolveLaneConfigs()
  if (kind === 'code' && lanes.code) return lanes.code
  return lanes.riishe
}

function redact(s: string): string {
  return s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
}

async function resolveModel(cred: LlamaCred, timeoutMs: number): Promise<string> {
  if (cred.model) return cred.model
  // Ask the server which models it holds (llama-server /v1/models).
  const res = await fetch(`${cred.baseUrl}/models`, {
    headers: cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {},
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(timeoutMs, 10_000))),
  })
  if (!res.ok) throw new Error(`llama-server /models failed (HTTP ${res.status})`)
  const json = (await res.json()) as { data?: Array<{ id?: string }> }
  const id = json.data?.[0]?.id
  if (!id) throw new Error('llama-server exposes no model; set BEAN_LLAMACPP_MODEL')
  return id
}

async function postChat(cred: LlamaCred, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return await fetch(`${cred.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  })
}

async function execute(req: ChatRequest | CodeTaskRequest, stream: boolean, kind: LaneKind = 'chat'): Promise<Response> {
  const cred = resolveLlamaCred(kind)
  if (!cred) {
    throw new UpstreamRateLimitError(
      BREAKER_CLASS,
      'llama.cpp local server is not configured (requires BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1 and BEAN_LLAMACPP_BASE_URL); no request was made',
      false,
    )
  }
  if (upstreamCoolingDown(BREAKER_CLASS)) {
    noteUpstreamSkip(BREAKER_CLASS)
    throw new UpstreamRateLimitError(
      BREAKER_CLASS,
      'local llama.cpp endpoint not attempted: its breaker class is cooling down (repeated failures observed)',
      false,
    )
  }
  // Lane manager: adopt the configured lane's server or start one on demand
  // (documented auto-start). A refused/failed start never blocks the request
  // — the real connection attempt below reports the truth.
  const lane = laneFor(kind)
  if (lane) await ensureLaneServer(lane)
  const model = await resolveModel(cred, req.timeoutMs)
  const body = {
    model,
    messages: req.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content.slice(0, req.maxPromptChars),
    })),
    stream,
    max_tokens: 4096,
    // Qwen3 thinking disabled on the local lane (same policy as hosted).
    ...chatBodyExtrasFor(model),
  }
  let res: Response
  try {
    // Local floor: cold prompt processing exceeds the inherited hosted budget
    // (measured) — a real turn never times out below LLAMACPP_LOCAL_TIMEOUT_FLOOR_MS.
    res = await postChat(cred, body, Math.max(req.timeoutMs, LLAMACPP_LOCAL_TIMEOUT_FLOOR_MS))
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`local llama.cpp server timed out after ${Math.max(req.timeoutMs, LLAMACPP_LOCAL_TIMEOUT_FLOOR_MS)}ms`)
    }
    throw e
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    const message = redact(`status ${res.status}: ${errBody.slice(0, 200)}`)
    if (res.status === 429) {
      noteUpstream429(BREAKER_CLASS)
      throw new UpstreamRateLimitError(BREAKER_CLASS, `llama-server rate-limited (HTTP 429): ${message}`)
    }
    const failure = classifyUpstreamError(new Error(message))
    if (failure.kind === 'auth') throw new Error('llama-server rejected the API key configured for BEAN_LLAMACPP_API_KEY.')
    throw new Error(`llama-server chat failed (HTTP ${res.status}): ${message}`)
  }
  noteUpstreamSuccess(BREAKER_CLASS)
  return res
}

export const llamaCppAdapter: TaskAdapter = {
  backendId: LLAMACPP_BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    // Health is the CHAT lane's health (the registry entry it backs); passive
    // by design — a health probe never spawns a model server.
    const cred = resolveLlamaCred('chat')
    if (!cred) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        failureCategory: 'not-configured',
        detail:
          'Not configured: no local llama.cpp server is wired to this deployment. Start llama-server with a GGUF model, then set BEAN_LLAMACPP_BASE_URL and BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1. It consumes nothing until then.',
      }
    }
    try {
      const model = await resolveModel(cred, 10_000)
      const res = await postChat(
        cred,
        { model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8 },
        15_000,
      )
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return {
          healthy: false,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - t0,
          httpStatus: res.status,
          failureCategory: res.status === 429 ? 'rate-limited' : 'backend-error',
          detail: `llama-server probe failed (HTTP ${res.status}): ${redact(errBody.slice(0, 160))}`,
        }
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content ?? ''
      const healthy = content.trim().length > 0
      return {
        healthy,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: null,
        failureCategory: healthy ? null : 'backend-error',
        detail: healthy
          ? `llama.cpp server answered a real completion probe (model: ${model}; chat capability verified, not assumed).`
          : 'llama-server returned an empty completion probe response.',
      }
    } catch (e) {
      const failure = classifyUpstreamError(e)
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: failure.status,
        failureCategory: failure.kind === 'timeout' ? 'timeout' : 'unreachable',
        detail: `llama-server probe failed: ${redact(e instanceof Error ? e.message : String(e))}`,
      }
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const res = await execute(req, false, 'chat')
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('llama-server returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: json.usage?.prompt_tokens ?? (lastUser ? estimateTokens(lastUser.content) : null),
      tokensOutEst: json.usage?.completion_tokens ?? estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },

  async *chatStream(req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const res = await execute(req, true, 'chat')
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content ?? ''
      if (content) yield content
      return
    }
    if (!res.body) throw new Error('llama-server stream closed with no body')
    yield* sseDeltas(res.body as unknown as AsyncIterable<unknown>)
  },

  async codeTask(req: CodeTaskRequest): Promise<CodeTaskResult> {
    const t0 = Date.now()
    const res = await execute(req, false, 'code')
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('llama-server returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },
}
