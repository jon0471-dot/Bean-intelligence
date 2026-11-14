/**
 * BEAN Intelligence — shared research gateway: orchestration seam.
 *
 * This is the ONE entry point RIISHE and CODE GIFTZ use for Agent Reach /
 * Obscura retrieval. Responsibilities:
 *   - PLAN: deterministic, channel-relevance-gated invocation planning from
 *     a research message (≤3 invocations per turn; no arbitrary commands);
 *   - EXECUTE: bounded, budgeted, rate-limited, audit-logged execution with
 *     per-channel failure isolation (one failed channel never affects others);
 *   - NORMALIZE: upstream items → pipeline-compatible evidence with honest
 *     provenance (missing fields stay missing — nothing is invented);
 *   - PAGE READS: the addendum fallback chain for JavaScript-rendered pages
 *     — Agent Reach native read → Obscura (only when rendering is actually
 *     needed) → caller's existing BEAN fallback.
 *
 * NOT a model gateway: no inference, no provider selection, no prompts —
 * the BEAN model router is untouched.
 */

import { recordAudit } from '@/lib/observability/metering'
import {
  auditReachInvocation,
  fetchReachDoctor,
  probeReachRuntime,
  runReachInvocation,
} from './adapter'
import { reachLaneBudgetMs, reachTimeoutMs } from './config'
import { scanRetrievedText } from './injection'
import { assertPublicHttpUrlSync } from './url-safety'
import { obscuraExtractText } from '../browser/obscura'
import type {
  ReachEvidence,
  ReachPlanEntry,
  ReachRetrievalOutcome,
} from './types'
import type { ReachDoctorReport, ReachRuntimeHealth } from './adapter'

// ---------------------------------------------------------------------------
// Planning (deterministic — the model never constructs commands)
// ---------------------------------------------------------------------------

const GITHUB_LINK_RE = /(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:issues|pull)\/(\d+))?(?:[/?#\s]|$)/g
const REPO_KEYWORD_RE = /\b(?:github|repo(?:sitory)?|library|package|npm|pip|crate|open[-\s]?source|framework|sdk)\b/i
const GITHUB_BARE_REPO_RE = /\b([\w.-]{2,40})\/([\w.-]{2,60})\b/

const YOUTUBE_RE = /\b(?:youtube\.com|youtu\.be|youtube)\b/i
/** Question-like message gate for the generic web-search entry. */
const QUESTIONISH_RE = /\?|^(?:what|who|whom|when|where|why|how|which|is|are|was|were|does|do|did|can|could|should|will|would|find|search|compare|check|look\s?up|latest|current|research)\b|\b(?:vs\.?|versus|compared?|documentation|docs|release|version|price|news)\b/i
const REDDIT_RE = /\b(?:reddit\.com|reddit)\b/i
const BILIBILI_RE = /\b(?:bilibili\.com|b23\.tv|bilibili)\b/i
const V2EX_LINK_RE = /https?:\/\/(?:www\.)?v2ex\.com\/t\/(\d+)/i

/** Max reach invocations per research turn (hard bound). */
export const MAX_REACH_INVOCATIONS_PER_TURN = 3

function clipQuery(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 200)
}

/**
 * Deterministically plan which Agent Reach invocations are useful for this
 * message. Pure — no I/O. The plan is later filtered by real availability.
 */
export function planReachInvocations(message: string): ReachPlanEntry[] {
  const plan: ReachPlanEntry[] = []

  // 1. GitHub: repository references get an exact read; repo/library topics
  //    get one bounded repository search.
  const repoLink = [...message.matchAll(GITHUB_LINK_RE)][0]
  if (repoLink) {
    const owner = repoLink[1]
    const repo = repoLink[2].replace(/\.git$/, '')
    const number = repoLink[3]
    const target = number ? `${owner}/${repo}/issues/${number}` : `${owner}/${repo}`
    plan.push({ channel: 'github', action: 'read', params: { target }, reason: number ? 'linked GitHub issue/PR' : 'linked GitHub repository' })
  } else if (REPO_KEYWORD_RE.test(message)) {
    const bare = GITHUB_BARE_REPO_RE.exec(message)
    if (bare && !/\s/.test(`${bare[1]}/${bare[2]}`)) {
      plan.push({ channel: 'github', action: 'read', params: { target: `${bare[1]}/${bare[2]}` }, reason: 'owner/repo referenced' })
    } else {
      plan.push({ channel: 'github', action: 'search', params: { query: clipQuery(message), limit: 5 }, reason: 'repository/library topic' })
    }
  }

  // 2. Web: one bounded semantic search for the primary query on every
  //    research turn (Exa is engine-diverse relative to the gateway).
  //    GATED to question-like messages: the lane must never plan retrieval
  //    for greetings or chat filler even if a caller bypasses the policy.
  if (QUESTIONISH_RE.test(message)) {
    plan.push({ channel: 'web', action: 'search', params: { query: clipQuery(message), limit: 5 }, reason: 'primary query' })
  }

  // 3. Platform-specific: only when the message actually references them.
  if (YOUTUBE_RE.test(message)) {
    plan.push({ channel: 'youtube', action: 'search', params: { query: clipQuery(message), limit: 4 }, reason: 'YouTube referenced' })
  }
  if (REDDIT_RE.test(message)) {
    plan.push({ channel: 'reddit', action: 'search', params: { query: clipQuery(message), limit: 4 }, reason: 'Reddit referenced' })
  }
  if (BILIBILI_RE.test(message)) {
    plan.push({ channel: 'bilibili', action: 'search', params: { query: clipQuery(message), limit: 4 }, reason: 'Bilibili referenced' })
  }
  const v2exTopic = V2EX_LINK_RE.exec(message)
  if (v2exTopic) {
    plan.push({ channel: 'v2ex', action: 'read', params: { target: `https://www.v2ex.com/t/${v2exTopic[1]}` }, reason: 'linked V2EX topic' })
  }

  return plan.slice(0, MAX_REACH_INVOCATIONS_PER_TURN)
}

// ---------------------------------------------------------------------------
// Normalization (null-preserving — nothing invented)
// ---------------------------------------------------------------------------

function hostNameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
  if (d.getFullYear() < 1970 || d.getTime() > Date.now() + 86_400_000) return null
  return d.toISOString()
}

