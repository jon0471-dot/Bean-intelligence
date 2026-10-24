import { handle, ok } from '@/lib/api/errors'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { getBackendsForProduct } from '@/lib/registry/backends'

/**
 * Liveness (this process) + readiness (real backend probes).
 * Readiness results are MEASURED, never assumed — a backend whose probe
 * fails reports unhealthy here and the admin UI shows the same evidence.
 */
export async function GET() {
  return handle(async () => {
    const [llm, image] = await Promise.all([
      hostedLlmAdapter.health(),
      hostedImageAdapter.health(),
    ])

    const videoBackend = getBackendsForProduct('jazmii')[0]

    return ok({
      service: 'bean-intelligence',
      version: '1.0.0',
      live: true,
      time: new Date().toISOString(),
      products: {
        riishe: { available: llm.healthy, probe: llm },
        laxii: { available: image.healthy, probe: image },
        jazmii: {
          available: false,
          probe: {
            healthy: false,
            checkedAt: new Date().toISOString(),
            latencyMs: null,
            detail: videoBackend?.unavailableReason ?? 'No backend configured.',
          },
        },
        'code-giftz': { available: llm.healthy, probe: llm },
      },
    })
  })
}
