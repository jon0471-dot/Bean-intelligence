/**
 * LAXII — capability-aware provider selection (Phase 6).
 *
 * Semantics of LAXII_PROVIDER (docs/architecture/LAXII-PRESERVATION-ENGINE.md):
 *   - 'auto' (default):
 *       * text-to-image      → managed provider (bean-image-hosted-primary)
 *       * deterministic work → local Sharp engine (bean-image-local-sharp)
 *       * generative editing → local Diffusers worker, ONLY if the registry
 *         entry is enabled (code-gated on a recorded real inference test).
 *         Otherwise: truthful PROVIDER_UNAVAILABLE error. The managed
 *         provider is NEVER used as a silent substitute for masked editing
 *         (it has no img2img path and would violate preservation).
 *   - 'diffusers': generative work must use the worker; same truthful error
 *     when it is not enabled. Text-to-image still honors the worker-if-
 *     enabled-else-managed order only for CREATIVE generate; masked edit
 *     ops always require the worker.
 */
import { getBackend } from '@/lib/registry/backends'
import { BeanApiError } from '@/lib/api/errors'

export type LaxiiOp =
  | 'text-to-image'
  | 'deterministic-enhance'
  | 'masked-inpaint'
  | 'reference-guided'
  | 'identity-generate'
  | 'object-removal'
  | 'model-upscale'

export type LaxiiProviderChoice = 'managed' | 'local-engine' | 'diffusers-worker'

export function providerSetting(): 'auto' | 'diffusers' {
  const raw = (process.env.LAXII_PROVIDER || 'auto').toLowerCase()
  return raw === 'diffusers' ? 'diffusers' : 'auto'
}

function workerEnabled(): boolean {
  return getBackend('bean-image-selfhosted-diffusers')?.enabled === true
}

/**
 * Resolve which provider executes this operation. Throws a customer-safe
 * BeanApiError when the required provider is not genuinely available.
 */
export function resolveProvider(op: LaxiiOp): LaxiiProviderChoice {
  switch (op) {
    case 'deterministic-enhance':
      return 'local-engine'
    case 'text-to-image': {
      if (providerSetting() === 'diffusers' && workerEnabled()) return 'diffusers-worker'
      return 'managed'
    }
    case 'masked-inpaint':
    case 'reference-guided':
    case 'identity-generate':
    case 'object-removal':
    case 'model-upscale': {
      if (!workerEnabled()) {
        const reason =
          getBackend('bean-image-selfhosted-diffusers')?.unavailableReason ??
          'The local Diffusers worker is not deployed.'
        throw new BeanApiError(
          'PROVIDER_UNAVAILABLE',
          `This editing capability requires local generative models, which are not operational yet. ${reason} Your image was not modified.`,
        )
      }
      return 'diffusers-worker'
    }
    default: {
      const exhaustive: never = op
      throw new Error(`Unknown LAXII operation: ${String(exhaustive)}`)
    }
  }
}

/** Task key used by the router/preflight for a given op. */
export function taskForOp(op: LaxiiOp): 'image-generation' | 'image-enhancement' | 'image-editing' {
  switch (op) {
    case 'text-to-image':
      return 'image-generation'
    case 'deterministic-enhance':
      return 'image-enhancement'
    default:
      return 'image-editing'
  }
}

export interface ProviderDescriptor {
  backendId: 'bean-image-hosted-primary' | 'bean-image-local-sharp' | 'bean-image-selfhosted-diffusers'
  provider: LaxiiProviderChoice
}

export function backendForChoice(choice: LaxiiProviderChoice): ProviderDescriptor['backendId'] {
  switch (choice) {
    case 'managed':
      return 'bean-image-hosted-primary'
    case 'local-engine':
      return 'bean-image-local-sharp'
    case 'diffusers-worker':
      return 'bean-image-selfhosted-diffusers'
  }
}
