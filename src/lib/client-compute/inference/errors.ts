/**
 * BEAN Intelligence — universal AI error catalog (client-safe).
 *
 * Every inference failure on any compute location (browser runtime, local
 * desktop engine, BEAN gateway, background worker) maps to ONE of these
 * stable codes with a human-readable message and an ACTIONABLE recovery
 * instruction (operational error handling contract, task §9). Nothing is
 * swallowed: a failure is never converted into a success-shaped response,
 * and no secret or raw prompt content ever lands in the diagnostic fields.
 *
 * Client-safe: no Node-only imports.
 */

export type AiErrorCode =
  // consent / policy
  | 'AI_NOT_CONSENTED'
  | 'AI_UNSUPPORTED_CAPABILITY'
  // runtime + model lifecycle
  | 'AI_RUNTIME_UNAVAILABLE'
  | 'AI_MODEL_NOT_INSTALLED'
  | 'AI_MODEL_UNSUPPORTED_DEVICE'
  | 'AI_MODEL_DOWNLOAD_FAILED'
  | 'AI_MODEL_DOWNLOAD_CANCELLED'
  | 'AI_STORAGE_INSUFFICIENT'
  | 'AI_INIT_TIMEOUT'
  // device runtime failures
  | 'AI_WEBGPU_UNAVAILABLE'
  | 'AI_GPU_DEVICE_LOST'
  | 'AI_OUT_OF_MEMORY'
  | 'AI_WORKER_CRASHED'
  | 'AI_TAB_SUSPENDED'
  // execution
  | 'AI_GENERATION_CANCELLED'
  | 'AI_GENERATION_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'AI_STREAM_TERMINATED'
  | 'AI_TIMEOUT'
  | 'AI_NETWORK_INTERRUPTED'
  // local desktop engine
  | 'AI_LOCAL_ENGINE_UNREACHABLE'
  | 'AI_LOCAL_ENGINE_AUTH_FAILED'
  | 'AI_LOCAL_ENGINE_INVALID_URL'
  | 'AI_LOCAL_ENGINE_INVALID_CONFIG'
  // server provider passthrough shapes (surfaced by the gateway's own contracts)
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_AUTH_FAILED'
  | 'AI_PROVIDER_UNCONFIGURED'

/** A stable, actionable AI error. `details` is always safe diagnostics
 * (message-shaped text only — never payloads, never secrets). */
export interface AiError {
  code: AiErrorCode
  message: string
  /** What the user can DO about it — required for every code. */
  recovery: string
  /** Safe diagnostic note (bounded, redacted upstream). */
  details?: string
}

