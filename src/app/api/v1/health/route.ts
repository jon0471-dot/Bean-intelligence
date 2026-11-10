/**
 * BEAN Intelligence — GET /api/v1/health
 * Gateway-level health: liveness + MEASURED probes for every model class the
 * gateway can address, plus honest credential-encryption configuration
 * status. Public (contains no secrets — same evidence class as /api/health).
 */
import { handle, ok } from '@/lib/api/errors'
import { safeProbe } from '@/lib/adapters/safe-probe'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { probeResearchHealth } from '@/lib/research/provider'
import { credentialEncryptionStatus } from '@/lib/registry/models'

export async function GET() {
  return handle(async () => {
    const [llm, image, research] = await Promise.all([
      safeProbe('llm-hosted-primary', () => hostedLlmAdapter.health()),
      safeProbe('image-hosted-primary', () => hostedImageAdapter.health()),
      safeProbe('research-functions-primary', () => probeResearchHealth()),
    ])
    return ok({
      service: 'bean-ai-gateway',
      version: 'v1',
      live: true,
      time: new Date().toISOString(),
      chatClass: { available: llm.healthy, probe: llm },
      imageClass: { available: image.healthy, probe: image },
      functionsClass: { available: research.healthy, probe: research },
      credentialEncryption: credentialEncryptionStatus(),
    })
  })
}
