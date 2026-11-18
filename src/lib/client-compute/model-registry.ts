/**
 * BEAN Intelligence — client compute: model registry and download policy
 * (Phase 5).
 *
 * Download policy implemented here (non-negotiable):
 *  - Never automatically download models. Every download requires explicit
 *    user approval, AFTER the real byte size has been measured and shown.
 *  - Downloads are REFUSED unless trusted integrity metadata (SHA-256) has
 *    been configured for the exact model version — the registry ships with
 *    `sha256: null` entries precisely so that nothing can be fetched from
 *    an unverified source until an operator pins the real checksum.
 *  - Storage quota is checked (navigator.storage.estimate) BEFORE download;
 *    insufficient space is an honest refusal, not a failed download.
 *  - A model is reported installed ONLY after its bytes passed the
 *    configured checksum verification.
 *  - Deletion and cache cleanup are first-class; eviction is detected and
 *    reported honestly (an evicted model simply becomes not-installed).
 *
 * Client-safe: no Node-only imports.
 */

export type ClientModelRuntime = 'onnxruntime-web' | 'transformers.js' | 'web-llm' | 'wasm-binary' | 'custom'

/** How the artifact bytes are verified (non-negotiable honesty field):
 *  - 'pinned-artifact-sha256': BEAN downloads + verifies the exact SHA-256
 *    itself (bean-managed-cache path; the strict gate in requestDownload).
 *  - 'runtime-managed-pinned-revision': the runtime (WebLLM / Transformers.js)
 *    fetches the weights itself into ITS OWN browser cache, from an upstream
 *    repo revision that BEAN pins by measured commit SHA. The revision is
 *    recorded per entry; sizes are measured from the upstream file tree at
 *    pin time. requestDownload REFUSES this class — it never pretends to
 *    checksum-manage what it does not checksum-manage.
 */
export type ClientModelIntegrity = 'pinned-artifact-sha256' | 'runtime-managed-pinned-revision'

export type ClientModelDownloadPath = 'bean-managed-cache' | 'runtime-managed-cache'

export interface ClientModelEntry {
  id: string
  version: string
  /** Trusted source origin (HTTPS). Downloads from any other origin are refused. */
  sourceUrl: string
  /** Pinned upstream revision (commit SHA) when the source repo exposes one. */
  revision: string | null
  /** Human-readable license identity. */
  license: string
  licenseUrl?: string
  runtime: ClientModelRuntime
  /** Whether the required client runtime is ACTUALLY available in this app
   * (measured via registered runtime providers — never assumed). */
  runtimeAvailable: () => boolean
  gpuCompatible: boolean
  cpuCompatible: boolean
  /** Approximate working-memory need in MB (policy estimate, clearly labeled). */
  memoryEstimateMb: number | null
  /** Exact byte size — null until a real HEAD measurement fills it in. */
  sizeBytes: number | null
  sizeUnverified: boolean
  /** Trusted SHA-256 of the exact artifact. null ⇒ bean-managed downloads are refused. */
  sha256: string | null
  /** How this entry's bytes are verified (see ClientModelIntegrity). */
  integrity: ClientModelIntegrity
  /** Who owns the download + cache (see ClientModelDownloadPath). */
  downloadPath: ClientModelDownloadPath
  /** Task kinds this model supports (checked by the scheduler). */
  supportedTasks: string[]
  /** Known limitations (honest, user-displayable). */
  limitations: string[]
  /** Whether this entry may be downloaded at all (license/config gate). */
  enabled: boolean
}

export type ModelDownloadCode =
  | 'REFUSED_NOT_ENABLED'
  | 'REFUSED_NO_INTEGRITY_METADATA'
  | 'REFUSED_APPROVAL_REQUIRED'
  | 'REFUSED_RUNTIME_UNAVAILABLE'
  | 'REFUSED_RUNTIME_MANAGED'
  | 'STORAGE_INSUFFICIENT'
  | 'FETCH_FAILED'
  | 'CHECKSUM_FAILED'
  | 'FETCH_ABORTED'

