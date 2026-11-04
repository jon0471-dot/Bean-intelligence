/**
 * BEAN Intelligence — GET /api/v1/models
 * The unified model catalogue (public-safe projection). Auth: session OR
 * application API key with `models:read`. Contains NO endpoint URLs and NO
 * credential material — availability is the measured truth.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireGatewayPrincipal } from '@/lib/security/gateway-auth'
import { getGatewayModels, toPublicModels, credentialEncryptionStatus } from '@/lib/registry/models'
import { cachedHealth } from '@/lib/adapters/health-cache'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import type { HealthReport } from '@/lib/adapters/types'

export async function GET(request: Request) {
  return handle(async () => {
    await requireGatewayPrincipal(request, 'models:read')
    // Measured probes for the chat/image backends (cached 20s, deduped).
    const [llm, image] = await Promise.all([
      cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health()),
      cachedHealth('image-hosted-primary', () => hostedImageAdapter.health()),
    ])
    const healthFor = (backendId: string): HealthReport | null => {
      if (backendId === 'bean-llm-hosted-primary' || backendId === 'bean-code-llm-hosted-primary') return llm
      if (backendId === 'bean-image-hosted-primary') return image
      return null
    }
    const models = await getGatewayModels({ health: healthFor })
    return ok({
      models: toPublicModels(models),
      credentialEncryption: credentialEncryptionStatus(),
    })
  })
}
