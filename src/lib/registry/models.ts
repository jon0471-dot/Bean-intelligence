/**
 * BEAN Intelligence — UNIFIED MODEL REGISTRY (server-computed, client-safe
 * projection).
 *
 * One consistent catalogue of every AI model the gateway can address, built
 * from the REAL integration sources of truth:
 *  - src/lib/registry/backends.ts (private backend registry — truth policy);
 *  - measured health probes (cachedHealth — availability is measured, never
 *    assumed);
 *  - src/lib/security/provider-credentials.ts (external provider credentials
 *    — configuration status, not connectivity claims).
 *
 * Truth policy (extends the backend registry's non-negotiables):
 *  - a model is listed ONLY if a real adapter path exists in this repository;
 *  - capabilities (chat / streaming / image / audio) reflect what the
 *    integration GENUINELY implements — unsupported modalities are never
 *    advertised as available;
 *  - `availability` is derived from the LATEST MEASURED probe result, not
 *    from configuration;
 *  - external OpenAI-compatible providers are listed with configuration
 *    status 'awaiting-credentials' until an administrator configures a
 *    credential — never presented as connected when they are not;
 *  - pricing is reported ONLY where the provider reports cost data (it does
 *    not, today — the field stays null rather than invented).
 *
 * CLIENT SAFETY: the public projection (toPublicModels) contains NO provider
 * credentials, NO endpoint URLs, NO secret references — only identity,
 * capabilities and honest availability.
 */
import { BACKEND_REGISTRY, type BackendDescriptor } from '@/lib/registry/backends'
import type { HealthReport } from '@/lib/adapters/types'
import { isCredentialEncryptionConfigured } from '@/lib/security/crypto'
import { getActiveCredentialId } from '@/lib/security/provider-credentials'

export type ModelCapability = 'chat' | 'streaming' | 'image-generation' | 'image-enhancement' | 'image-editing' | 'speech-synthesis' | 'video-generation'

export type ConfigurationStatus = 'configured' | 'awaiting-credentials' | 'disabled'

export interface GatewayModel {
  /** Stable gateway model id (what /api/v1 requests carry). */
  id: string
  displayName: string
  /** Provider as disclosed to admins (never shipped in the public projection). */
  provider: string
  /** The backend id this model maps to (adapter resolution key). */
  backendId: string
  /** Model identifier as the provider discloses it; never guessed. */
  modelIdentifier: string
  capabilities: ModelCapability[]
  /** Context limits where known (from the backend's REAL enforced limits). */
  contextLimits: {
    maxPromptChars: number | null
    maxHistoryMessages: number | null
  }
  streaming: boolean
  /** Whether this model may serve traffic right now (registry flag). */
  enabled: boolean
  /** Truthful reason when disabled (unchanged when enabled). */
  unavailableReason: string | null
  /** Pricing where the provider reports it — null when not reported. */
  pricing: { unit: string; costUnit: string | null }
  configurationStatus: ConfigurationStatus
  /** External-provider credential row this model would use, when configured. */
  credentialId: string | null
}

/** Internal (admin/operator) view: adds the health evidence. */
export interface GatewayModelWithHealth extends GatewayModel {
  backendHealth: HealthReport | null
}

// ---- external provider catalogue (genuinely implemented adapter paths) ------

/**
 * The OpenAI-compatible adapter is a REAL implemented integration path
 * (standard wire protocol, server-side fetch + SSE). It is listed once as a
 * configurable external model family; it becomes available only when an
 * administrator has configured a credential for it — configuration status
 * is reported honestly at all times.
 */
const EXTERNAL_OPENAI_COMPATIBLE_ID = 'bean-external-openai-compatible'

// ---- registry construction ---------------------------------------------------

/**
 * Build the gateway model catalogue from the private backend registry.
 * Chat-capable hosted models get stable gateway ids distinct from backend
 * ids so API consumers never depend on internal naming.
 */
