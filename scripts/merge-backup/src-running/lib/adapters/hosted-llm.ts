/**
 * BEAN Intelligence — authorized hosted LLM adapter (RIISHE + CODE GIFTZ).
 *
 * Wraps the authorized inference gateway (z-ai-web-dev-sdk). Confirmed by
 * real probe (scripts/stage0-report.json): non-streaming chat PASS,
 * SSE streaming PASS (raw `data:` lines decoded server-side).
 */
import ZAI from 'z-ai-web-dev-sdk'
import type {
  ChatRequest,
  ChatResult,
  CodeTaskRequest,
  CodeTaskResult,
  HealthReport,
  TaskAdapter,
} from './types'
import { estimateTokens } from '@/lib/api/validate'

const BACKEND_ID = 'bean-llm-hosted-primary'

/** Parse raw SSE byte chunks from the gateway into text deltas. */
async function* sseDeltas(
  stream: AsyncIterable<unknown>,
): AsyncGenerator<string, void, unknown> {
  let buffer = ''
  for await (const part of stream) {
    buffer += Buffer.from(Object.values(part as Record<string, number>)).toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const m = line.match(/^data: (.*)$/)
      if (!m) continue
      if (m[1].trim() === '[DONE]') return
      try {
        const json = JSON.parse(m[1])
        const delta: string | undefined = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) yield delta
      } catch {
        // partial JSON across chunk boundary — carried in buffer
      }
    }
  }
}

function buildMessages(req: ChatRequest | CodeTaskRequest) {
  // CodeTaskRequest carries no history cap: its messages are already curated
  // by the CODE GIFTZ route (system prompt + single user turn).
  const maxHistoryMessages =
    'maxHistoryMessages' in req ? req.maxHistoryMessages : req.messages.length
  const history = req.messages.slice(-maxHistoryMessages)
  return history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, req.maxPromptChars),
  }))
}

/**
 * Bounded retry for transient gateway rejections (HTTP 429).
 * A 429 means the request was NOT processed upstream — exactly one retry
 * after a short backoff cannot double-charge or double-persist. Anything
 * else (4xx/5xx, network) propagates immediately; the router surfaces it
 * as BACKEND_FAILURE with honest degradation.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function createWithTransientRetry(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  body: unknown,
): Promise<unknown> {
  try {
    return await zai.chat.completions.create(body as never)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('429')) throw e
    await sleep(2_500)
    return zai.chat.completions.create(body as never)
  }
}

export const hostedLlmAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        thinking: { type: 'disabled' },
      })
      const content = completion.choices?.[0]?.message?.content ?? ''
      const healthy = content.trim().length > 0
      return {
        healthy,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: healthy ? 'Gateway responded to a live completion probe.' : 'Empty probe response.',
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `Probe failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const zai = await ZAI.create()
    const completion = (await createWithTransientRetry(zai, {
      messages: buildMessages(req),
      thinking: { type: req.thinkingEnabled ? 'enabled' : 'disabled' },
    })) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = completion.choices?.[0]?.message?.content ?? ''
    if (!content) {
      throw new Error('Upstream returned an empty completion')
    }
    const durationMs = Date.now() - t0
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs,
    }
  },

  async *chatStream(req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const zai = await ZAI.create()
    const stream = (await createWithTransientRetry(zai, {
      messages: buildMessages(req),
      stream: true,
      thinking: { type: req.thinkingEnabled ? 'enabled' : 'disabled' },
    })) as AsyncIterable<unknown>
    yield* sseDeltas(stream)
  },

  async codeTask(req: CodeTaskRequest): Promise<CodeTaskResult> {
    const t0 = Date.now()
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: buildMessages(req),
      thinking: { type: 'disabled' },
    })
    const content = completion.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('Upstream returned an empty completion')
    const durationMs = Date.now() - t0
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs,
    }
  },
}

/**
 * Timeout guard used by the router around adapter calls.
 *
 * Guarantees: the caller's awaited promise settles within `ms` — resolving
 * with the wrapped result, or rejecting with a labeled timeout error that
 * routes surface as BACKEND_FAILURE. The internal timer is always cleared
 * once the race settles, so it never keeps the event loop alive after
 * completion.
 *
 * Known limitation (recorded, not hidden): the authorized gateway SDK
 * (z-ai-web-dev-sdk) exposes no AbortSignal/options parameter on its create
 * calls (verified against dist/index.d.ts), so a timed-out underlying
 * request CANNOT be cancelled from here. Promise.race only abandons the
 * wait — the upstream request may continue until the provider itself times
 * out. It produces no customer-visible effect (the slot is released, the
 * response is discarded), but operators must assume the upstream work
 * consumed until the provider's own deadline. This is a platform-level
 * limitation to revisit if the SDK gains signal support.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
