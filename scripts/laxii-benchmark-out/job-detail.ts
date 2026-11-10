import { db } from '@/lib/db'
for (const id of ['cmwa4grrt001eqan1ovvyufjw', 'cmwa4htla001wqan1d1w7nyor', 'cmwa4mab4002xqan19ug0jh3b']) {
  const j = await db.generationJob.findUnique({ where: { id }, select: { status: true, errorClass: true, errorCode: true, errorMessage: true, attempts: true } })
  console.log(id, JSON.stringify(j))
}
process.exit(0)