export type ModelDownloadResult =
  | { ok: true; modelId: string; bytes: number; durationMs: number }
  | { ok: false; code: ModelDownloadCode; reason: string }

export type ModelInstallState =
  | { installed: true; bytes: number; verifiedAt: string }
  | { installed: false; reason: string }

export interface ModelRegistryDeps {
  fetchFn?: FetchLike
  /** Injected Cache Storage (production resolves caches.open). */
  cacheFactory?: () => Promise<ModelCacheLike | null>
  digestFn?: (bytes: Uint8Array) => Promise<string>
  storageEstimate?: () => Promise<{ quotaBytes: number | null; usageBytes: number | null }>
  now?: () => number
}

export interface ModelCacheLike {
  match: (key: string) => Promise<Response | undefined>
  put: (key: string, response: Response) => Promise<void>
  delete: (key: string) => Promise<boolean>
  keys?: () => Promise<string[]>
}

const CACHE_NAME = 'bean-client-models-v1'
const MIN_FREE_HEADROOM_BYTES = 100 * 1024 * 1024 // refuse downloads that would leave <100 MB

/** Narrow fetch surface used by the registry (Bun's global fetch type carries
 * runtime-specific extras like `preconnect`; the registry needs only this). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Registered client runtimes (e.g. onnxruntime-web providers). Empty until
 * the corresponding dependency is actually added to the app. */
const runtimeProviders = new Map<ClientModelRuntime, () => boolean>()

/** Register a runtime availability probe. Only the real runtime integration
 * (when it exists) should call this — there is deliberately no default. */
export function registerModelRuntime(runtime: ClientModelRuntime, isAvailable: () => boolean): void {
  runtimeProviders.set(runtime, isAvailable)
}

function runtimeAvailable(runtime: ClientModelRuntime): boolean {
  const probe = runtimeProviders.get(runtime)
  return probe ? probe() === true : false
}

/**
 * The registry. Entries are code-defined honest facts about candidate models.
 * Sizes, revisions and checksums below were MEASURED (Hugging Face API, file
 * downloads and sha256sum, 2026-11-18) — nothing is invented; where a value
 * cannot be known without a runtime probe it stays null.
 *
 * Integrity models (both deliberate):
 *  - laxii-bgremoval-modnet is BEAN-managed: the exact ONNX artifact is
 *    fetched through requestDownload and its bytes must match the pinned
 *    SHA-256 (measured: 92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a).
 *  - The web-llm chat model and the whisper ASR model are RUNTIME-managed:
 *    WebLLM / Transformers.js fetch them into their own browser caches from
 *    a revision BEAN pins by measured commit SHA. requestDownload refuses
 *    them (REFUSED_RUNTIME_MANAGED) instead of faking a checksum gate.
 */
