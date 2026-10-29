/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS diagnostic script (node .cjs) */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
async function main() {
  const msgs = await db.message.findMany({
    where: { content: { contains: 'Tamil Nadu' } },
    orderBy: { createdAt: 'desc' },
    take: 6,
  })
  for (const m of msgs) {
    console.log('=== ' + m.role + ' | ' + m.createdAt.toISOString() + ' | conv=' + m.conversationId)
    console.log(m.content.slice(0, 1500))
    if (m.metadata) {
      const md = m.metadata
      console.log('--- metadata: states=' + JSON.stringify(md.states) + ' sources=' + JSON.stringify((md.sources||[]).map(s=>({id:s.id,host:s.hostName,date:s.date}))) + ' retrievedAt=' + (md.retrievedAt||'none') + ' degraded=' + JSON.stringify(md.degraded||[]).slice(0,400))
    }
  }
}
main().finally(() => db.$disconnect())
