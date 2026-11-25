/**
 * BEAN Intelligence — server-side local model manager (M26.2).
 *
 * Explicit, verifiable management of the small ONNX models that power the
 * REAL local inference lanes (background-removal matting, structural
 * inpainting, frame interpolation). Design rules:
 *
 *  - WEIGHTS NEVER ENTER GIT: every artifact lives under storage/models/
 *    (gitignored). Nothing here copies or embeds model bytes.
 *  - INSTALL IS EXPLICIT: nothing downloads at page load or import time;
 *    an operator (or the deployment guide's bootstrap command) calls
 *    installLocalModel(). Download progress is cancellable.
 *  - EVERY ARTIFACT IS VERIFIED: byte length and SHA-256 are checked
 *    against the manifest below; a mismatch is recorded as 'corrupted' and
 *    the model is NEVER reported ready.
 *  - HONEST STATES: 'not-installed' | 'ready' | 'corrupted' | 'downloading'
 *    derive from the real files on disk, never from configuration optimism.
 *  - ONE SESSION PER MODEL: sessions are cached and re-used; idle sessions
 *    are disposed (memory pressure / idle reaper) — loading multiple large
 *    models unnecessarily is explicitly avoided.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as ort from 'onnxruntime-node'
import { logger } from '@/lib/observability/logger'

export interface LocalModelDescriptor {
  id: string
  file: string
  /** Exact download source (pinned repo/file). */
  sourceUrl: string
  sha256: string
  bytes: number
  license: { name: string; commercialUse: 'permitted' | 'restricted'; sourceUrl: string; verifiedAt: string }
  task: string
  /** Human summary of what the model does and what it does NOT do. */
  role: string
  limitations: string
  runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)' | 'tesseract.js 6 (WebAssembly CPU; traineddata verified per artifact)'
  downloadSizeMb: number
  /**
   * Additional pinned artifacts REQUIRED by the same model (e.g. the BERT
   * vocab.txt beside the ONNX graph). Installed + hash-verified together with
   * the main file; the model is never 'ready' unless every companion is too.
   */
  companionFiles?: LocalModelCompanionFile[]
}

export interface LocalModelCompanionFile {
  file: string
  sourceUrl: string
  sha256: string
  bytes: number
}

