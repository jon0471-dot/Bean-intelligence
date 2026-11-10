/**
 * LAXII — Diffusers worker adapter (bean-image-selfhosted-diffusers).
 *
 * health() runs the REAL Python worker preflight (spawn → JSON protocol →
 * measured report). It reports honestly on any host:
 *   - here (no GPU/torch): ok:false with the exact missing items;
 *   - on the GPU host before enablement: preflight may pass, but the
 *     REGISTRY flag still gates traffic — a passing preflight is necessary,
 *     never sufficient. Enablement happens only in code after a recorded
 *     real inference test (see registry unavailableReason).
 *
 * The optional generateImage method exists so that, when the registry flag
 * is enabled after acceptance testing, the router can serve text-to-image
 * from the worker without any contract change.
 */
import type { HealthReport, ImageRequest, ImageResult, TaskAdapter } from '@/lib/adapters/types'
import { getBackend } from '@/lib/registry/backends'
import { workerPreflight, workerRequest, type PreflightReport } from './worker'

export const diffusersWorkerAdapter: TaskAdapter = {
  backendId: 'bean-image-selfhosted-diffusers',

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    const checkedAt = new Date().toISOString()
    const registry = getBackend('bean-image-selfhosted-diffusers')
    let preflight: PreflightReport | null = null
    try {
      preflight = await workerPreflight()
    } catch (e) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - t0,
        detail: `Diffusers worker UNREACHABLE: ${e instanceof Error ? e.message : String(e)}. ${
          registry?.enabled ? 'The registry enables this backend, so this is an operational fault.' : 'Generative editing remains disabled (expected — no verified deployment yet).'
        }`,
      }
    }
    const missing = preflight.missingPackages.join(', ') || 'none'
    const vram = preflight.cuda.vramFreeGb
    if (!preflight.ok) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - t0,
        detail: `Diffusers worker preflight NOT satisfied on this host: missing packages [${missing}], CUDA ${
          preflight.cuda.available ? 'available' : 'unavailable'
        }${vram != null ? `, ${vram} GB VRAM free` : ''}, disk ${
          preflight.disk.freeGb ?? '?'
        } GB free, checkpoints present ${
          preflight.models.filter((m) => m.present).length
        }/${preflight.models.length}. Registry-enabled: ${registry?.enabled ?? false}. Generative editing is unavailable.`,
      }
    }
    // Preflight passed. Only the registry gate decides traffic.
    if (!registry?.enabled) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: Date.now() - t0,
        detail: `Diffusers worker preflight PASSES on this host (CUDA ${preflight.cuda.device ?? 'n/a'}, ${vram} GB free) but the backend is NOT registry-enabled: ${registry?.unavailableReason ?? 'awaiting a recorded real inference acceptance test'}. No traffic is routed to it.`,
      }
    }
    return {
      healthy: true,
      checkedAt,
      latencyMs: Date.now() - t0,
      detail: `Diffusers worker preflight passed and backend is registry-enabled (${preflight.cuda.device}, ${vram} GB VRAM free, all checkpoints present). Capability evidence: recorded acceptance test in worklog.md.`,
    }
  },

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    if (getBackend('bean-image-selfhosted-diffusers')?.enabled !== true) {
      throw new Error(
        'PROVIDER_UNAVAILABLE: the local Diffusers worker is not registry-enabled; no inference is performed.',
      )
    }
    const result = await workerRequest(
      'txt2img',
      {
        prompt: req.prompt,
        width: parseInt(req.size.split('x')[0], 10) || 1024,
        height: parseInt(req.size.split('x')[1], 10) || 1024,
      },
      { timeoutMs: req.timeoutMs },
    )
    const images = result.images as string[] | undefined
    if (!images?.length) throw new Error('Worker returned no image payload')
    const bytes = Buffer.from(images[0], 'base64')
    const [w, h] = req.size.split('x').map((n) => parseInt(n, 10))
    return { bytes, width: w, height: h, format: 'jpeg', durationMs: (result as { durationMs?: number }).durationMs ?? 0 }
  },
}
