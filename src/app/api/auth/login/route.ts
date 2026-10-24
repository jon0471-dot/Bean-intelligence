import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { verifyPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  email: z.string().email('Enter a valid email address.').max(200),
  password: z.string().min(1, 'Password is required.').max(128),
})

export async function POST(request: Request) {
  return handle(async () => {
    const body = await parseBody(request, schema)
    const ipKey = `login:${request.headers.get('x-forwarded-for') ?? 'local'}`
    const rl = checkRateLimit(ipKey, 10, 60_000)
    if (!rl.allowed) {
      throw new BeanApiError('RATE_LIMITED', `Too many sign-in attempts. Try again in ${rl.retryAfterSec}s.`)
    }

    const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
    // Uniform error — do not reveal whether the email exists.
    const invalid = new BeanApiError('UNAUTHENTICATED', 'Incorrect email or password.')
    if (!user) throw invalid
    if (!verifyPassword(body.password, user.passwordHash)) throw invalid

    await createSession(user.id)
    await recordAudit({ actorId: user.id, action: 'auth.login', target: user.id })

    return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  })
}