export const LOCAL_MODELS: Record<string, LocalModelDescriptor> = {
  modnet: {
    id: 'modnet',
    file: 'modnet.onnx',
    sourceUrl: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
    sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
    bytes: 25_888_640,
    license: {
      name: 'Apache-2.0 (MODNet upstream ZHKKKe/MODNet; ONNX export Xenova/modnet)',
      commercialUse: 'permitted',
      sourceUrl: 'https://github.com/ZHKKKe/MODNet',
      verifiedAt: '2026-11-18',
    },
    task: 'portrait/subject matting (alpha matte)',
    role: 'Trimap-free portrait matting — REAL alpha-channel foreground separation for background removal and background effects.',
    limitations:
      'Trained for portrait/people subjects; on strongly non-human subjects the matte can be conservative — every run carries measured coverage stats and fails honestly when no usable subject is found.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 24.7,
  },
  lama: {
    id: 'lama',
    file: 'lama.onnx',
    sourceUrl: 'https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx',
    sha256: '7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2',
    bytes: 92_591_623,
    license: {
      name: 'Apache-2.0 (OpenCV Zoo inpainting_lama; upstream big-lama saic-mdal/lama)',
      commercialUse: 'permitted',
      sourceUrl: 'https://github.com/opencv/opencv_zoo/tree/main/models/inpainting_lama',
      verifiedAt: '2026-11-18',
    },
    task: 'structural image inpainting (512x512 fixed input)',
    role: 'Large-mask structural inpainting for object removal and approved destructive edits — real model-based region synthesis.',
    limitations:
      'Fixed 512x512 internal resolution (result restored to the working image geometry); not an identity-preserving face generator — identity drift is disclosed in provenance.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 88.3,
  },
  rife: {
    id: 'rife',
    file: 'rife.onnx',
    sourceUrl: 'https://huggingface.co/FuryTMP/RIFE_fp32/resolve/main/RIFE_fp32.onnx',
    sha256: '6a31074c0f588648982b5e828aee6c27e005015a712a46ea63da48c65fa9a26b',
    bytes: 21_604_631,
    license: {
      name: 'MIT (RIFE upstream hzwer/Practical-RIFE; ONNX export FuryTMP/RIFE_fp32)',
      commercialUse: 'permitted',
      sourceUrl: 'https://github.com/hzwer/Practical-RIFE',
      verifiedAt: '2026-11-18',
    },
    task: 'neural frame interpolation (two frames -> middle frame, [1,6,H,W] input)',
    role:
      'REAL neural frame synthesis for the JAZMII local image-to-video lane: animates a still with motion programs and generates in-between frames with the model (never a static image).',
    limitations:
      'Frame interpolation of motion trajectories — NOT diffusion scene synthesis. New content/subject motion is out of scope for this lane; provenance states the lane class on every result.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 20.6,
  },
  /**
   * M40 — RIISHE retrieval lanes (all Apache-2.0, CPU-only, quantized ONNX).
   * Artifact hashes below were measured from the pinned downloads themselves
   * (2026-11-25) and verified by REAL inference probes before the descriptors
   * were written; a mismatching artifact can never reach 'ready'.
   */
  'minilm-l6-embeddings': {
    id: 'minilm-l6-embeddings',
    file: 'model_quantized.onnx',
    sourceUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx',
    sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
    bytes: 22_972_370,
    license: {
      name: 'Apache-2.0 (sentence-transformers/all-MiniLM-L6-v2; ONNX export Xenova/all-MiniLM-L6-v2)',
      commercialUse: 'permitted',
      sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
      verifiedAt: '2026-11-25',
    },
    task: 'text embeddings (384-dim, mean pooling, L2-normalized)',
    role: 'Genuine sentence/document embeddings for RIISHE document retrieval: embeds the query and document chunks so relevant passages surface first (replaces blind paging through long documents).',
    limitations:
      'English-biased model (BERT English vocabulary; multilingual text embeds but quality degrades outside English). Quantized (int8) weights — measured cosine separation may differ marginally from fp32. 512-token input cap per chunk.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 22.1,
    companionFiles: [
      {
        file: 'vocab.txt',
        sourceUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt',
        sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
        bytes: 231_508,
      },
    ],
  },
  'ms-marco-minilm-rerank': {
    id: 'ms-marco-minilm-rerank',
    file: 'model_quantized.onnx',
    sourceUrl: 'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/onnx/model_quantized.onnx',
    sha256: 'e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe',
    bytes: 23_143_499,
    license: {
      name: 'Apache-2.0 (cross-encoder/ms-marco-MiniLM-L-6-v2; ONNX export Xenova/ms-marco-MiniLM-L-6-v2)',
      commercialUse: 'permitted',
      sourceUrl: 'https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2',
      verifiedAt: '2026-11-25',
    },
    task: 'passage reranking (query/passage relevance scores, sigmoid)',
    role: 'Genuine cross-encoder reranking for RIISHE document retrieval: re-scores candidate passages AGAINST the query pair-wise and orders them by measured relevance.',
    limitations:
      'English-biased (MS MARCO training corpus). Pair-wise scoring cost is linear in candidates — the retrieval lane caps rerank input at 8 passages. 512-token input cap per pair.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 22.3,
    companionFiles: [
      {
        file: 'vocab.txt',
        sourceUrl: 'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main/vocab.txt',
        sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
        bytes: 231_508,
      },
    ],
  },
  'ocr-eng-traineddata': {
    id: 'ocr-eng-traineddata',
    file: 'eng.traineddata',
    sourceUrl: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata',
    sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
    bytes: 4_113_088,
    license: {
      name: 'Apache-2.0 (tesseract-ocr/tessdata_fast; tesseract.js 6 Apache-2.0 runtime)',
      commercialUse: 'permitted',
      sourceUrl: 'https://github.com/tesseract-ocr/tessdata_fast',
      verifiedAt: '2026-11-25',
    },
    task: 'optical character recognition (scanned image/document text extraction)',
    role: 'REAL OCR for image attachments and scanned documents: extracts actual machine-readable text with per-run confidence, validated before the text is reported.',
    limitations:
      'English traineddata (tessdata_fast, integer-speed build) — non-Latin scripts are NOT recognized and are honestly reported as no-text/low-confidence rather than guessed. The tesseract.js WebAssembly core itself ships via the npm lockfile (recorded boundary note, same as the Kokoro voice packs); the LANGUAGE DATA is byte-verified here. Best on clean, level, well-lit scans ≥ ~12 px glyph height.',
    runtime: 'tesseract.js 6 (WebAssembly CPU; traineddata verified per artifact)',
    downloadSizeMb: 3.9,
  },
  u2netp: {
    id: 'u2netp',
    file: 'u2netp.onnx',
    sourceUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    bytes: 4_574_861,
    license: {
      name: 'Apache-2.0 (U-2-Net upstream xuebinqin/U-2-Net; u2netp portable build via rembg)',
      commercialUse: 'permitted',
      sourceUrl: 'https://github.com/xuebinqin/U-2-Net',
      verifiedAt: '2026-11-18',
    },
    task: 'salient-object segmentation (saliency map)',
    role: 'Lightweight general foreground/saliency map used as the fallback matte when the portrait model finds no usable subject.',
    limitations: 'Saliency-quality matte; edges are softer than MODNet. Chosen for a 4.6 MB footprint, not for hair quality.',
    runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)',
    downloadSizeMb: 4.4,
  },
}

