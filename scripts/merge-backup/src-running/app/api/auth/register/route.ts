import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  email: z.string().email('Enter a valid email address.').max(200),
  password: z.string().min(1, 'Password is required.').max(128),
  name: z.string().max(80).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const body = await parseBody(request, schema)

    const weakness = validatePasswordStrength(body.password)
    if (weakness) throw new BeanApiError('VALIDATION_ERROR', weakness)

    const existing = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (existing) {
      throw new BeanApiError('VALIDATION_ERROR', 'An account with this email already exists.')
    }

    // First registered account becomes the platform administrator —
    // a deliberate, documented bootstrap rule (docs/security/SECURITY.md).
    const userCount = await db.user.count()
    const role = userCount === 0 ? 'admin' : 'member'

    const user = await db.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: hashPassword(body.password),
        name: body.name ?? null,
        role,
      },
    })

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
