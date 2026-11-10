/**
 * BEAN Intelligence — GET /api/v1/providers
 * Provider overview with MEASURED health (cached probes) and honest
 * configuration status. Auth: session OR API key with `providers:read`.
 * No credentials, no endpoint URLs beyond the provider's display name.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireGatewayPrincipal } from '@/lib/security/gateway-auth'
import { cachedHealth } from '@/lib/adapters/health-cache'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { probeResearchHealth } from '@/lib/research/provider'
import { getGatewayModels } from '@/lib/registry/models'
import { REGISTERED_PROVIDERS } from '@/lib/security/provider-credentials'
import { credentialEncryptionStatus } from '@/lib/registry/models'

export async function GET(request: Request) {
  return handle(async () => {
    await requireGatewayPrincipal(request, 'providers:read')
    const [llm, image, research] = await Promise.all([
      cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health()),
      cachedHealth('image-hosted-primary', () => hostedImageAdapter.health()),
      cachedHealth('research-functions-primary', () => probeResearchHealth()),
    ])
    const models = await getGatewayModels()
    const byProvider = new Map<string, { provider: string; models: string[]; healthy: boolean | null; detail: string; latencyMs: number | null }>()
    for (const m of models) {
      const entry = byProvider.get(m.provider) ?? { provider: m.provider, models: [], healthy: null, detail: 'No probe registered for this provider.', latencyMs: null }
      entry.models.push(m.id)
      if (m.backendHealth) {
        entry.healthy = m.backendHealth.healthy
        entry.detail = m.backendHealth.detail
        entry.latencyMs = m.backendHealth.latencyMs
      }
      byProvider.set(m.provider, entry)
    }
    // Attach the shared gateway probes to the hosted provider entries.
    for (const entry of byProvider.values()) {
      if (entry.provider.includes('Z.ai authorized hosted')) {
        entry.healthy = llm.healthy
        entry.detail = `${llm.detail} Research/functions class: ${research.healthy ? 'healthy' : `unavailable (${research.detail})`}. Image class: ${image.healthy ? 'healthy' : 'unavailable'}.`
        entry.latencyMs = llm.latencyMs
      }
    }
    return ok({
      providers: [...byProvider.values()],
      registeredExternalProviders: REGISTERED_PROVIDERS,
      credentialEncryption: credentialEncryptionStatus(),
    })
  })
}
