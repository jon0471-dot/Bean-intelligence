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

export type ClientModelRuntime = 'onnxruntime-web' | 'transformers.js' | 'wasm-binary' | 'custom'

export interface ClientModelEntry {
  id: string
  version: string
  /** Trusted source origin (HTTPS). Downloads from any other origin are refused. */
  sourceUrl: string
  /** Human-readable license identity. `verify-before-distribute` means the
   * upstream license must be reviewed before the entry may be enabled. */
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
  /** Trusted SHA-256 of the exact artifact. null ⇒ downloads are refused. */
  sha256: string | null
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
 * Sizes and checksums stay null until measured/pinned; nothing is invented.
 */
export const CLIENT_MODEL_REGISTRY: ClientModelEntry[] = [
  {
    id: 'laxii-bgremoval-modnet',
    version: '1',
    sourceUrl: 'https://huggingface.co/Xenova/modnet',
    license: 'verify-before-distribute',
    licenseUrl: 'https://huggingface.co/Xenova/modnet',
    runtime: 'onnxruntime-web',
    runtimeAvailable: () => runtimeAvailable('onnxruntime-web'),
    gpuCompatible: true,
    cpuCompatible: true,
    memoryEstimateMb: 300, // policy estimate for the runtime + working buffers, labeled approximate
    sizeBytes: null,
    sizeUnverified: true,
    sha256: null,
    supportedTasks: ['image.segmentation'],
    limitations: [
      'Requires an explicit user-approved download before first use.',
      'Download stays refused until a trusted SHA-256 checksum is configured for this model version.',
      'Background removal via segmentation is a different algorithm than the LAXII server pipeline; results will differ.',
    ],
    enabled: false,
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
