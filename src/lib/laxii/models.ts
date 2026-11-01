/**
 * LAXII — model catalog and local hardware preflight (Phase 6).
 *
 * The catalog mirrors models/manifests/bean-image-selfhosted-diffusers.json
 * and docs/models/LAXII-ENGINE-DECISION-MATRIX.md. Only PUBLIC-SAFE fields
 * are exported to the API (no endpoints, no secrets).
 *
 * Honesty rules:
 *  - `enabled` for the generative worker is the REGISTRY flag — it flips only
 *    in code after a real inference acceptance test is recorded. A passing
 *    preflight alone never enables it.
 *  - `hardwarePreflight()` runs the real Python worker preflight and returns
 *    its measured report; if the worker cannot even start, that exact fact
 *    is the report.
 */
import { getBackend } from '@/lib/registry/backends'
import { workerPreflight, type PreflightReport } from './worker'

export interface ModelCatalogEntry {
  id: string
  role: string
  license: string
  commercialUse: string
  downloadSizeGb: number
  vramClassGb: number
  status: string
  notes?: string
}

const CATALOG: ModelCatalogEntry[] = [
  {
    id: 'sd15-inpaint',
    role: 'fast masked inpainting (Smart Edit), IP-Adapter host',
    license: 'CreativeML OpenRAIL-M',
    commercialUse: 'permitted-subject-to-use-restrictions',
    downloadSizeGb: 4.3,
    vramClassGb: 4,
    status: 'not-downloaded',
  },
  {
    id: 'sdxl-base-1.0',
    role: 'photorealistic generation, SDXL inpaint, PuLID host',
    license: 'CreativeML Open RAIL++-M License',
    commercialUse: 'permitted-subject-to-use-restrictions',
    downloadSizeGb: 6.9,
    vramClassGb: 10,
    status: 'not-downloaded',
  },
  {
    id: 'ip-adapter-h94-sd15',
    role: 'reference-guided generation (reference images)',
    license: 'Apache-2.0 (h94 re-release)',
    commercialUse: 'permitted',
    downloadSizeGb: 5.0,
    vramClassGb: 2,
    status: 'not-downloaded',
    notes: 'IP-Adapter-FaceID variants are non-commercial and excluded.',
  },
  {
    id: 'pulid-sdxl',
    role: 'face-identity conditioning (Creative Generate, opt-in)',
    license: 'Apache-2.0 code / SDXL-derived weights (OpenRAIL++-M terms)',
    commercialUse: 'permitted-subject-to-use-restrictions',
    downloadSizeGb: 3.5,
    vramClassGb: 4,
    status: 'not-downloaded',
  },
  {
    id: 'realesrgan-x4plus',
    role: 'optional model-based upscaling after deterministic Lanczos',
    license: 'BSD-3-Clause',
    commercialUse: 'permitted',
    downloadSizeGb: 0.07,
    vramClassGb: 1,
    status: 'not-downloaded',
  },
  {
    id: 'big-lama',
    role: 'object removal / large-mask structural inpaint',
    license: 'Apache-2.0',
    commercialUse: 'permitted',
    downloadSizeGb: 0.2,
    vramClassGb: 2,
    status: 'not-downloaded',
  },
  {
    id: 'face-detection-yunet',
    role: 'face-region detection for protection and the identity gate',
    license: 'MIT',
    commercialUse: 'permitted',
    downloadSizeGb: 0.001,
    vramClassGb: 0,
    status: 'not-downloaded',
  },
  {
    id: 'face-recognition-sface',
    role: 'identity similarity metric (drift gate)',
    license: 'MIT per model directory — provenance review pending',
    commercialUse: 'conditionally-permitted',
    downloadSizeGb: 0.04,
    vramClassGb: 0,
    status: 'not-downloaded',
    notes: 'Similarity scores are estimates, never proof of identical identity.',
  },
  {
    id: 'flux1-schnell',
    role: 'CANDIDATE fast text-to-image tier (never default)',
    license: 'Apache-2.0',
    commercialUse: 'permitted',
    downloadSizeGb: 23.8,
    vramClassGb: 24,
    status: 'candidate-only',
    notes: '12B params does not fit 16 GB at bf16; quantized options require a proven local preflight.',
  },
]

export function getModelCatalog(): ModelCatalogEntry[] {
  return CATALOG.map((m) => ({ ...m }))
}

export interface GenerativeWorkerStatus {
  registryEnabled: boolean
  unavailableReason: string | null
}

/** The registry flag is the single source of truth for enablement. */
export function generativeWorkerStatus(): GenerativeWorkerStatus {
  const backend = getBackend('bean-image-selfhosted-diffusers')
  return {
    registryEnabled: backend?.enabled ?? false,
    unavailableReason: backend && !backend.enabled ? backend.unavailableReason ?? null : null,
  }
}

export interface LocalPreflight {
  localEngine: { available: boolean; detail: string; latencyMs: number }
  generativeWorker: {
    registryEnabled: boolean
    preflight: PreflightReport | null
    error: string | null
  }
  /** Combined readiness: what CAN run right now, truthfully. */
  canRun: {
    textToImage: boolean // managed provider
    deterministicEnhancement: boolean // Sharp engine
    generativeEditing: boolean // worker (registry-enabled AND preflight-ok AND real test recorded)
  }
}

/**
 * Real local hardware preflight (mission §9). Runs the actual worker
 * process and the actual Sharp engine probe. No cached optimism: whatever
 * this returns is what the host can do right now.
 */
export async function localPreflight(): Promise<LocalPreflight> {
  const t0 = Date.now()
  let engineOk = false
  let engineDetail = ''
  try {
    const sharp = (await import('sharp')).default
    const probe = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8//8/AzGAiShVowoJAgCCTQMDzCTELAAAAABJRU5ErkJggg==',
      'base64',
    )
    // removeAlpha() makes the round-trip deterministic: the probe PNG is
    // RGBA, so a bare .raw() yields 4 channels (64 B) and the 3-channel
    // length check below false-negatived a working engine (measured
    // 2026-11-01, sharp 0.34.5; same fix as local-adapter.ts).
    const out = await sharp(probe).resize(4, 4).removeAlpha().raw().toBuffer()
    engineOk = out.length === 4 * 4 * 3
    engineDetail = `Sharp engine probe ${engineOk ? 'completed' : 'produced unexpected output'} in ${Date.now() - t0}ms (8x8 decode → 4x4 raw RGB).`
  } catch (e) {
    engineDetail = `Sharp engine probe FAILED: ${e instanceof Error ? e.message : String(e)}`
  }

  const worker = generativeWorkerStatus()
  let preflight: PreflightReport | null = null
  let workerError: string | null = null
  try {
    preflight = await workerPreflight()
  } catch (e) {
    workerError = e instanceof Error ? e.message : String(e)
  }
  const preflightOk = preflight?.ok === true
  return {
    localEngine: { available: engineOk, detail: engineDetail, latencyMs: Date.now() - t0 },
    generativeWorker: {
      registryEnabled: worker.registryEnabled,
      preflight,
      error: workerError,
    },
    canRun: {
      textToImage: true, // managed provider (its own live probe is /api/health)
      deterministicEnhancement: engineOk,
      // NOTE: registryEnabled is the code-gated flag that only flips after a
      // recorded real inference test. Preflight success alone cannot enable.
      generativeEditing: worker.registryEnabled && preflightOk,
    },
  }
}
