/**
 * BEAN Intelligence — local desktop engine client (Tier B, client-safe).
 *
 * Connects the WEBSITE to an OPTIONAL llama.cpp `llama-server` running on
 * the VISITOR'S OWN computer. Security contract (task §3 Tier B):
 *  - LOOPBACK ONLY: pairing accepts 127.0.0.1, localhost and [::1] — never
 *    a LAN/public host. The engine is expected to be started bound to
 *    127.0.0.1 with an API key (`--api-key`), so no other page can use it.
 *  - The pairing key is stored ONLY in this browser's localStorage (see
 *    device-settings.ts) and is sent ONLY to the loopback engine — never to
 *    any BEAN server.
 *  - ORIGIN VALIDATION: the browser cannot forge an Origin header, and
 *    llama-server (>= b4xxx, --cors-origins) can restrict which origins may
 *    call it. Pairing guidance in the deployment guide instructs starting
 *    the server with `--api-key <secret> --host 127.0.0.1`; with an API key
 *    set, cross-origin abuse is authenticated out. BEAN additionally
 *    verifies the engine's identity (models list) at pairing time.
 *  - The website keeps working without the engine (it is optional).
 *
 * All methods are honest: reachability is MEASURED per call; a paired
 * engine that stopped answers AI_LOCAL_ENGINE_UNREACHABLE with recovery.
 *
 * Client-safe: no Node-only imports.
 */
import { AiErrorImpl, aiError, type AiError } from '@/lib/client-compute/inference/errors'
import type { LocalEnginePairing } from '@/lib/client-compute/inference/device-settings'

export const LOOPBACK_HOSTS: readonly LocalEnginePairing['host'][] = ['127.0.0.1', 'localhost', '[::1]'] as const

/** Build the loopback base URL from a pairing, or fail with a typed error. */
export function localEngineBaseUrl(pairing: Pick<LocalEnginePairing, 'host' | 'port'>): string {
  if (!LOOPBACK_HOSTS.includes(pairing.host)) {
    throw new AiErrorImpl('AI_LOCAL_ENGINE_INVALID_URL', `Non-loopback host rejected: only 127.0.0.1 / localhost / [::1] are permitted.`)
  }
  const port = Number.isInteger(pairing.port) && pairing.port > 0 && pairing.port <= 65535 ? pairing.port : null
  if (!port) throw new AiErrorImpl('AI_LOCAL_ENGINE_INVALID_URL', `Invalid port ${String(pairing.port)}.`)
  return `http://${pairing.host}:${port}`
}

export interface EngineModelInfo {
  id: string
  ownedBy?: string
}

export interface PairingResult {
  ok: true
  baseUrl: string
  models: EngineModelInfo[]
  serverModel: string | null
}
export type PairingFailure = { ok: false; error: AiError }

/** Narrow fetch surface (Bun/global fetch compatible). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Parse an OpenAI-style SSE stream into delta strings. */
async function* parseSseDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<{ delta?: string; done: boolean; reason?: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        yield { done: true }
        return
      }
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
        }
        const choice = json.choices?.[0]
        yield {
          delta: choice?.delta?.content ?? undefined,
          done: choice?.finish_reason != null && choice.finish_reason !== 'null',
          reason: choice?.finish_reason ?? undefined,
        }
      } catch {
        // Malformed frame: skip it, keep streaming (llama-server sends
        // well-formed frames; resilience here must not fabricate content).
      }
    }
  }
}

export class LocalEngineClient {
  private readonly fetchFn: FetchLike

