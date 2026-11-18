/**
 * BEAN Intelligence — WebLLM inference worker (Tier A: browser GPU chat).
 *
 * Runs the @mlc-ai/web-llm engine (WebGPU) OUTSIDE the main UI thread in a
 * dedicated module worker. The visitor's device processes ONLY this
 * visitor's inference: there is no shared-compute path here, and the model
 * weights never leave the browser cache.
 *
 * Protocol (postMessage):
 *  -> {kind:'init', requestId, modelId, vramFallback?}
 *  -> {kind:'generate', requestId, messages, maxTokens?, temperature?, topP?}
 *  -> {kind:'interrupt', requestId}
 *  -> {kind:'unload', requestId}
 *  -> {kind:'status', requestId}
 *  <- {type:'progress'|'ready'|'delta'|'done'|'error'|'unloaded'|'state', requestId}
 *
 * Error discipline: every failure posts an honest error event with a STABLE
 * code from the BEAN AI error catalog (the worker maps runtime signatures);
 * success is posted ONLY after the engine actually produced tokens.
 */

import type { AiErrorCode } from '@/lib/client-compute/inference/errors'

interface InitMsg { kind: 'init'; requestId: string; modelId: string }
interface GenerateMsg {
  kind: 'generate'
  requestId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
  temperature?: number
  topP?: number
}
interface InterruptMsg { kind: 'interrupt'; requestId: string }
interface UnloadMsg { kind: 'unload'; requestId: string }
interface StatusMsg { kind: 'status'; requestId: string }
type WorkerMsg = InitMsg | GenerateMsg | InterruptMsg | UnloadMsg | StatusMsg

/** Map a thrown value to a stable code (worker-side, message-signature based). */
function classify(error: unknown): { code: AiErrorCode; message: string; details?: string } {
  const raw = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  const text = raw.toLowerCase()
  const has = (...n: string[]) => n.some((x) => text.includes(x))
  if (has('interrupted', 'aborted by the user')) return { code: 'AI_GENERATION_CANCELLED', message: 'Generation was cancelled.' }
  if (has('aborterror', 'aborted')) return { code: 'AI_GENERATION_CANCELLED', message: 'Generation was cancelled.' }
  if (has('gpu device lost', 'device lost', 'context lost')) return { code: 'AI_GPU_DEVICE_LOST', message: 'The GPU device was lost mid-run.' }
  if (has('out of memory', 'outofmemory', 'oom', 'allocation failed')) return { code: 'AI_OUT_OF_MEMORY', message: 'The device ran out of memory while running the model.' }
  if (has('webgpu', 'requestadapter', 'adapter not found', 'device not available')) return { code: 'AI_WEBGPU_UNAVAILABLE', message: 'WebGPU is not available for inference in this browser.' }
  if (has('timed out', 'timeout')) return { code: 'AI_TIMEOUT', message: 'The runtime took too long.' }
  if (has('fetch', 'network')) return { code: 'AI_NETWORK_INTERRUPTED', message: 'The model download or request hit a network interruption.' }
  if (has('not found', 'no such model', 'unknown model', 'model_id')) return { code: 'AI_MODEL_UNSUPPORTED_DEVICE', message: 'The requested model is not available for this runtime.' }
  return {
    code: 'AI_GENERATION_FAILED',
    message: 'On-device generation failed.',
    details: raw.slice(0, 300),
  }
}

type EngineLike = {
  reload: (modelId: string, opts?: { progressCallback?: (report: { text?: string; progress?: number }) => void }) => Promise<void>
  chat: {
    completions: {
      create: (opts: {
        messages: Array<{ role: string; content: string }>
        stream: true
        stream_options?: { include_usage: boolean }
        max_tokens?: number
        temperature?: number
        top_p?: number
      }) => Promise<AsyncIterable<{ choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: unknown }>>
    }
  }
  interruptGenerate: () => Promise<void>
  unload: () => Promise<void>
  resetChat: () => Promise<void>
  getMessageLength?: () => number
}