export const CLIENT_MODEL_REGISTRY: ClientModelEntry[] = [
  {
    id: 'riishe-chat-webllm-qwen2.5-0.5b',
    version: '1',
    sourceUrl: 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    revision: '32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad',
    license: 'Apache-2.0 (Qwen2.5-0.5B-Instruct; MLC build)',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct',
    runtime: 'web-llm',
    runtimeAvailable: () => runtimeAvailable('web-llm'),
    gpuCompatible: true,
    cpuCompatible: false,
    // vram_required_MB 944.62 from the pinned WebLLM 0.2.89 prebuilt model record.
    memoryEstimateMb: 945,
    // Measured: 289,693,824 bytes across 17 files (HF tree API, 2026-11-18).
    sizeBytes: 289_693_824,
    sizeUnverified: false,
    sha256: null,
    integrity: 'runtime-managed-pinned-revision',
    downloadPath: 'runtime-managed-cache',
    supportedTasks: ['chat.on-device'],
    limitations: [
      'WebGPU required (q4f16 weights) — no CPU/WASM fallback for this quantization; the server path is the honest fallback.',
      'Small on-device model: quality is far below the server-hosted chat model; retrieval, tools, memory and citations are NOT part of the on-device lane.',
      'Weights download once into the browser cache (WebLLM-managed) after explicit user approval; the pinned upstream revision is 32ff081f….',
    ],
    enabled: true,
  },
  {
    id: 'gangzii-asr-browser-whisper-tiny',
    version: '1',
    sourceUrl: 'https://huggingface.co/Xenova/whisper-tiny',
    revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
    license: 'Apache-2.0 (Whisper tiny, OpenAI; ONNX build by Xenova)',
    licenseUrl: 'https://huggingface.co/Xenova/whisper-tiny',
    runtime: 'transformers.js',
    runtimeAvailable: () => runtimeAvailable('transformers.js'),
    gpuCompatible: true,
    cpuCompatible: true,
    // Runtime + pipeline working set, labeled approximate (policy estimate).
    memoryEstimateMb: 500,
    // Measured q8 set: encoder q8 10,124,910 + decoder-merged q8 30,727,765 +
    // tokenizer 2,480,466 + configs 2,248/3,716/339/282,683 = 43,622,127 bytes.
    sizeBytes: 43_622_127,
    sizeUnverified: false,
    sha256: null,
    integrity: 'runtime-managed-pinned-revision',
    downloadPath: 'runtime-managed-cache',
    supportedTasks: ['audio.transcription.on-device'],
    limitations: [
      'Tiny multilingual Whisper: accuracy is far below the server ASR; long recordings are chunked at 30s.',
      'Weights download once into the Transformers.js browser cache after explicit user approval; pinned revision 5332fcc3….',
      'Audio never leaves the device — this lane exists for privacy, not for peak accuracy.',
    ],
    enabled: true,
  },
  {
    id: 'laxii-bgremoval-modnet',
    version: '1',
    // Pinned EXACT artifact (resolve/<revision>/onnx/model_quantized.onnx).
    sourceUrl: 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_quantized.onnx',
    revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
    license: 'Apache-2.0 (MODNet; ONNX build by Xenova)',
    licenseUrl: 'https://huggingface.co/Xenova/modnet',
    runtime: 'onnxruntime-web',
    runtimeAvailable: () => runtimeAvailable('onnxruntime-web'),
    gpuCompatible: true,
    cpuCompatible: true,
    memoryEstimateMb: 300, // policy estimate for the runtime + working buffers, labeled approximate
    // Measured: downloaded + sha256sum'd 2026-11-18 (6,632,188 bytes).
    sizeBytes: 6_632_188,
    sizeUnverified: false,
    sha256: '92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a',
    integrity: 'pinned-artifact-sha256',
    downloadPath: 'bean-managed-cache',
    supportedTasks: ['image.segmentation'],
    limitations: [
      'Requires an explicit user-approved download before first use (size shown before approval).',
      'Background removal via segmentation is a different algorithm than the LAXII server pipeline; results will differ.',
      'Runs through onnxruntime-web (WASM SIMD, WebGPU EP attempted first); the artifact must match the pinned SHA-256 or it is refused.',
    ],
    enabled: true,
  },
]

export class ModelRegistry {
  private readonly fetchFn: FetchLike
  private readonly cacheFactory: () => Promise<ModelCacheLike | null>
  private readonly digestFn: (bytes: Uint8Array) => Promise<string>
  private readonly storageEstimateFn: () => Promise<{ quotaBytes: number | null; usageBytes: number | null }>
  private readonly now: () => number
  private readonly installedAt = new Map<string, { bytes: number; verifiedAt: string }>()

