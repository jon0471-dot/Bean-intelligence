import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { recordAudit } from '@/lib/observability/metering'

/** Account self-service: profile rename + password change. */
const schema = z.object({
  name: z.string().max(80).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().max(128).optional(),
})

export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name.trim() || null

    if (body.newPassword) {
      if (!body.currentPassword) {
        throw new BeanApiError('VALIDATION_ERROR', 'Current password is required to set a new one.')
      }
      const row = await db.user.findUnique({ where: { id: user.id } })
      if (!row || !verifyPassword(body.currentPassword, row.passwordHash)) {
        throw new BeanApiError('UNAUTHENTICATED', 'Current password is incorrect.')
      }
      if (body.newPassword.length < 8 || !/[a-zA-Z]/.test(body.newPassword) || !/[0-9]/.test(body.newPassword)) {
        throw new BeanApiError(
          'VALIDATION_ERROR',
          'New password must be at least 8 characters and contain letters and numbers.',
        )
      }
      data.passwordHash = hashPassword(body.newPassword)
    }

    if (Object.keys(data).length === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'Nothing to update.')
    }

    await db.user.update({ where: { id: user.id }, data })
    await recordAudit({ actorId: user.id, action: 'account.update', target: user.id })

    return ok({ updated: true })
  })
}

/** Data deletion (GDPR-style): removes the account and all owned data. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, z.object({ password: z.string().min(1) }))
    const row = await db.user.findUnique({ where: { id: user.id } })
    if (!row || !verifyPassword(body.password, row.passwordHash)) {
      throw new BeanApiError('UNAUTHENTICATED', 'Password confirmation failed.')
    }
    await recordAudit({ actorId: user.id, action: 'account.delete', target: user.id })
    await db.user.delete({ where: { id: user.id } }) // cascades to owned data
    return ok({ deleted: true })
  })
}
