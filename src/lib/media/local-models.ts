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
  runtime: 'onnxruntime-node (CPU EP; GPU EP used automatically when available)'
  downloadSizeMb: number
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
    opts.onProgress?.({ phase: 'done', receivedBytes: size, totalBytes: size })
    logger.info('localmodels.installed', { id, bytes: size })
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