  constructor(deps: { fetchFn?: FetchLike } = {}) {
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init))
  }

  /**
   * Pair with a local engine: validates the loopback contract, then MEASURES
   * the engine (models list) with the provided key. Never stores anything —
   * the caller decides what to persist.
   */
  async pair(
    pairing: LocalEnginePairing,
    options: { timeoutMs?: number } = {},
  ): Promise<PairingResult | PairingFailure> {
    let baseUrl: string
    try {
      baseUrl = localEngineBaseUrl(pairing)
    } catch (error) {
      return { ok: false, error: error instanceof AiErrorImpl ? error : aiError('AI_LOCAL_ENGINE_INVALID_URL') }
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (pairing.apiKey) headers.authorization = `Bearer ${pairing.apiKey}`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_000)
      let res: Response
      try {
        res = await this.fetchFn(`${baseUrl}/v1/models`, { headers, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: aiError('AI_LOCAL_ENGINE_AUTH_FAILED', `Engine answered HTTP ${res.status}.`) }
      }
      if (!res.ok) {
        return { ok: false, error: aiError('AI_LOCAL_ENGINE_UNREACHABLE', `Engine answered HTTP ${res.status} for /v1/models.`) }
      }
      const body = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
      const models: EngineModelInfo[] = (body.data ?? [])
        .filter((m) => typeof m?.id === 'string')
        .map((m) => ({ id: m.id as string, ...(m.owned_by ? { ownedBy: m.owned_by } : {}) }))
      return { ok: true, baseUrl, models, serverModel: models[0]?.id ?? null }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      return {
        ok: false,
        error: aborted
          ? aiError('AI_LOCAL_ENGINE_UNREACHABLE', 'No answer within the pairing timeout — is llama-server running on that port?')
          : aiError('AI_LOCAL_ENGINE_UNREACHABLE', error instanceof Error ? error.message.slice(0, 200) : 'connection failed'),
      }
    }
  }

  /**
   * Stream one chat completion from the paired engine. `onDelta` receives
   * content deltas; the promise resolves with the FULL text (only when the
   * engine actually completed a response — partial streams throw
   * AI_STREAM_TERMINATED, never fake success).
   */
  async streamChat(
    pairing: LocalEnginePairing,
    messages: Array<{ role: string; content: string }>,
    options: {
      onDelta?: (delta: string) => void
      signal?: AbortSignal
      timeoutMs?: number
      maxTokens?: number
      temperature?: number
    } = {},
  ): Promise<{ text: string; finishReason: string | null }> {
    const baseUrl = localEngineBaseUrl(pairing)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (pairing.apiKey) headers.authorization = `Bearer ${pairing.apiKey}`

    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
    const openTimer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)

    let res: Response
    try {
      res = await this.fetchFn(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: pairing.reportedModel ?? 'local',
          messages,
          stream: true,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(openTimer)
      options.signal?.removeEventListener('abort', onExternalAbort)
      if (options.signal?.aborted) throw new AiErrorImpl('AI_GENERATION_CANCELLED')
      if (error instanceof Error && error.name === 'AbortError') throw new AiErrorImpl('AI_LOCAL_ENGINE_UNREACHABLE', 'No answer within the timeout.')
      throw aiError('AI_LOCAL_ENGINE_UNREACHABLE', error instanceof Error ? error.message.slice(0, 200) : 'connection failed')
    }
    clearTimeout(openTimer)

    try {
      if (res.status === 401 || res.status === 403) throw new AiErrorImpl('AI_LOCAL_ENGINE_AUTH_FAILED', `Engine answered HTTP ${res.status}.`)
      if (!res.ok || !res.body) {
        throw new AiErrorImpl('AI_LOCAL_ENGINE_UNREACHABLE', `Engine answered HTTP ${res.status}.`)
      }

      let text = ''
      let finishReason: string | null = null
      for await (const frame of parseSseDeltas(res.body)) {
        if (options.signal?.aborted) {
          controller.abort()
          throw new AiErrorImpl('AI_GENERATION_CANCELLED')
        }
        if (frame.delta) {
          text += frame.delta
          options.onDelta?.(frame.delta)
        }
        if (frame.done && frame.reason) finishReason = frame.reason
      }
      if (!finishReason) throw new AiErrorImpl('AI_STREAM_TERMINATED', 'The engine closed the stream without a finish frame.')
      return { text, finishReason }
    } finally {
      options.signal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

let defaultClient: LocalEngineClient | null = null
export function getDefaultLocalEngineClient(): LocalEngineClient {
  if (!defaultClient) defaultClient = new LocalEngineClient()
  return defaultClient
}
