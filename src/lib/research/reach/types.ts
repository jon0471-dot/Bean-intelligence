/**
 * BEAN Intelligence — shared research gateway: Agent Reach adapter types.
 *
 * Agent Reach (Panniantong/Agent-Reach, MIT) is an external, read-only
 * retrieval CLI. Every command prints ONE JSON envelope to stdout:
 *   {schema_version:1, ok, channel, action, backend, items[], meta:{elapsed_ms,
 *    attempts[]}, error:{code,message,hint}}
 * with items shaped {title, url, author, published_at, text, raw} where
 * missing fields are null (never invented upstream — preserved here).
 *
 * This module is SERVER-ONLY: it spawns a configured Python runtime binary
 * through a fixed, allowlisted argv interface. Nothing here is importable
 * from client components. It is NOT a model, model provider, or gateway —
 * the BEAN model router remains the only inference path.
 */

/** Normalized failure kinds surfaced to callers (honest, no stack traces). */
export type ReachFailureKind =
  | 'not-configured' // BEAN-side: binary not configured/found or reach disabled
  | 'needs-setup' // upstream NEED_SETUP (tool/channel not installed)
  | 'needs-login' // upstream NEED_LOGIN (owner must log in on the host)
  | 'timeout'
  | 'rate-limited'
  | 'platform-blocked'
  | 'not-found'
  | 'bad-input'
  | 'busy'
  | 'upstream' // UPSTREAM_BROKEN or anything unclassified
  | 'cancelled'

export interface ReachItem {
  /** Upstream fields are null when absent — never fabricated. */
  title: string | null
  url: string | null
  author: string | null
  publishedAt: string | null
  text: string | null
  /** Upstream `raw` metadata object (stars, license, ...) — passed through. */
  raw: Record<string, unknown> | null
}

export interface ReachAttempt {
  backend: string
  error: { code: string; message: string } | null
}

export interface ReachEnvelopeMeta {
  channel: string
  action: string
  backend: string | null
  elapsedMs: number
  attempts: ReachAttempt[]
}

/** Outcome of ONE allowlisted Agent Reach invocation. */
export interface ReachOutcome {
  ok: boolean
  items: ReachItem[]
  /** Which concrete upstream backend served the call (gh, github-api, exa…). */
  backend: string | null
  elapsedMs: number
  attempts: ReachAttempt[]
  error: { kind: ReachFailureKind; code: string | null; message: string } | null
}

/** A validated, allowlisted invocation request (built by the gateway). */
export interface ReachInvocation {
  channel: string
  action: string
  params: Record<string, string | number>
  /** Per-call timeout in ms (clamped by config). */
  timeoutMs?: number
  /** Max items kept after normalization (clamped by config). */
  maxItems?: number
}

/** Evidence provenance stamped onto research sources consumed by products. */
export interface ReachProvenance {
  /** Agent Reach channel, e.g. "github". */
  channel: string
  /** Concrete upstream backend, e.g. "github-api" (null when unknown). */
  backend: string | null
  /** Retrieval engine that produced the evidence. */
  engine: 'agent-reach' | 'obscura' | 'gateway' | 'direct'
}

/** Normalized evidence ready to merge into the research pipeline ranking. */
export interface ReachEvidence {
  url: string
  title: string
  snippet: string
  hostName: string
  /** Provider rank within its own result set (1-based). */
  rank: number
  /** ISO date when the item declared one; null otherwise (never guessed). */
  date: string | null
  author: string | null
  provenance: ReachProvenance
}

/** Aggregate result of one reach retrieval plan execution. */
export interface ReachRetrievalOutcome {
  results: ReachEvidence[]
  degraded: string[]
  durationMs: number
  invocations: number
  channelsUsed: string[]
}

export interface ReachPlanEntry {
  channel: string
  action: string
  params: Record<string, string | number>
  /** Why this invocation was planned (observability only). */
  reason: string
}
