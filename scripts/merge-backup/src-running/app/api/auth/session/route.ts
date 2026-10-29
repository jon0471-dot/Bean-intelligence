import { handle, ok } from '@/lib/api/errors'
import { getSessionUser } from '@/lib/auth/session'

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser()
    return ok({ user })
  })
}
