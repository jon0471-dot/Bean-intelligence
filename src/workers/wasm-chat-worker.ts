/**
 * BEAN Intelligence — WASM (CPU) chat inference worker (M39 §B: the low-spec
 * on-device chat lane).
 *
 * Runs wllama 4.0.0 (llama.cpp compiled to WebAssembly, MIT) OUTSIDE the main
 * UI thread in a dedicated module worker, loading the SHA-256-pinned GGUF
 * artifact that BEAN's model registry already downloaded and verified
 * (bean-managed cache). The lane is explicitly CPU: `n_gpu_layers: 0` skips
 * WebGPU device initialization entirely, so the 'client-cpu' target reported
 * by this worker is an honest claim — inference really ran on the CPU/WASM
 * path even when a WebGPU adapter happens to exist.
 *
 * Protocol (postMessage) — mirrors webllm-worker.ts exactly:
 *  -> {kind:'init', requestId, modelId, blob, nCtx?}
 *  -> {kind:'generate', requestId, messages, maxTokens?, temperature?, topP?}
 *  -> {kind:'interrupt', requestId}
 *  -> {kind:'unload', requestId}
 *  -> {kind:'status', requestId}
 *  <- {type:'progress'|'ready'|'delta'|'done'|'error'|'unloaded'|'state', requestId}
 *
 * Resource discipline (task §3):
 *  - context length is adapted by the caller (nCtx) to the device's policy
 *    memory budget; max_tokens is clamped so a CPU turn cannot run unbounded;
 *  - generation is cancellable at every token boundary (AbortSignal);
 *  - unload()/exit() releases the wasm heap and worker-held model memory.
 *
 * Privacy: this worker processes ONLY the local visitor's inference. The
 * model weights never leave the browser cache; no prompts are sent anywhere.
 *
 * Error discipline: every failure posts an honest error event with a STABLE
 * code from the BEAN AI error catalog; success is posted ONLY after the
 * engine actually produced tokens.
 */

import type { AiErrorCode } from '@/lib/client-compute/inference/errors'

interface InitMsg { kind: 'init'; requestId: string; modelId: string; blob: Blob; nCtx?: number }
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

/** CPU chat generation is time-bounded honestly: an unbounded CPU turn could
 *  occupy the device for minutes. Overridable per call, clamped per ctx. */
const DEFAULT_MAX_TOKENS = 512

function classify(error: unknown): { code: AiErrorCode; message: string; details?: string } {
  const raw = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  const text = raw.toLowerCase()
  const has = (...n: string[]) => n.some((x) => text.includes(x))
  if (has('abort', 'cancel', 'interrupt')) return { code: 'AI_GENERATION_CANCELLED', message: 'Generation was cancelled.' }
  if (has('out of memory', 'outofmemory', 'oom', 'allocation failed', 'memory')) return { code: 'AI_OUT_OF_MEMORY', message: 'The device ran out of memory while running the model.' }
  if (has('not loaded', 'model_not_loaded', 'no model')) return { code: 'AI_MODEL_NOT_INSTALLED', message: 'No model is loaded in this worker.' }
  if (has('not a gguf', 'invalid gguf', 'gguf')) return { code: 'AI_MODEL_UNSUPPORTED_DEVICE', message: 'The provided artifact is not a usable GGUF model for this runtime.' }
  if (has('timed out', 'timeout')) return { code: 'AI_TIMEOUT', message: 'The runtime took too long.' }
  if (has('fetch', 'network')) return { code: 'AI_NETWORK_INTERRUPTED', message: 'The runtime hit a network interruption.' }
  return {
    code: 'AI_GENERATION_FAILED',
    message: 'On-device generation failed.',
    details: raw.slice(0, 300),
  }
}

/** Minimal structural type for the wllama surface this worker uses. The
 *  package is imported lazily so the worker bundle contains the runtime
 *  (like webllm-worker.ts imports @mlc-ai/web-llm lazily). */
interface WllamaLike {
  loadModel(blobs: Blob[], params: Record<string, unknown>): Promise<void>
  createChatCompletion(options: {
    messages: Array<{ role: string; content: string }>
    stream: true
    onData: (chunk: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> }) => void
    abortSignal?: AbortSignal
    max_tokens?: number
    temperature?: number
    top_p?: number
    cache_prompt?: boolean
  }): Promise<void>
  isModelLoaded(): boolean
  exit(): Promise<void>
}

let wllama: WllamaLike | null = null
let loadedModelId: string | null = null
let loading: Promise<void> | null = null
let generating = false
/** Active generation abort controller (interrupt support). */
let activeAbort: AbortController | null = null

function post(msg: Record<string, unknown>): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function loadWllama(): Promise<typeof import('@wllama/wllama')> {
  return import('@wllama/wllama')
}

/** Adapt the context length to the caller's memory-budget decision. The
 *  caller (DeviceCapabilityManager) derives nCtx from the SAME policy budget
 *  that gated the model — low-spec devices honestly get a smaller context. */
function clampMaxTokens(maxTokens: number | undefined, nCtx: number): number {
  const requested = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
  // Leave room for the prompt inside the context (honest clamp, never a
  // silent truncation of the answer without a finish frame).
  return Math.max(16, Math.min(requested, Math.floor(nCtx / 2)))
}