const CATALOG: Record<AiErrorCode, { message: string; recovery: string }> = {
  AI_NOT_CONSENTED: {
    message: 'On-device AI is not enabled for this browser yet.',
    recovery: 'Open AI Device settings and enable on-device inference (explicit consent is required once per browser).',
  },
  AI_UNSUPPORTED_CAPABILITY: {
    message: 'This AI capability is not available for the selected compute location.',
    recovery: 'Switch the compute mode in AI Device settings, or use the server path.',
  },
  AI_RUNTIME_UNAVAILABLE: {
    message: 'The browser AI runtime is not available in this browser.',
    recovery: 'Use a recent Chrome/Edge/Firefox/Safari release with WebAssembly enabled; for chat acceleration, a WebGPU-capable browser is required.',
  },
  AI_MODEL_NOT_INSTALLED: {
    message: 'The model for this capability has not been downloaded yet.',
    recovery: 'Open AI Device settings → Models and download the model (its size is shown before any download starts).',
  },
  AI_MODEL_UNSUPPORTED_DEVICE: {
    message: 'This model is not supported on this device.',
    recovery: 'Pick a smaller model in AI Device settings, or use the server path.',
  },
  AI_MODEL_DOWNLOAD_FAILED: {
    message: 'The model download failed.',
    recovery: 'Check the network connection and retry the download from AI Device settings.',
  },
  AI_MODEL_DOWNLOAD_CANCELLED: {
    message: 'The model download was cancelled.',
    recovery: 'Restart the download from AI Device settings when ready.',
  },
  AI_STORAGE_INSUFFICIENT: {
    message: 'Not enough browser storage for this model.',
    recovery: 'Clear downloaded models in AI Device settings (or free device storage) and try again.',
  },
  AI_INIT_TIMEOUT: {
    message: 'The AI runtime took too long to initialize.',
    recovery: 'Retry; if it repeats, unload the model in AI Device settings and reload the page.',
  },
  AI_WEBGPU_UNAVAILABLE: {
    message: 'WebGPU is not available, so GPU-accelerated inference cannot run here.',
    recovery: 'Enable WebGPU (Chrome/Edge 113+; chrome://flags/#enable-unsafe-webgpu where applicable), or switch to CPU mode / the server path.',
  },
  AI_GPU_DEVICE_LOST: {
    message: 'The GPU device was lost mid-run (driver reset or system memory pressure).',
    recovery: 'Run the request again; if it repeats, switch to CPU-only mode in AI Device settings.',
  },
  AI_OUT_OF_MEMORY: {
    message: 'The device ran out of memory while running the model.',
    recovery: 'Unload inactive models in AI Device settings, close other heavy tabs, or choose a smaller model.',
  },
  AI_WORKER_CRASHED: {
    message: 'The inference worker stopped unexpectedly.',
    recovery: 'Retry the request; if it repeats, reload the page (the model cache is preserved).',
  },
  AI_TAB_SUSPENDED: {
    message: 'The browser suspended this tab, pausing on-device inference.',
    recovery: 'Return to the tab to resume; the interrupted request can be re-sent.',
  },
  AI_GENERATION_CANCELLED: {
    message: 'Generation was cancelled.',
    recovery: 'Send a new request when ready.',
  },
  AI_GENERATION_FAILED: {
    message: 'On-device generation failed.',
    recovery: 'Retry, or switch to the server path in AI Device settings.',
  },
  AI_INVALID_RESPONSE: {
    message: 'The model returned a response that could not be used.',
    recovery: 'Retry the request; if it repeats with the same prompt, report it via diagnostics.',
  },
  AI_STREAM_TERMINATED: {
    message: 'The response stream ended before completion.',
    recovery: 'Retry the request; partial output (if shown) is labeled as partial.',
  },
  AI_TIMEOUT: {
    message: 'The AI request took too long and was stopped.',
    recovery: 'Retry; for long outputs prefer the server path or a smaller on-device model.',
  },
  AI_NETWORK_INTERRUPTED: {
    message: 'The network connection was interrupted.',
    recovery: 'Reconnect and retry; on-device models keep working offline once downloaded.',
  },
  AI_LOCAL_ENGINE_UNREACHABLE: {
    message: 'The local desktop engine is not reachable.',
    recovery: 'Start llama-server on this computer (AI Device settings shows the exact command) and check the host/port.',
  },
  AI_LOCAL_ENGINE_AUTH_FAILED: {
    message: 'The local engine rejected the pairing key.',
    recovery: 'Re-pair with the engine\u2019s current API key in AI Device settings (llama-server --api-key).',
  },
  AI_LOCAL_ENGINE_INVALID_URL: {
    message: 'The local engine address is invalid.',
    recovery: 'Only loopback addresses (127.0.0.1, localhost, [::1]) are allowed for pairing; fix the host or port in AI Device settings.',
  },
  AI_LOCAL_ENGINE_INVALID_CONFIG: {
    message: 'The local engine pairing information is incomplete.',
    recovery: 'Complete the pairing (host, port and API key) in AI Device settings.',
  },
  AI_RATE_LIMITED: {
    message: 'The AI gateway is temporarily throttling requests (HTTP 429).',
    recovery: 'Wait a short time and retry; on-device inference is not affected by provider throttling.',
  },
  AI_PROVIDER_AUTH_FAILED: {
    message: 'The server-side provider rejected its credentials.',
    recovery: 'Contact the operator — provider credentials live server-side and are never exposed to the browser.',
  },
  AI_PROVIDER_UNCONFIGURED: {
    message: 'No server-side provider is configured for this capability.',
    recovery: 'Use an on-device model (download it in AI Device settings) or ask the operator to configure a provider.',
  },
}

