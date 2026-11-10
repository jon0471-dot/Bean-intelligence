/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS diagnostic script (node .cjs) */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
async function main() {
  const convs = await db.conversation.findMany({
    where: { messages: { some: { metadata: { not: null } } } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { user: { select: { email: true } }, messages: { where: { role: 'assistant' }, orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  for (const c of convs) {
    const md = c.messages[0]?.metadata
    const srcCount = md?.sources?.length ?? 0
    console.log(`${c.createdAt.toISOString()} | ${c.user.email} | conv=${c.id} | sources=${srcCount} | states=${JSON.stringify(md?.states)}`)
  }
}
main().finally(() => db.$disconnect())
