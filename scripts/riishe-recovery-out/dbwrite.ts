import { PrismaClient } from '@prisma/client'
const pdb = new PrismaClient()
try {
  await pdb.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS _bean_write_probe (id INTEGER PRIMARY KEY, at TEXT)")
  await pdb.$executeRawUnsafe("INSERT INTO _bean_write_probe (at) VALUES ('" + new Date().toISOString() + "')")
  console.log('WRITE OK (direct prisma client)')
  await pdb.$executeRawUnsafe("DELETE FROM _bean_write_probe")
} catch (e) {
  console.log('WRITE FAILED:', e instanceof Error ? e.message.slice(0, 200) : e)
}
await pdb.$disconnect()