export function normalizeReachItem(
  item: { title: string | null; url: string | null; author: string | null; publishedAt: string | null; text: string | null },
  channel: string,
  backend: string | null,
  rank: number,
): ReachEvidence | null {
  if (!item.url) return null
  // URL sanity: public http(s), no internal hosts (sync literal checks; DNS
  // is re-validated at any actual fetch time by the page-read chain/Obscura).
  const guard = assertPublicHttpUrlSync(item.url)
  if (!guard.ok) return null
  const hostName = hostNameOf(guard.url)
  if (!hostName) return null
  const title = item.title && item.title.trim().length > 0 ? item.title.trim().slice(0, 300) : hostName
  const snippetSource = item.text && item.text.trim().length > 0 ? item.text : null
  const snippet = snippetSource ? snippetSource.replace(/\s+/g, ' ').slice(0, 1_200) : ''
  return {
    url: guard.url,
    title,
    snippet,
    hostName,
    rank,
    date: normalizeDate(item.publishedAt),
    author: item.author ? item.author.slice(0, 200) : null,
    provenance: { channel, backend, engine: 'agent-reach' },
  }
}

// ---------------------------------------------------------------------------
// Execution (bounded, isolated, audited)
// ---------------------------------------------------------------------------

export interface ReachExecutionOptions {
  /** Authenticated user id — feeds the per-user rate limit + audit trail. */
  userId: string | null
  signal?: AbortSignal
  /** Override the availability pre-check (tests). */
  availability?: ReachAvailability
}

export interface ReachAvailability {
  runtime: ReachRuntimeHealth
  doctor: ReachDoctorReport
}

export interface ReachChannelAvailability {
  disabledByConfig: boolean
  runtimeAvailable: boolean
  doctorStatus: string | null
  regressed: boolean
  loginRequired: boolean
  loggedIn: boolean | null
}

/**
 * Resolve per-channel availability from cached probes. Mirrors the registry
 * rules so execution and status display NEVER disagree.
 */
export async function resolveAvailability(): Promise<ReachAvailability> {
  const runtime = await probeReachRuntime()
  const doctor = runtime.available ? await fetchReachDoctor() : { ok: false, channels: [], checkedAt: '' }
  return { runtime, doctor }
}

export function channelAvailability(
  channel: string,
  availability: ReachAvailability,
): ReachChannelAvailability {
  const entry = availability.doctor.channels.find((c) => c.channel === channel)
  return {
    disabledByConfig: false,
    runtimeAvailable: availability.runtime.available,
    doctorStatus: entry?.status ?? null,
    regressed: entry?.regressed ?? false,
    loginRequired: entry?.login?.via !== undefined && entry.login.via.length > 0,
    loggedIn: entry?.login?.loggedIn ?? null,
  }
}

/**
 * Execute a reach plan. NEVER throws. Every invocation is isolated: its
 * failure becomes one honest `degraded` note. The whole lane respects the
 * configured wall-clock budget (deadline aborts in-flight children).
 */
