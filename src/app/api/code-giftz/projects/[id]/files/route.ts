/**
 * CODE GIFTZ — manual file edit (workspace editor Save).
 * Owner-checked, path-safe, and marked origin:"modified" so the UI shows an
 * honest "edited by you" state (never confused with model output).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'

const schema = z.object({
  path: z.string().min(1).max(200),
  content: z.string().max(400_000),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    assertSafeProjectPath(body.path)
    const existing = await db.codeFile.findUnique({
      where: { projectId_path: { projectId: id, path: body.path } },
    })
    if (existing) {
      if (existing.content === body.content) {
        return ok({ file: { path: existing.path, origin: existing.origin, changed: false } })
      }
      await db.codeFile.update({
        where: { id: existing.id },
        data: { content: body.content, origin: 'modified' },
      })
    } else {
      await db.codeFile.create({
        data: { projectId: id, path: body.path, content: body.content, origin: 'modified' },
      })
    }
    return ok({ file: { path: body.path, origin: 'modified', changed: true } })
  })
}
