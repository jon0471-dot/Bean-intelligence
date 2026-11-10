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
 * No Ollama — llama.cpp only, per policy.
 */

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

interface LlamaCred {
  baseUrl: string
  apiKey: string | null
  model: string | null
}

/** Registry-time presence check (env names only, values never read). */
export function isLlamaCppConfigured(): boolean {
  return resolveLlamaCred() !== null
}

/** Resolve the local server coordinates from env; null when not configured. */
function resolveLlamaCred(): LlamaCred | null {
  const allowLocal = process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS === '1'
  const base = process.env.BEAN_LLAMACPP_BASE_URL?.trim()
  if (!allowLocal || !base) return null
  if (!/^https?:\/\//.test(base)) return null
  // Loopback/private enforcement: this adapter is FOR local inference.
  const host = new URL(base).hostname
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host) || host.startsWith('192.168.') || host.startsWith('10.')
  if (!isLocal) return null
  return {
    baseUrl: base.replace(/\/+$/, ''),
    apiKey: process.env.BEAN_LLAMACPP_API_KEY?.trim() || null,
    model: process.env.BEAN_LLAMACPP_MODEL?.trim() || null,
  }
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

async function execute(req: ChatRequest | CodeTaskRequest, stream: boolean): Promise<Response> {
  const cred = resolveLlamaCred()
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
  const model = await resolveModel(cred, req.timeoutMs)
  const body = {
    model,
    messages: req.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content.slice(0, req.maxPromptChars),
    })),
    stream,
    max_tokens: 4096,
  }
  let res: Response
  try {
    res = await postChat(cred, body, req.timeoutMs)
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`local llama.cpp server timed out after ${req.timeoutMs}ms`)
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
    const cred = resolveLlamaCred()
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
    const res = await execute(req, false)
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
    const res = await execute(req, true)
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
    const res = await execute(req, false)
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