export async function runReachRetrieval(
  plan: ReachPlanEntry[],
  options: ReachExecutionOptions,
): Promise<ReachRetrievalOutcome> {
  const t0 = Date.now()
  const degraded: string[] = []
  const results: ReachEvidence[] = []
  const channelsUsed = new Set<string>()

  if (plan.length === 0) {
    return { results, degraded, durationMs: 0, invocations: 0, channelsUsed: [] }
  }

  const availability = options.availability ?? (await resolveAvailability())
  if (!availability.runtime.available) {
    return {
      results,
      degraded: [`agent reach unavailable: ${availability.runtime.reason ?? 'runtime not installed'}`],
      durationMs: Date.now() - t0,
      invocations: 0,
      channelsUsed: [],
    }
  }

  const deadline = Date.now() + reachLaneBudgetMs()
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  const budgetTimer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()))

  let invocations = 0
  try {
    // Bounded concurrency: 2 children at a time (adapter enforces the same
    // process-wide cap). Sequential-feeling budget keeps product turns fast.
    const CONCURRENCY = 2
    const queue = [...plan]
    const workers: Array<Promise<void>> = []
    for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w += 1) {
      workers.push(
        (async () => {
          for (;;) {
            const entry = queue.shift()
            if (!entry || controller.signal.aborted || Date.now() > deadline) return
            invocations += 1
            const outcome = await runReachInvocation(
              { channel: entry.channel, action: entry.action, params: entry.params },
              { signal: controller.signal, rateLimitKey: options.userId ? `research:reach:${options.userId}` : null },
            )
            auditReachInvocation(options.userId, { channel: entry.channel, action: entry.action, params: entry.params }, outcome)
            if (!outcome.ok) {
              const kind = outcome.error?.kind ?? 'upstream'
              const message = outcome.error?.message ?? 'failed'
              degraded.push(`${entry.channel}.${entry.action} failed (${kind}): ${message.slice(0, 140)}`)
              continue
            }
            if (outcome.items.length === 0) {
              degraded.push(`${entry.channel}.${entry.action} returned no results`)
              continue
            }
            channelsUsed.add(entry.channel)
            outcome.items.forEach((item, idx) => {
              const evidence = normalizeReachItem(item, entry.channel, outcome.backend, idx + 1)
              if (evidence) results.push(evidence)
              else degraded.push(`${entry.channel}.${entry.action}: one result was dropped (unsafe or missing URL)`)
            })
          }
        })(),
      )
    }
    await Promise.all(workers)
  } finally {
    clearTimeout(budgetTimer)
    if (options.signal) options.signal.removeEventListener('abort', onOuterAbort)
  }
  if (controller.signal.aborted && results.length === 0) {
    degraded.push('agent reach lane exceeded its time budget and was stopped')
  }

  return {
    results,
    degraded,
    durationMs: Date.now() - t0,
    invocations,
    channelsUsed: [...channelsUsed],
  }
}

/** Convenience wrapper: plan + execute for a research message. */
export async function runReachLaneForMessage(
  message: string,
  userId: string | null,
  signal?: AbortSignal,
): Promise<ReachRetrievalOutcome & { plan: ReachPlanEntry[] }> {
  const plan = planReachInvocations(message)
  const outcome = await runReachRetrieval(plan, { userId, signal })
  return { ...outcome, plan }
}

// ---------------------------------------------------------------------------
// Page reads (addendum fallback chain)
// ---------------------------------------------------------------------------

export interface ReachPageRead {
  engine: 'agent-reach' | 'obscura'
  text: string
  injectionFlags: string[]
}

function isJsShellText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 200) return true
  return /enable javascript|just a moment|checking your browser/i.test(trimmed.slice(0, 400))
}

/**
 * Agent Reach → Obscura page-read fallback (addendum strategy): try the
 * native Agent Reach web channel first; when it fails OR returns a
 * JavaScript-shell page, render with Obscura. Returns null when both paths
 * are unavailable — the caller then falls back to its existing retrieval
 * (and reports honestly). Blocked pages are NOT retried repeatedly.
 */
export async function reachPageReadFallback(
  rawUrl: string,
  options: { userId: string | null; signal?: AbortSignal },
): Promise<ReachPageRead | null> {
  // 1. Agent Reach native channel tool (web.read → Jina/Exa).
  const outcome = await runReachInvocation(
    { channel: 'web', action: 'read', params: { target: rawUrl } },
    { timeoutMs: Math.min(reachTimeoutMs(), 12_000), signal: options.signal, rateLimitKey: options.userId ? `research:reach:${options.userId}` : null },
  )
  auditReachInvocation(options.userId, { channel: 'web', action: 'read', params: { target: rawUrl } }, outcome)
  let reachText: string | null = null
  let flags: string[] = []
  if (outcome.ok && outcome.items.length > 0) {
    const text = outcome.items[0].text
    if (text && !isJsShellText(text)) {
      const scan = scanRetrievedText(text, 12_000)
      reachText = scan.sanitized
      flags = scan.flags
    }
  }

  // 2. Obscura — only when JavaScript rendering is actually necessary.
  if (reachText === null) {
    const rendered = await obscuraExtractText(rawUrl, options.signal)
    if (rendered.ok && rendered.text.trim().length >= 200 && !isJsShellText(rendered.text)) {
      try {
        void recordAudit({
          actorId: options.userId,
          action: 'research.browser',
          target: 'obscura.extractText',
          meta: { ok: true, elapsedMs: rendered.elapsedMs },
        })
      } catch {
        /* audit must never break retrieval */
      }
      return { engine: 'obscura', text: rendered.text, injectionFlags: rendered.injectionFlags }
    }
    return null
  }

  return { engine: 'agent-reach', text: reachText, injectionFlags: flags }
}