let engine: EngineLike | null = null
let loadedModelId: string | null = null
let loading: Promise<void> | null = null
let generating = false

function post(msg: Record<string, unknown>): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function loadWebLlm(): Promise<typeof import('@mlc-ai/web-llm')> {
  return import('@mlc-ai/web-llm')
}

async function ensureEngine(modelId: string, requestId: string): Promise<EngineLike> {
  if (engine && loadedModelId === modelId) return engine
  if (engine && loadedModelId !== modelId) {
    // One large generative model per tab (policy): switching models unloads
    // the previous one first.
    try {
      await engine.unload()
    } catch {
      /* unload is best-effort */
    }
    engine = null
    loadedModelId = null
  }
  if (!engine) {
    loading ??= (async () => {
      const webllm = await loadWebLlm()
      const known = webllm.prebuiltAppConfig.model_list.some((m) => m.model_id === modelId)
      if (!known) {
        throw Object.assign(new Error(`Unknown model "${modelId}" for this WebLLM runtime version.`), { beanCode: 'AI_MODEL_UNSUPPORTED_DEVICE' })
      }
      const created = await webllm.CreateMLCEngine(modelId, {
        // MLCEngineConfig's load-progress hook is initProgressCallback (0.2.x).
        initProgressCallback: (report: { text?: string; progress?: number }) => {
          post({ type: 'progress', requestId, note: report.text ?? 'loading model', progress: typeof report.progress === 'number' ? report.progress : null })
        },
      })
      engine = created as unknown as EngineLike
      loadedModelId = modelId
    })()
    try {
      await loading
    } finally {
      loading = null
    }
  }
  return engine as EngineLike
}

async function handleGenerate(msg: GenerateMsg): Promise<void> {
  if (!engine) {
    post({ type: 'error', requestId: msg.requestId, code: 'AI_MODEL_NOT_INSTALLED', message: 'No model is loaded in this worker.' })
    return
  }
  generating = true
  let text = ''
  let finishReason: string | null = null
  try {
    const stream = await engine.chat.completions.create({
      messages: msg.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(typeof msg.maxTokens === 'number' ? { max_tokens: msg.maxTokens } : {}),
      ...(typeof msg.temperature === 'number' ? { temperature: msg.temperature } : {}),
      ...(typeof msg.topP === 'number' ? { top_p: msg.topP } : {}),
    })
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      const reason = chunk.choices?.[0]?.finish_reason
      if (delta) {
        text += delta
        post({ type: 'delta', requestId: msg.requestId, delta })
      }
      if (reason) finishReason = reason
    }
    if (!finishReason) {
      post({ type: 'error', requestId: msg.requestId, code: 'AI_STREAM_TERMINATED', message: 'The response stream ended without a finish frame.' })
      return
    }
    post({ type: 'done', requestId: msg.requestId, text, finishReason })
  } catch (error) {
    const mapped = classify(error)
    post({ type: 'error', requestId: msg.requestId, ...mapped })
  } finally {
    generating = false
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerMsg>) => {
  const msg = event.data
  void (async () => {
    try {
      switch (msg.kind) {
        case 'init': {
          await ensureEngine(msg.modelId, msg.requestId)
          post({ type: 'ready', requestId: msg.requestId, modelId: loadedModelId })
          break
        }
        case 'generate': {
          await handleGenerate(msg)
          break
        }
        case 'interrupt': {
          if (engine && generating) await engine.interruptGenerate()
          post({ type: 'state', requestId: msg.requestId, state: 'interrupt-signalled' })
          break
        }
        case 'unload': {
          if (engine) {
            try {
              await engine.unload()
            } finally {
              engine = null
              loadedModelId = null
            }
          }
          post({ type: 'unloaded', requestId: msg.requestId })
          break
        }
        case 'status': {
          post({ type: 'state', requestId: msg.requestId, state: engine ? 'loaded' : 'empty', modelId: loadedModelId })
          break
        }
      }
    } catch (error) {
      const mapped = classify(error)
      post({ type: 'error', requestId: (msg as { requestId?: string }).requestId ?? '', ...mapped })
    }
  })()
})