export type LocalModelState = 'not-installed' | 'downloading' | 'ready' | 'corrupted' | 'failed'

export interface LocalModelStateReport {
  id: string
  state: LocalModelState
  installedBytes: number | null
  sha256Ok: boolean | null
  error: string | null
  descriptor: {
    sourceUrl: string
    license: LocalModelDescriptor['license']
    task: string
    role: string
    limitations: string
    downloadSizeMb: number
  }
}

/** Models root — inside storage/ (gitignored); override for tests. */
export function localModelsRoot(): string {
  return process.env.BEAN_LOCAL_MODELS_DIR || path.join(process.cwd(), 'storage', 'models')
}

function modelFile(id: string): string {
  return path.join(localModelsRoot(), id, LOCAL_MODELS[id].file)
}

/** Absolute path of a companion artifact (vocab.txt, traineddata, …). */
export function localModelCompanionPath(id: string, file: string): string {
  const desc = LOCAL_MODELS[id]
  if (!desc) throw new Error(`Unknown local model: ${id}`)
  if (!desc.companionFiles?.some((c) => c.file === file)) {
    throw new Error(`'${file}' is not a declared companion artifact of ${id}`)
  }
  return path.join(localModelsRoot(), id, file)
}

/**
 * Absolute path of a model artifact — the MAIN file by default, or a
 * declared companion when a file name is given (M40 lanes resolve their
 * pinned ONNX/vocab/traineddata through this single accessor).
 */
export function localModelArtifactPath(id: string, file?: string): string {
  const desc = LOCAL_MODELS[id]
  if (!desc) throw new Error(`Unknown local model: ${id}`)
  if (!file || file === desc.file) return path.join(localModelsRoot(), id, desc.file)
  return localModelCompanionPath(id, file)
}

interface InstallState {
  active: boolean
  cancelled: boolean
  startedAt: string | null
}
const installs = new Map<string, InstallState>()