  constructor(deps: ModelRegistryDeps = {}) {
    this.fetchFn =
      deps.fetchFn ??
      ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, init))
    this.cacheFactory =
      deps.cacheFactory ??
      (async () => {
        try {
          if (typeof caches === 'undefined') return null
          return (await caches.open(CACHE_NAME)) as unknown as ModelCacheLike
        } catch {
          return null
        }
      })
    this.digestFn =
      deps.digestFn ??
      (async (bytes) => {
        try {
          if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('WebCrypto unavailable')
          const digestTarget = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
          const hash = await crypto.subtle.digest('SHA-256', digestTarget)
          return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
        } catch {
          throw new Error('Integrity verification is unavailable in this context.')
        }
      })
    this.storageEstimateFn =
      deps.storageEstimate ??
      (async () => {
        try {
          const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> } }
          if (!nav.storage?.estimate) return { quotaBytes: null, usageBytes: null }
          const est = await nav.storage.estimate()
          return {
            quotaBytes: typeof est.quota === 'number' ? est.quota : null,
            usageBytes: typeof est.usage === 'number' ? est.usage : null,
          }
        } catch {
          return { quotaBytes: null, usageBytes: null }
        }
      })
    this.now = deps.now ?? (() => Date.now())
  }

  getEntry(id: string): ClientModelEntry | undefined {
    return CLIENT_MODEL_REGISTRY.find((m) => m.id === id)
  }

  /** Public metadata view (status surfaces) — honest, no fabricated sizes. */
  listPublic(): Array<{
    id: string
    version: string
    runtime: ClientModelRuntime
    runtimeAvailable: boolean
    gpuCompatible: boolean
    cpuCompatible: boolean
    sizeBytes: number | null
    sizeUnverified: boolean
    license: string
    revision: string | null
    integrity: ClientModelIntegrity
    downloadPath: ClientModelDownloadPath
    enabled: boolean
    supportedTasks: string[]
    limitations: string[]
  }> {
    return CLIENT_MODEL_REGISTRY.map((m) => ({
      id: m.id,
      version: m.version,
      runtime: m.runtime,
      runtimeAvailable: m.runtimeAvailable(),
      gpuCompatible: m.gpuCompatible,
      cpuCompatible: m.cpuCompatible,
      sizeBytes: m.sizeBytes,
      sizeUnverified: m.sizeUnverified,
      license: m.license,
      revision: m.revision,
      integrity: m.integrity,
      downloadPath: m.downloadPath,
      enabled: m.enabled,
      supportedTasks: m.supportedTasks,
      limitations: m.limitations,
    }))
  }

  /** Measure the real artifact size via a HEAD request. Never invents values. */
  async measureSize(id: string): Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }> {
    const entry = this.getEntry(id)
    if (!entry) return { ok: false, reason: 'Unknown model id.' }
    if (!isTrustedOrigin(entry.sourceUrl)) return { ok: false, reason: 'Model source is not a trusted HTTPS origin.' }
    try {
      const res = await this.fetchFn(entry.sourceUrl, { method: 'HEAD' })
      if (!res.ok) return { ok: false, reason: `Size probe failed (HTTP ${res.status}).` }
      const len = res.headers.get('content-length')
      const size = len !== null ? Number(len) : NaN
      if (!Number.isFinite(size) || size <= 0) {
        return { ok: false, reason: 'The source did not report a content length; size stays unverified.' }
      }
      entry.sizeBytes = size
      entry.sizeUnverified = false
      return { ok: true, sizeBytes: size }
    } catch (error) {
      return { ok: false, reason: `Size probe failed: ${error instanceof Error ? error.message : 'network error'}` }
    }
  }

  /**
   * Download a model with the full policy gate. `approval` must be an
   * EXPLICIT user decision made after the size was shown.
   */
  async requestDownload(
    id: string,
    options: { approval: boolean; signal?: AbortSignal; onProgress?: (fraction: number, note?: string) => void },
  ): Promise<ModelDownloadResult> {
    const started = this.now()
    const entry = this.getEntry(id)
    if (!entry) return { ok: false, code: 'REFUSED_NOT_ENABLED', reason: 'Unknown model id.' }
    if (entry.enabled !== true) {
      return { ok: false, code: 'REFUSED_NOT_ENABLED', reason: 'This model is not enabled for download (license/config gate).' }
    }
    // RUNTIME-MANAGED MODELS: their weights are fetched by WebLLM /
    // Transformers.js into their OWN caches. This BEAN-managed path refuses
    // them honestly rather than pretending to checksum-manage what it does
    // not checksum-manage (the runtime path uses pinned-revision integrity;
    // see ClientModelIntegrity).
    if (entry.downloadPath === 'runtime-managed-cache') {
      return {
        ok: false,
        code: 'REFUSED_RUNTIME_MANAGED',
        reason: 'This model is downloaded by its browser runtime (pinned upstream revision), not through this BEAN-managed checksum gate.',
      }
    }
    if (!entry.runtimeAvailable()) {
      return { ok: false, code: 'REFUSED_RUNTIME_UNAVAILABLE', reason: `The "${entry.runtime}" runtime is not available in this app.` }
    }
    if (options.approval !== true) {
      return { ok: false, code: 'REFUSED_APPROVAL_REQUIRED', reason: 'Explicit user approval is required before downloading a model.' }
    }
    if (!isTrustedOrigin(entry.sourceUrl)) {
      return { ok: false, code: 'REFUSED_NOT_ENABLED', reason: 'Model source is not a trusted HTTPS origin.' }
    }
    if (typeof entry.sha256 !== 'string' || entry.sha256.length !== 64) {
      return {
        ok: false,
        code: 'REFUSED_NO_INTEGRITY_METADATA',
        reason: 'No trusted SHA-256 checksum is configured for this model version; downloads are refused until an operator pins the real checksum.',
      }
    }

    // Storage quota gate — honest refusal before any bytes are fetched.
    const estimate = await this.storageEstimateFn()
    const sizeHint = entry.sizeBytes
    if (estimate.quotaBytes !== null && estimate.usageBytes !== null && sizeHint !== null) {
      const free = estimate.quotaBytes - estimate.usageBytes
      if (free - sizeHint < MIN_FREE_HEADROOM_BYTES) {
        return {
          ok: false,
          code: 'STORAGE_INSUFFICIENT',
          reason: 'Not enough browser storage for this model (a safety headroom is kept). Clear old models or use a smaller model.',
        }
      }
    }

    // Fetch with progress.
    let response: Response
    try {
      response = await this.fetchFn(entry.sourceUrl, { signal: options.signal })
    } catch (error) {
      if (isAbortError(error)) return { ok: false, code: 'FETCH_ABORTED', reason: 'The download was cancelled.' }
      return { ok: false, code: 'FETCH_FAILED', reason: 'The model download failed (network error).' }
    }
    if (!response.ok) return { ok: false, code: 'FETCH_FAILED', reason: `The model download failed (HTTP ${response.status}).` }
    if (!response.body) return { ok: false, code: 'FETCH_FAILED', reason: 'The download response had no readable body.' }

    const declared = Number(response.headers.get('content-length') ?? 'NaN')
    const chunks: Uint8Array[] = []
    let received = 0
    try {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.byteLength
          if (Number.isFinite(declared) && declared > 0) {
            options.onProgress?.(Math.min(0.95, received / declared), 'downloading model')
          }
        }
      }
    } catch (error) {
      if (isAbortError(error)) return { ok: false, code: 'FETCH_ABORTED', reason: 'The download was cancelled.' }
      return { ok: false, code: 'FETCH_FAILED', reason: 'The model download failed while reading the stream.' }
    }

    const bytes = concatChunks(chunks)
    options.onProgress?.(0.97, 'verifying checksum')

    // Integrity gate — a model becomes installed ONLY after checksum pass.
    let actual: string
    try {
      actual = await this.digestFn(bytes)
    } catch (error) {
      return { ok: false, code: 'CHECKSUM_FAILED', reason: error instanceof Error ? error.message : 'Integrity verification failed.' }
    }
    if (actual !== (entry.sha256 as string).toLowerCase()) {
      return { ok: false, code: 'CHECKSUM_FAILED', reason: 'The downloaded model did not match its configured checksum; it was not installed.' }
    }

    const cache = await this.cacheFactory()
    if (!cache) return { ok: false, code: 'FETCH_FAILED', reason: 'Browser model cache is unavailable; the model was not installed.' }
    try {
      await cache.put(cacheKey(entry), new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'x-bean-model': entry.id, 'x-bean-model-version': entry.version } }))
    } catch {
      return { ok: false, code: 'STORAGE_INSUFFICIENT', reason: 'Storing the model failed (the browser may have evicted storage); the model was not installed.' }
    }

    entry.sizeBytes = received
    entry.sizeUnverified = false
    this.installedAt.set(entry.id, { bytes: received, verifiedAt: new Date().toISOString() })
    options.onProgress?.(1, 'model installed')
    return { ok: true, modelId: entry.id, bytes: received, durationMs: this.now() - started }
  }

  /** Install state: verified cache hit required — never a bare claim. */
  async getInstallState(id: string): Promise<ModelInstallState> {
    const entry = this.getEntry(id)
    if (!entry) return { installed: false, reason: 'Unknown model id.' }
    const cache = await this.cacheFactory()
    if (!cache) return { installed: false, reason: 'Model cache unavailable.' }
    try {
      const res = await cache.match(cacheKey(entry))
      if (!res) return { installed: false, reason: 'Model not downloaded (or evicted by the browser).' }
      const metaOk = res.headers.get('x-bean-model') === entry.id && res.headers.get('x-bean-model-version') === entry.version
      if (!metaOk) return { installed: false, reason: 'Cached model metadata does not match this registry version.' }
      const bytes = Number(res.headers.get('content-length') ?? '0')
      return { installed: true, bytes: Number.isFinite(bytes) ? bytes : 0, verifiedAt: this.installedAt.get(id)?.verifiedAt ?? new Date(0).toISOString() }
    } catch {
      return { installed: false, reason: 'Model cache read failed.' }
    }
  }

  /**
   * Read the verified artifact bytes (bean-managed cache only). Runtime-
   * managed models are fetched by their own runtimes and return null here —
   * never a fabricated byte stream.
   */
  async getArtifact(id: string): Promise<Uint8Array | null> {
    const entry = this.getEntry(id)
    if (!entry || entry.downloadPath !== 'bean-managed-cache') return null
    const cache = await this.cacheFactory()
    if (!cache) return null
    try {
      const res = await cache.match(cacheKey(entry))
      if (!res) return null
      const metaOk = res.headers.get('x-bean-model') === entry.id && res.headers.get('x-bean-model-version') === entry.version
      if (!metaOk) return null
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  /** Delete a cached model (cache cleanup / user request). */
  async deleteModel(id: string): Promise<{ deleted: boolean }> {
    const entry = this.getEntry(id)
    if (!entry) return { deleted: false }
    const cache = await this.cacheFactory()
    if (!cache) return { deleted: false }
    try {
      const deleted = await cache.delete(cacheKey(entry))
      this.installedAt.delete(id)
      return { deleted }
    } catch {
      return { deleted: false }
    }
  }

  /** Ids currently verified-installed (used by sanitized reports). */
  async installedModelIds(): Promise<string[]> {
    const out: string[] = []
    for (const entry of CLIENT_MODEL_REGISTRY) {
      const state = await this.getInstallState(entry.id)
      if (state.installed) out.push(entry.id)
    }
    return out
  }
}

function cacheKey(entry: ClientModelEntry): string {
  return `${entry.id}@${entry.version}`
}

function isTrustedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'huggingface.co' || parsed.hostname.endsWith('.huggingface.co'))
  } catch {
    return false
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const out = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

let defaultRegistry: ModelRegistry | null = null
export function getDefaultModelRegistry(): ModelRegistry {
  if (!defaultRegistry) defaultRegistry = new ModelRegistry()
  return defaultRegistry
}
