import { handle, ok } from '@/lib/api/errors'
import { destroySession } from '@/lib/auth/session'
import { getSessionUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'

export async function POST() {
  return handle(async () => {
    const user = await getSessionUser()
    await destroySession()
    if (user) await recordAudit({ actorId: user.id, action: 'auth.logout', target: user.id })
    return ok({ signedOut: true })
  })
}
