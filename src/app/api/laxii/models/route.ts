import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getModelCatalog } from '@/lib/laxii/models'

/**
 * LAXII — public-safe model catalog. Contains license posture, roles,
 * download sizes and VRAM classes. NO endpoints, NO secrets, NO provider
 * identities beyond what the licensing docs already publish.
 */
export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({
      models: getModelCatalog(),
      honestyNotes: [
        'Status reflects what is downloaded and verified on this host right now.',
        'Commercial-use columns summarize the licenses verified in docs/models/LAXII-ENGINE-DECISION-MATRIX.md (2026-10-31).',
        'A similarity score from any identity model is an estimate, never proof of identical identity.',
      ],
    })
  })
}
