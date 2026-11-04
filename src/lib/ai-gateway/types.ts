/**
 * BEAN Intelligence — unified AI gateway types (the ONE call surface for
 * every configured model, independent of provider).
 *
 * The gateway sits ABOVE the TaskAdapter seam: it resolves a gateway model
 * id to a backend + adapter, normalizes generation parameters, enforces the
 * backend's real limits, classifies failures into BEAN error codes, and
 * records usage. Provider payloads never leak past this module.
 */
import type { ChatTurn } from '@/lib/adapters/types'

export interface GatewayChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GatewayChatRequest {
  /** Gateway model id (from the unified model registry). */
  model: string
  messages: GatewayChatMessage[]
  /** Convenience system instruction — prepended as a system turn when set. */
  system?: string
  /** Sampling temperature the provider genuinely accepts (0–2, clamped). */
  temperature?: number
  /** Output token ceiling — forwarded when the provider accepts one. */
  maxTokens?: number
  /** Stream server-sent deltas instead of buffering one completion. */
  stream?: boolean
  /** Wall-clock cap for a non-streaming completion. */
  timeoutMs?: number
  /**
   * External OpenAI-compatible models only: the provider-side model name
   * (e.g. "gpt-4o-mini") configured by the caller/admin. Ignored for hosted
   * models (their identity comes from the backend registry).
   */
  providerModel?: string
}

export interface GatewayUsage {
  tokensIn: number | null
  tokensOut: number | null
  /** Provider-reported exact counts when available; else char/4 estimates. */
  exact: boolean
}

export interface GatewayChatResult {
  content: string
  provider: string
  model: string
  backendId: string
  durationMs: number
  finishReason: 'stop' | 'length' | 'unknown'
  usage: GatewayUsage
}

/** One streaming step from the gateway (normalized — no provider payloads). */
export interface GatewayStreamEvent {
  type: 'delta'
  delta: string
}

export interface GatewayCallContext {
  /** Who the call is attributed to (session user or key owner). */
  userId: string | null
  /** Application API key id when the caller authenticated with one. */
  apiKeyId: string | null
  /** Auth kind for request logging. */
  authKind: 'session' | 'api-key' | 'internal'
  /** Endpoint label for the request log. */
  endpoint: string
  /**
   * Cooperative cancellation: polled BETWEEN deltas (streaming) and raced
   * with the completion (non-streaming). The authorized hosted SDK exposes
   * no AbortSignal — unwinding is best-effort at the next delta, a recorded
   * platform limitation.
   */
  signal?: AbortSignal | null
}

export interface GatewayRateLimitInfo {
  allowed: boolean
  retryAfterSec: number
}

/** Per-caller gateway rate limits (distinct from product rate limits). */
export const GATEWAY_RATE_LIMIT_PER_MIN = 30
export const GATEWAY_DAILY_QUOTA = 500