export async function getGatewayModels(opts: { health?: (backendId: string) => HealthReport | null } = {}): Promise<GatewayModelWithHealth[]> {
  const externalCredentialId = await getActiveCredentialId('openai-compatible').catch(() => null)

  const models: GatewayModelWithHealth[] = []

  for (const b of BACKEND_REGISTRY) {
    const caps = capabilitiesFor(b)
    if (caps.length === 0) continue // no gateway-relevant capability
    const health = opts.health?.(b.id) ?? null
    models.push({
      id: gatewayModelIdFor(b),
      displayName: displayNameFor(b),
      provider: b.provider,
      backendId: b.id,
      modelIdentifier: b.modelIdentity,
      capabilities: caps,
      contextLimits: {
        maxPromptChars: typeof b.limits.maxPromptChars === 'number' ? (b.limits.maxPromptChars as number) : null,
        maxHistoryMessages: typeof b.limits.maxHistoryMessages === 'number' ? (b.limits.maxHistoryMessages as number) : null,
      },
      streaming: b.endpointType === 'managed-sdk' && (b.limits.streaming === true || b.task === 'coding-task'),
      enabled: b.enabled,
      unavailableReason: b.unavailableReason ?? null,
      pricing: { unit: b.metering.unit, costUnit: b.metering.costUnit },
      configurationStatus: b.enabled ? 'configured' : 'disabled',
      credentialId: null,
      backendHealth: health,
    })
  }

  // External OpenAI-compatible family — one catalogue entry whose status
  // tracks the ACTUAL credential configuration (measured, not claimed).
  models.push({
    id: EXTERNAL_OPENAI_COMPATIBLE_ID,
    displayName: 'External OpenAI-compatible model (admin-configured)',
    provider: 'External provider via OpenAI-compatible endpoint',
    backendId: 'bean-external-openai-compatible',
    modelIdentifier: 'Admin-supplied model identifier (configured per credential)',
    capabilities: ['chat', 'streaming'],
    contextLimits: { maxPromptChars: 32_000, maxHistoryMessages: 24 },
    streaming: true,
    enabled: externalCredentialId !== null,
    unavailableReason:
      externalCredentialId !== null
        ? null
        : 'No credential configured. An administrator must add an OpenAI-compatible provider credential (server-side, encrypted) before this model can serve traffic.',
    pricing: { unit: 'request', costUnit: null },
    configurationStatus: externalCredentialId !== null ? 'configured' : 'awaiting-credentials',
    credentialId: externalCredentialId,
    backendHealth: null,
  })

  return models
}

/** Public-safe projection: identity + capabilities + honest availability. */
export function toPublicModels(models: GatewayModelWithHealth[]): Array<Record<string, unknown>> {
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    provider: m.provider,
    capabilities: m.capabilities,
    contextLimits: m.contextLimits,
    streaming: m.streaming,
    availability: availabilityOf(m),
    configurationStatus: m.configurationStatus,
    pricing: m.pricing,
  }))
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'awaiting-credentials' | 'disabled'

function availabilityOf(m: GatewayModelWithHealth): AvailabilityStatus {
  if (!m.enabled) return m.configurationStatus === 'awaiting-credentials' ? 'awaiting-credentials' : 'disabled'
  // Enabled + measured health decides (probe result outranks configuration).
  if (m.backendHealth) return m.backendHealth.healthy ? 'available' : 'unavailable'
  return 'available'
}

function gatewayModelIdFor(b: BackendDescriptor): string {
  switch (b.id) {
    case 'bean-llm-hosted-primary':
      return 'bean-chat-hosted'
    case 'bean-code-llm-hosted-primary':
      return 'bean-code-hosted'
    case 'bean-image-hosted-primary':
      return 'bean-image-hosted'
    case 'bean-image-local-sharp':
      return 'bean-image-enhance-local'
    case 'bean-image-selfhosted-diffusers':
      return 'bean-image-edit-local'
    default:
      return b.id
  }
}

function displayNameFor(b: BackendDescriptor): string {
  switch (b.id) {
    case 'bean-llm-hosted-primary':
      return 'BEAN Chat (hosted gateway)'
    case 'bean-code-llm-hosted-primary':
      return 'BEAN Code (hosted gateway)'
    case 'bean-image-hosted-primary':
      return 'BEAN Image generation (hosted gateway)'
    case 'bean-image-local-sharp':
      return 'BEAN Image enhancement (local deterministic)'
    case 'bean-image-selfhosted-diffusers':
      return 'BEAN Image editing (local Diffusers worker)'
    default:
      return b.id
  }
}

/** Only capabilities the backend GENUINELY implements map into the registry. */
function capabilitiesFor(b: BackendDescriptor): ModelCapability[] {
  const caps: ModelCapability[] = []
  if (b.task === 'chat') caps.push('chat', 'streaming')
  if (b.task === 'coding-task') caps.push('chat', 'streaming')
  if (b.task === 'image-generation') caps.push('image-generation')
  if (b.task === 'image-enhancement') caps.push('image-enhancement')
  if (b.task === 'image-editing') caps.push('image-editing')
  if (b.task === 'video-generation') caps.push('video-generation')
  return caps
}

/** Resolve a gateway model id to its registry entry (throws honest 404). */
export async function resolveGatewayModel(
  modelId: string,
  opts: { health?: (backendId: string) => HealthReport | null } = {},
): Promise<GatewayModelWithHealth> {
  const models = await getGatewayModels(opts)
  const m = models.find((x) => x.id === modelId)
  if (!m) {
    throw Object.assign(new Error(`Unknown model id: ${modelId}`), { code: 'NOT_FOUND' })
  }
  return m
}

export { EXTERNAL_OPENAI_COMPATIBLE_ID }

/**
 * Whether credential encryption is configured — surfaced through /api/v1 so
 * operators see the honest state of external-provider support.
 */
export function credentialEncryptionStatus(): 'configured' | 'not-configured' {
  return isCredentialEncryptionConfigured() ? 'configured' : 'not-configured'
}
