import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  email: z.string().email('Enter a valid email address.').max(200),
  password: z.string().min(1, 'Password is required.').max(128),
  name: z.string().max(80).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const body = await parseBody(request, schema)

    // M26 (audit S-8): registration was the only auth surface without a
    // rate limit — mass account creation was unthrottled. Same limiter
    // family as login (5 per 10 min per client; the XFF-key residual is
    // shared with login and documented as a proxy-contract blocker).
    const ipKey = `register:${request.headers.get('x-forwarded-for') ?? 'local'}`
    const rl = checkRateLimit(ipKey, 5, 10 * 60_000)
    if (!rl.allowed) {
      throw new BeanApiError('RATE_LIMITED', `Too many registration attempts. Try again in ${rl.retryAfterSec}s.`)
    }

    const weakness = validatePasswordStrength(body.password)
    if (weakness) throw new BeanApiError('VALIDATION_ERROR', weakness)

    const existing = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (existing) {
      throw new BeanApiError('VALIDATION_ERROR', 'An account with this email already exists.')
    }

    // First registered account becomes the platform administrator —
    // a deliberate, documented bootstrap rule (docs/security/SECURITY.md).
    // M26 (audit S-8): count + create now run in ONE transaction — with the
    // SQLite single-connection pool the two registrations racing the empty
    // bootstrap can no longer BOTH observe count 0 and mint two admins.
    // Residual (documented): after a total wipe of all accounts the next
    // registrant is again the bootstrap admin — inherent to the rule.
    const user = await db.$transaction(async (tx) => {
      const userCount = await tx.user.count()
      const role = userCount === 0 ? 'admin' : 'member'
      return tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          passwordHash: hashPassword(body.password),
          name: body.name ?? null,
          role,
        },
      })
    })
    const role = user.role

    await createSession(user.id)
    await recordAudit({
      actorId: user.id,
      action: 'auth.register',
      target: user.id,
      meta: { role },
    })

    return ok({ user: { id: user.id, email: user.email, name: user.name, role } })
  })
}