/** Build a typed AiError. */
export function aiError(code: AiErrorCode, details?: string): AiError {
  const entry = CATALOG[code]
  return {
    code,
    message: entry.message,
    recovery: entry.recovery,
    ...(details ? { details: details.slice(0, 400) } : {}),
  }
}

/** Convenience error class (keeps `instanceof` ergonomics on the client). */
export class AiErrorImpl extends Error implements AiError {
  readonly code: AiErrorCode
  readonly recovery: string
  readonly details?: string
  constructor(code: AiErrorCode, details?: string) {
    const entry = CATALOG[code]
    super(entry.message)
    this.name = 'AiError'
    this.code = code
    this.recovery = entry.recovery
    if (details) this.details = details.slice(0, 400)
  }
}

/** Map ANY thrown value (WebLLM, transformers.js, ORT, fetch, worker) to the
 * stable catalog. Signature-based classification on the message text only —
 * never on payload content. Unknown failures map to the generic code for
 * their layer and keep a bounded, redacted note. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiErrorImpl) return error
  const raw = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  const text = raw.toLowerCase()

  const has = (...needles: string[]) => needles.some((n) => text.includes(n))

  if (has('aborted by the user', 'generation interrupted', 'interruptgenerate')) {
    return aiError('AI_GENERATION_CANCELLED')
  }
  if (has('aborterror', 'aborted')) {
    return aiError('AI_GENERATION_CANCELLED')
  }
  if (has('gpu device lost', 'webgpu context lost', 'device lost', 'out_of_memory: gpu', 'gpucanvascontext')) {
    return aiError('AI_GPU_DEVICE_LOST')
  }
  if (has('out of memory', 'outofmemory', 'oom', 'memory allocation', 'allocation failed', 'ran out of memory')) {
    return aiError('AI_OUT_OF_MEMORY')
  }
  if (has('webgpu', 'requestadapter', 'adapter not found', 'gpu not available', 'device not available')) {
    return aiError('AI_WEBGPU_UNAVAILABLE')
  }
  if (has('worker exited', 'worker crashed', 'target closed', 'worker terminated')) {
    return aiError('AI_WORKER_CRASHED')
  }
  if (has('timed out', 'timeout', 'deadline exceeded')) {
    return aiError('AI_TIMEOUT')
  }
  if (has('networkerror', 'failed to fetch', 'network request failed', 'load failed', 'err_network')) {
    return aiError('AI_NETWORK_INTERRUPTED')
  }
  if (has('429', 'rate limit', 'too many requests')) {
    return aiError('AI_RATE_LIMITED')
  }
  if (has('401', '403', 'invalid api key', 'unauthorized', 'invalid token')) {
    return aiError('AI_PROVIDER_AUTH_FAILED')
  }
  if (has('refused', 'econnrefused', 'connection closed', 'socket hang up')) {
    return aiError('AI_LOCAL_ENGINE_UNREACHABLE')
  }
  // Model/runtime lifecycle signatures from the concrete runtimes.
  if (has('cache not found', 'model not found', 'no such model', 'model not loaded', 'engine not initialized', 'model has not been loaded')) {
    return aiError('AI_MODEL_NOT_INSTALLED')
  }
  if (has('webassembly', 'simd not supported', 'wasm not supported')) {
    return aiError('AI_RUNTIME_UNAVAILABLE')
  }
  // Everything else: honest generic failure with the bounded note attached.
  const generic = aiError('AI_GENERATION_FAILED')
  return {
    ...generic,
    details: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  }
}

/** All codes with their catalog text — used by settings/status UI surfaces. */
export function listAiErrorCodes(): Array<AiError & { code: AiErrorCode }> {
  return (Object.keys(CATALOG) as AiErrorCode[]).map((code) => ({ code, ...CATALOG[code] }))
}
