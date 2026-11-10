import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** CODE GIFTZ — project list for the sidebar (owner-scoped). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const projects = await db.codeProject.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        _count: { select: { files: true, messages: true } },
      },
    })
    return ok({
      projects: projects.map((p) => ({
        id: p.id,
        // Schema truth: the display name column is `title` (no `name`).
        title: p.title,
        files: p._count.files,
        messages: p._count.messages,
        updatedAt: p.updatedAt,
      })),
    })
  })
}