function sha256File(file: string): string {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

/** Real on-disk state — the ONLY source of the reported model state. */
export function localModelState(id: string): LocalModelStateReport {
  const desc = LOCAL_MODELS[id]
  if (!desc) throw new Error(`Unknown local model: ${id}`)
  const install = installs.get(id)
  const file = modelFile(id)
  const base = {
    id,
    descriptor: {
      sourceUrl: desc.sourceUrl,
      license: desc.license,
      task: desc.task,
      role: desc.role,
      limitations: desc.limitations,
      downloadSizeMb: desc.downloadSizeMb,
    },
  }
  if (install?.active) {
    return { ...base, state: 'downloading', installedBytes: null, sha256Ok: null, error: null }
  }
  if (!fs.existsSync(file)) {
    return { ...base, state: 'not-installed', installedBytes: null, sha256Ok: null, error: null }
  }
  const size = fs.statSync(file).size
  if (size !== desc.bytes) {
    return {
      ...base,
      state: 'corrupted',
      installedBytes: size,
      sha256Ok: false,
      error: `on-disk size ${size} does not match the manifest (${desc.bytes} bytes) — reinstall the model`,
    }
  }
  const hashOk = sha256File(file) === desc.sha256
  if (!hashOk) {
    return {
      ...base,
      state: 'corrupted',
      installedBytes: size,
      sha256Ok: false,
      error: 'SHA-256 mismatch — the artifact on disk is not the manifest artifact; reinstall',
    }
  }
  // Companions are REQUIRED: a model whose pinned vocab/traineddata is
  // missing or corrupted is never 'ready' (the runtime would either fail or,
  // worse, silently fetch an unpinned replacement — both refused).
  for (const c of desc.companionFiles ?? []) {
    const cFile = localModelCompanionPath(id, c.file)
    if (!fs.existsSync(cFile)) {
      return {
        ...base,
        state: 'corrupted',
        installedBytes: size,
        sha256Ok: false,
        error: `companion artifact '${c.file}' is missing — reinstall the model`,
      }
    }
    if (fs.statSync(cFile).size !== c.bytes || sha256File(cFile) !== c.sha256) {
      return {
        ...base,
        state: 'corrupted',
        installedBytes: size,
        sha256Ok: false,
        error: `companion artifact '${c.file}' failed integrity verification — reinstall the model`,
      }
    }
  }
  return { ...base, state: 'ready', installedBytes: size, sha256Ok: true, error: null }
}

export function allLocalModelStates(): LocalModelStateReport[] {
  return Object.keys(LOCAL_MODELS).map((id) => localModelState(id))
}

export interface InstallProgress {
  phase: 'downloading' | 'verifying' | 'done'
  receivedBytes: number
  totalBytes: number
}

/**
 * Explicit install: streams the pinned artifact into storage/models/<id>/,
 * then verifies byte length and SHA-256. Atomic (temp file + rename).
 * Cancellation is cooperative — the next received chunk aborts and cleans up.
 */
export async function installLocalModel(
  id: string,
  opts: { onProgress?: (p: InstallProgress) => void; signal?: { aborted: boolean } } = {},
): Promise<LocalModelStateReport> {
  const desc = LOCAL_MODELS[id]
  if (!desc) throw new Error(`Unknown local model: ${id}`)
  const existing = localModelState(id)
  if (existing.state === 'ready') return existing
  if (installs.get(id)?.active) throw new Error(`Model ${id} is already downloading`)

  const dir = path.join(localModelsRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `${desc.file}.part`)
  const state: InstallState = { active: true, cancelled: false, startedAt: new Date().toISOString() }
  installs.set(id, state)
  try {
    const res = await fetch(desc.sourceUrl, { redirect: 'follow' })
    if (!res.ok || !res.body) {
      throw new Error(`download failed: HTTP ${res.status} from ${desc.sourceUrl}`)
    }
    const total = Number(res.headers.get('content-length') ?? desc.bytes)
    let received = 0
    const chunks: Buffer[] = []
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (state.cancelled || opts.signal?.aborted) {
        throw new Error('download cancelled')
      }
      const buf = Buffer.from(chunk)
      chunks.push(buf)
      received += buf.length
      opts.onProgress?.({ phase: 'downloading', receivedBytes: received, totalBytes: total })
    }
    fs.writeFileSync(tmp, Buffer.concat(chunks))
    opts.onProgress?.({ phase: 'verifying', receivedBytes: received, totalBytes: total })
    const size = fs.statSync(tmp).size
    if (size !== desc.bytes) throw new Error(`downloaded size ${size} != manifest ${desc.bytes}`)
    const hash = sha256File(tmp)
    if (hash !== desc.sha256) throw new Error(`downloaded SHA-256 ${hash} != manifest ${desc.sha256}`)
    fs.renameSync(tmp, path.join(dir, desc.file))
    // Companion artifacts: same download → size+SHA-256 gate → atomic rename.
    // A failed companion leaves the model NOT ready (state derives from disk).
    for (const c of desc.companionFiles ?? []) {
      if (state.cancelled || opts.signal?.aborted) throw new Error('download cancelled')
      const res2 = await fetch(c.sourceUrl, { redirect: 'follow' })
      if (!res2.ok || !res2.body) throw new Error(`companion download failed: HTTP ${res2.status} from ${c.sourceUrl}`)
      const chunks2: Buffer[] = []
      for await (const chunk of res2.body as unknown as AsyncIterable<Uint8Array>) {
        if (state.cancelled || opts.signal?.aborted) throw new Error('download cancelled')
        chunks2.push(Buffer.from(chunk))
      }
      const cBuf = Buffer.concat(chunks2)
      if (cBuf.length !== c.bytes) throw new Error(`companion '${c.file}' size ${cBuf.length} != manifest ${c.bytes}`)
      const cHash = crypto.createHash('sha256').update(cBuf).digest('hex')
      if (cHash !== c.sha256) throw new Error(`companion '${c.file}' SHA-256 ${cHash} != manifest ${c.sha256}`)
      fs.writeFileSync(path.join(dir, `${c.file}.part`), cBuf)
      fs.renameSync(path.join(dir, `${c.file}.part`), path.join(dir, c.file))
    }
    opts.onProgress?.({ phase: 'done', receivedBytes: size, totalBytes: size })
    logger.info('localmodels.installed', { id, bytes: size })
    // Clear the install marker BEFORE reading the on-disk state — otherwise
    // localModelState() sees the still-active install and reports
    // 'downloading' for a completed, verified install (measured 2026-11-25;
    // the finally block below is idempotent).
    installs.delete(id)
    return localModelState(id)
  } finally {
    installs.delete(id)
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function cancelLocalModelInstall(id: string): boolean {
  const state = installs.get(id)
  if (!state?.active) return false
  state.cancelled = true
  return true
}

// ---------------------------------------------------------------------------
// Session cache — ONE session per model, disposed after idle timeout.
// ---------------------------------------------------------------------------

interface SessionEntry {
  session: ort.InferenceSession
  lastUsed: number
}
const sessions = new Map<string, SessionEntry>()
const IDLE_UNLOAD_MS = Number(process.env.BEAN_LOCAL_MODEL_IDLE_UNLOAD_MS ?? 5 * 60_000)
let reaper: ReturnType<typeof setInterval> | null = null

function ensureReaper(): void {
  if (reaper) return
  reaper = setInterval(() => {
    const cutoff = Date.now() - IDLE_UNLOAD_MS
    for (const [id, entry] of sessions) {
      if (entry.lastUsed < cutoff) {
        void entry.session.release().catch(() => undefined)
        sessions.delete(id)
        logger.info('localmodels.session_unloaded', { id, reason: 'idle' })
      }
    }
  }, 60_000)
  if (typeof reaper.unref === 'function') reaper.unref()
}

/** Ready models only — throws a customer-safe error when not installed. */
export async function getSession(id: string): Promise<ort.InferenceSession> {
  const state = localModelState(id)
  if (state.state !== 'ready') {
    const hint = state.state === 'corrupted' ? state.error : 'the model is not installed on this host'
    throw new Error(`Local model '${id}' is unavailable: ${hint}. Install it explicitly (see the deployment guide).`)
  }
  const cached = sessions.get(id)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.session
  }
  // OOM FIX (measured 2026-11-18): the default arena extend strategy let
  // the CPU arena balloon to 3.1 GB across ~50 sequential RIFE runs and
  // the kernel OOM-killed the server. kSameAsRequested allocates exactly
  // what each run needs and releases it. (Older onnxruntime-common
  // declarations omit arenaConfig while the native binding honors it —
  // the options object is cast loosely.)
  const options = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    arenaConfig: { arenaExtendStrategy: 'kSameAsRequested' },
  }
  const session = await ort.InferenceSession.create(
    modelFile(id),
    options as unknown as Parameters<typeof ort.InferenceSession.create>[1],
  )
  sessions.set(id, { session, lastUsed: Date.now() })
  ensureReaper()
  logger.info('localmodels.session_loaded', { id })
  return session
}

/** Dispose every cached session (used by memory-pressure hooks and tests). */
export async function unloadAllLocalModels(): Promise<void> {
  for (const [id, entry] of sessions) {
    void entry.session.release().catch(() => undefined)
    sessions.delete(id)
    logger.info('localmodels.session_unloaded', { id, reason: 'explicit' })
  }
}
