/**
 * BEAN Intelligence — shared research gateway status (authenticated).
 *
 * Reports MEASURED availability of the Agent Reach runtime, per-channel
 * source states (from quota-free doctor probes + configuration) and the
 * optional Obscura browser backend. No secrets, no binary paths, no
 * credentials — only honest states and safe notes. Any signed-in user may
 * read it (it contains no per-user data); ownership-sensitive research
 * artifacts live on the products' own messages.
 */

import { requireUser } from '@/lib/auth/session'
import { getResearchGatewayStatus } from '@/lib/research/reach/registry'
import { handle, ok } from '@/lib/api/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    await requireUser()
    const status = await getResearchGatewayStatus()
    return ok({
      runtime: {
        available: status.runtime.available,
        version: status.runtime.version,
        reason: status.runtime.reason,
      },
      obscura: {
        available: status.obscura.available,
        version: status.obscura.version,
        reason: status.obscura.reason,
      },
      sources: status.sources.map((s) => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        level: s.level,
        loginRequired: s.loginRequired,
        state: s.state,
        note: s.note,
        actions: s.actions,
        products: s.products,
      })),
      checkedAt: status.checkedAt,
    })
  })
}