async function ensureEngine(msg: InitMsg): Promise<WllamaLike> {
  if (wllama && loadedModelId === msg.modelId) return wllama
  if (wllama && loadedModelId !== msg.modelId) {
    // One large generative model per tab (policy): switching unloads first.
    try {
      await wllama.exit()
    } catch {
      /* exit is best-effort */
    }
    wllama = null
    loadedModelId = null
  }
  if (!wllama) {
    loading ??= (async () => {
      const mod = await loadWllama()
      // Self-hosted WASM assets only — same-origin, no third-party CDN.
      // The compat build serves browsers without JSPI/relaxed SIMD (e.g.
      // Safari); without it those browsers would fetch a CDN asset.
      const engine = new mod.Wllama(
        { default: '/workers/wllama/wllama.wasm' },
        { suppressNativeLog: true },
      )
      try {
        engine.setCompat({ wasm: '/workers/wllama/wllama-compat.wasm' })
      } catch {
        /* older builds without setCompat: single-thread main build still runs */
      }
      const nCtx = typeof msg.nCtx === 'number' && msg.nCtx >= 256 ? Math.min(msg.nCtx, 4096) : 1024
      post({ type: 'progress', requestId: msg.requestId, note: 'initializing CPU runtime', progress: null })
      // n_gpu_layers: 0 — the CPU lane NEVER initializes WebGPU, so every
      // 'client-cpu' claim from this worker is literally true.
      await engine.loadModel([msg.blob], {
        n_ctx: nCtx,
        n_gpu_layers: 0,
        warmup: false,
      })
      post({ type: 'progress', requestId: msg.requestId, note: 'CPU runtime ready', progress: 1 })
      wllama = engine as unknown as WllamaLike
      loadedModelId = msg.modelId
    })()
    try {
      await loading
    } catch (error) {
      loading = null
      wllama = null
      loadedModelId = null
      throw error
    } finally {
      loading = null
    }
  }
  return wllama as WllamaLike
}

async function handleGenerate(msg: GenerateMsg): Promise<void> {
  if (!wllama) {
    post({ type: 'error', requestId: msg.requestId, code: 'AI_MODEL_NOT_INSTALLED', message: 'No model is loaded in this worker.' })
    return
  }
  generating = true
  activeAbort = new AbortController()
  let text = ''
  let finishReason: string | null = null
  try {
    // nCtx mirrors what the engine was loaded with (tracked at load time).
    const nCtx = (lastNCtx ?? 1024)
    await wllama.createChatCompletion({
      messages: msg.messages,
      stream: true,
      onData: (chunk) => {
        const choice = chunk.choices?.[0]
        const delta = choice?.delta?.content
        const reason = choice?.finish_reason
        if (delta) {
          text += delta
          post({ type: 'delta', requestId: msg.requestId, delta })
        }
        if (reason) finishReason = reason
      },
      abortSignal: activeAbort.signal,
      max_tokens: clampMaxTokens(msg.maxTokens, nCtx),
      ...(typeof msg.temperature === 'number' ? { temperature: msg.temperature } : {}),
      ...(typeof msg.topP === 'number' ? { top_p: msg.topP } : {}),
      cache_prompt: true,
    })
    if (!finishReason) {
      // A cancelled run may legitimately end without a finish frame; an
      // uncancelled run must not.
      if (activeAbort.signal.aborted) {
        post({ type: 'error', requestId: msg.requestId, code: 'AI_GENERATION_CANCELLED', message: 'Generation was cancelled.' })
        return
      }
      post({ type: 'error', requestId: msg.requestId, code: 'AI_STREAM_TERMINATED', message: 'The response stream ended without a finish frame.' })
      return
    }
    post({ type: 'done', requestId: msg.requestId, text, finishReason })
  } catch (error) {
    const mapped = classify(error)
    post({ type: 'error', requestId: msg.requestId, ...mapped })
  } finally {
    generating = false
    activeAbort = null
  }
}

let lastNCtx: number | null = null

self.addEventListener('message', (event: MessageEvent<WorkerMsg>) => {
  const msg = event.data
  void (async () => {
    try {
      switch (msg.kind) {
        case 'init': {
          lastNCtx = typeof msg.nCtx === 'number' && msg.nCtx >= 256 ? Math.min(msg.nCtx, 4096) : 1024
          await ensureEngine(msg)
          post({ type: 'ready', requestId: msg.requestId, modelId: loadedModelId })
          break
        }
        case 'generate': {
          await handleGenerate(msg)
          break
        }
        case 'interrupt': {
          if (activeAbort && generating) activeAbort.abort()
          post({ type: 'state', requestId: msg.requestId, state: 'interrupt-signalled' })
          break
        }
        case 'unload': {
          if (wllama) {
            try {
              await wllama.exit()
            } finally {
              wllama = null
              loadedModelId = null
              lastNCtx = null
            }
          }
          post({ type: 'unloaded', requestId: msg.requestId })
          break
        }
        case 'status': {
          post({ type: 'state', requestId: msg.requestId, state: wllama ? 'loaded' : 'empty', modelId: loadedModelId })
          break
        }
      }
    } catch (error) {
      const mapped = classify(error)
      post({ type: 'error', requestId: (msg as { requestId?: string }).requestId ?? '', ...mapped })
    }
  })()
})
