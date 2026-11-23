/**
 * BEAN Intelligence — Anthropic Messages API chat adapter (SERVER ONLY,
 * M36-A universal provider ecosystem).
 *
 * Implements the OFFICIAL Anthropic Messages wire protocol — deliberately NOT
 * routed through the OpenAI-compatible adapter, because the protocols differ
 * in exactly the places a naive mapping gets wrong (brief §4B: "Do not assume
 * that an OpenAI-compatible endpoint supports every OpenAI feature"):
 *   - auth: `x-api-key` + `anthropic-version` headers (no Bearer);
 *   - `system` is a TOP-LEVEL field, not a role in `messages`;
 *   - assistant prefill / roles restricted to `user`|`assistant`;
 *   - response shape: `{ content: [{ type:'text', text }], usage:
 *     { input_tokens, output_tokens } }`;
 *   - streaming: SSE events (`message_start`, `content_block_delta` with
 *     `delta.type==='text_delta'`, `message_stop`) — decoded here into plain
 *     text deltas through the platform's audited SSE decoder.
 *
 * Credential sources (checked in order, values never logged/stored/returned):
 *  1. ADMIN VAULT — an active encrypted 'anthropic' credential.
 *  2. RUNTIME ENV — BEAN_PROVIDER_ANTHROPIC_API_KEY (+ optional
 *     BEAN_PROVIDER_ANTHROPIC_BASE_URL / BEAN_PROVIDER_ANTHROPIC_MODEL).
 * With neither source the adapter is DORMANT: no request is ever made and
 * the routing layer reports the slot as 'not-configured'. The operator's
 * configured credential IS the authorization (cost policy: no automatic
 * paid fallback — this slot is never added to an automatic chain silently;
 * it serves when routing selects it and refuses honestly otherwise).
 *
 * Hard honesty rules (same as every provider adapter):
 *  - CAPABILITY IS VERIFIED, NEVER ASSUMED: health() runs a real tiny
 *    completion through the configured endpoint.
 *  - One attempt per call; 429 opens the DEDICATED 'chat-anthropic' breaker
 *    class so a throttled slot never shares breaker state with the primary
 *    gateway or the OpenAI-compatible fallback.
 *  - Bearer/x-api-key values are redacted from any error text that could
 *    reach a log.
 */

import {
  classifyUpstreamError,
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  parseRetryAfterHeaders,
  upstreamCoolingDown,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import { estimateTokens } from '@/lib/api/validate'
import { decryptProviderCredential } from '@/lib/security/provider-credentials'
import { validateProviderBaseUrl } from '@/lib/security/url-guard'
import type {
  ChatRequest,
  ChatResult,
  CodeTaskRequest,
  CodeTaskResult,
  HealthReport,
  TaskAdapter,
} from '@/lib/adapters/types'
import { resolveAnthropicRuntimeCredential } from './credentials'

export const ANTHROPIC_BACKEND_ID = 'bean-llm-anthropic'

/** Wire protocol version (official documented header value). */
const ANTHROPIC_VERSION = '2023-06-01'

/** Hard output ceiling — matches the platform's other chat slots. */
const MAX_OUTPUT_TOKENS = 4096

interface RuntimeCred {
  apiKey: string
  baseUrl: string
  model: string
}

/** Resolve the active credential material (vault → env), or null when dormant. */
async function resolveRuntimeCred(): Promise<RuntimeCred | null> {
  const resolved = await resolveAnthropicRuntimeCredential()
  if (!resolved) return null
  if (resolved.origin === 'admin-vault' && resolved.credentialId) {
    const { payload, baseUrl } = await decryptProviderCredential(resolved.credentialId)
    if (!baseUrl) return null
    return { apiKey: payload.apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model: resolved.model }
  }
  const guard = validateProviderBaseUrl(resolved.baseUrl)
  if (!guard.ok) return null
  return { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, model: resolved.model }
}

function redact(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/x-api-key["\s:]+[A-Za-z0-9._-]+/gi, 'x-api-key <redacted>')
    .replace(/sk-ant-[A-Za-z0-9._-]+/gi, '<redacted>')
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Map BEAN's chat turns onto the Messages contract. BEAN's RIISHE protocol
 * delivers its system prompt as a LEADING ASSISTANT-ROLE turn (the platform's
 * ChatTurn contract has no system role — see orchestrator.ts baseMessages).
 * Anthropic Messages requires the top-level `system` field and a
 * user-first/last conversation, so:
 *   - a leading assistant turn becomes the top-level `system` field;
 *   - the remaining user/assistant turns pass through verbatim;
 *   - the final turn must be a user turn (honest error otherwise — never a
 *     fabricated prefill).
 */
export function buildAnthropicBody(
  req: ChatRequest | CodeTaskRequest,
  stream: boolean,
  model: string,
): Record<string, unknown> {
  const systemParts: string[] = []
  const turns: AnthropicMessage[] = []
  let index = 0
  for (const m of req.messages) {
    const content = m.content.slice(0, req.maxPromptChars)
    // BEAN protocol: leading assistant turn = the system prompt.
    if (index === 0 && m.role === 'assistant') {
      systemParts.push(content)
      index += 1
      continue
    }
    turns.push({ role: m.role, content })
    index += 1
  }
  // Anthropic requires the conversation to end with a user turn (the caller
  // always sends the user's message last — assert honestly instead of
  // fabricating an assistant prefill).
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    throw new Error('Anthropic Messages adapter requires the final turn to be a user message')
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: turns,
    stream,
  }
  if (systemParts.length > 0) body.system = systemParts.join('\n\n')
  return body
}

async function postMessages(cred: RuntimeCred, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return await fetch(`${cred.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cred.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  })
}

async function execute(req: ChatRequest | CodeTaskRequest, stream: boolean): Promise<Response> {
  const cred = await resolveRuntimeCred()
  if (!cred) {
    throw new UpstreamRateLimitError(
      'chat-anthropic',
      'Anthropic Messages slot is not configured (an administrator credential or BEAN_PROVIDER_ANTHROPIC_API_KEY is required); no request was made',
      false,
    )
  }
  if (upstreamCoolingDown('chat-anthropic')) {
    noteUpstreamSkip('chat-anthropic')
    throw new UpstreamRateLimitError(
      'chat-anthropic',
      'Anthropic chat completion not attempted: the slot class is rate-limited (HTTP 429 observed moments ago)',
      false,
    )
  }
  const body = buildAnthropicBody(req, stream, cred.model)
  let res: Response
  try {
    res = await postMessages(cred, body, req.timeoutMs)
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`Anthropic slot timed out after ${req.timeoutMs}ms`)
    }
    throw e
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    const message = redact(`status ${res.status}: ${errBody.slice(0, 200)}`)
    if (res.status === 429) {
      const hint = parseRetryAfterHeaders(res.headers)
      noteUpstream429('chat-anthropic', Date.now(), hint)
      throw new UpstreamRateLimitError(
        'chat-anthropic',
        `Anthropic chat completion is rate-limited upstream (HTTP 429): ${message}`,
        true,
        hint,
      )
    }
    const failure = classifyUpstreamError(new Error(message))
    if (failure.kind === 'auth') throw new Error(`Anthropic slot rejected credentials (HTTP ${res.status}). Check the configured credential — retrying will not change this.`)
    if (failure.kind === 'billing') throw new Error(`Anthropic slot refused for account/billing reasons (HTTP ${res.status}).`)
    throw new Error(`Anthropic chat completion failed (HTTP ${res.status}): ${message}`)
  }
  noteUpstreamSuccess('chat-anthropic')
  return res
}

interface AnthropicNonStreamingResponse {
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

function textFromContent(content: AnthropicNonStreamingResponse['content']): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('')
}

/**
 * Extract the text payload from one Anthropic SSE event JSON object.
 * Only `content_block_delta` with a `text_delta` carries output text;
 * everything else (message_start, ping, message_stop, error) contributes
 * nothing. Exported for protocol tests.
 */
export function anthropicSseEventToDelta(eventJson: unknown): string | null {
  const ev = eventJson as { type?: string; delta?: { type?: string; text?: string } } | null
  if (!ev || ev.type !== 'content_block_delta') return null
  if (ev.delta?.type !== 'text_delta' || typeof ev.delta.text !== 'string') return null
  return ev.delta.text
}

/**
 * Stream SSE `data:` payloads from an Anthropic Messages response body.
 * Multibyte-safe (streaming TextDecoder — a split character across network
 * chunks reassembles exactly), bounded by the request's own AbortSignal
 * timeout set in execute(). Only COMPLETE `data:` lines are processed;
 * comments/keepalives and event names are ignored.
 */
async function* anthropicSseDataPayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('utf-8')
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = (newlineIndex > 0 && buffer[newlineIndex - 1] === '\r' ? buffer.slice(0, newlineIndex - 1) : buffer.slice(0, newlineIndex)).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
        if (payload.length === 0) continue
        yield payload
      }
    }
    buffer += decoder.decode()
    const rest = buffer.trim()
    if (rest.startsWith('data:')) {
      const payload = rest.startsWith('data: ') ? rest.slice(6) : rest.slice(5)
      if (payload.length > 0) yield payload
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* not actionable */
    }
  }
}

export const anthropicAdapter: TaskAdapter = {
  backendId: ANTHROPIC_BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    const cred = await resolveRuntimeCred()
    if (!cred) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        failureCategory: 'not-configured',
        detail:
          'Not configured: the Anthropic Messages slot has no active credential (neither an admin-vault credential nor BEAN_PROVIDER_ANTHROPIC_API_KEY). It consumes nothing and is never routed to until an operator adds one.',
      }
    }
    try {
      const res = await postMessages(
        cred,
        { model: cred.model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] },
        15_000,
      )
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        const message = redact(`status ${res.status}: ${errBody.slice(0, 160)}`)
        if (res.status === 429) {
          const hint = parseRetryAfterHeaders(res.headers)
          noteUpstream429('chat-anthropic', Date.now(), hint)
          return {
            healthy: false,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - t0,
            httpStatus: 429,
            failureCategory: 'rate-limited',
            detail: `Anthropic slot reachable but rate-limited (HTTP 429): ${message}`,
          }
        }
        const failure = classifyUpstreamError(new Error(message))
        return {
          healthy: false,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - t0,
          httpStatus: res.status,
          failureCategory: failure.kind === 'auth' ? 'auth' : failure.kind === 'billing' ? 'billing' : 'backend-error',
          detail: `Anthropic slot probe failed (HTTP ${res.status}): ${message}`,
        }
      }
      const json = (await res.json()) as AnthropicNonStreamingResponse
      const content = textFromContent(json.content)
      const healthy = content.trim().length > 0
      return {
        healthy,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: null,
        failureCategory: healthy ? null : 'backend-error',
        detail: healthy
          ? 'Anthropic slot answered a real completion probe (chat capability verified, not assumed).'
          : 'Anthropic slot returned an empty completion probe response.',
      }
    } catch (e) {
      const failure = classifyUpstreamError(e)
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: failure.status,
        failureCategory: failure.kind === 'timeout' ? 'timeout' : failure.kind === 'network' ? 'unreachable' : 'backend-error',
        detail: `Anthropic slot probe failed: ${redact(e instanceof Error ? e.message : String(e))}`,
      }
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const res = await execute(req, false)
    const json = (await res.json()) as AnthropicNonStreamingResponse
    const content = textFromContent(json.content)
    if (!content) throw new Error('Anthropic slot returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: json.usage?.input_tokens ?? (lastUser ? estimateTokens(lastUser.content) : null),
      tokensOutEst: json.usage?.output_tokens ?? estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },

  async *chatStream(req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const res = await execute(req, true)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      // A provider that ignored stream:true still returns a Messages JSON
      // body — parse it and emit one delta rather than failing the turn.
      const json = (await res.json()) as AnthropicNonStreamingResponse
      const content = textFromContent(json.content)
      if (content) yield content
      return
    }
    if (!res.body) throw new Error('Anthropic slot stream closed with no body')
    // Anthropic Messages SSE mapping: content_block_delta(text_delta) → text.
    for await (const raw of anthropicSseDataPayloads(res.body as ReadableStream<Uint8Array>)) {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue // non-JSON line — skip honestly
      }
      const delta = anthropicSseEventToDelta(parsed)
      if (delta !== null) yield delta
    }
  },

  async codeTask(req: CodeTaskRequest): Promise<CodeTaskResult> {
    const t0 = Date.now()
    const res = await execute(req, false)
    const json = (await res.json()) as AnthropicNonStreamingResponse
    const content = textFromContent(json.content)
    if (!content) throw new Error('Anthropic slot returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: json.usage?.input_tokens ?? (lastUser ? estimateTokens(lastUser.content) : null),
      tokensOutEst: json.usage?.output_tokens ?? estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },
}
