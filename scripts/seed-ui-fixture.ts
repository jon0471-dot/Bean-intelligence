/**
 * TEMPORARY UI-rendering verification seed.
 *
 * Inserts one test conversation whose assistant message carries metadata in
 * EXACTLY the production orchestration shape — sources taken verbatim from
 * the earlier REAL web-search run (gateway web_search results for the NVIDIA
 * CEO question), verification entries from the real arithmetic evaluator.
 *
 * Purpose: verify the RIISHE UI renders citations/badges/source lists
 * correctly while the inference gateway is rate-limited (429). This does NOT
 * fake a chat response: it is a rendering fixture with clearly labeled
 * content, deleted immediately after browser verification.
 * Run: bun run scripts/seed-ui-fixture.ts ; cleanup flag: --cleanup
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const MARKER = 'ui-render-fixture'

const METADATA = {
  states: ['VERIFIED_FROM_SOURCES'],
  sources: [
    {
      id: 1,
      title: 'Jensen Huang',
      url: 'https://en.wikipedia.org/wiki/Jensen_Huang',
      hostName: 'en.wikipedia.org',
      date: '2005-06-26T02:15:26Z',
      official: false,
      pageRead: true,
    },
    {
      id: 2,
      title: 'Jensen Huang | NVIDIA Newsroom',
      url: 'https://nvidianews.nvidia.com/bios/jensen-huang',
      hostName: 'nvidianews.nvidia.com',
      date: null,
      official: false,
      pageRead: false,
    },
  ],
  verification: [
    { check: 'citation integrity', status: 'passed', detail: 'all citation markers resolve to retrieved sources' },
  ],
  stages: [
    { stage: 'researching', durationMs: 4210 },
    { stage: 'verifying', durationMs: 3 },
  ],
  degraded: [],
}

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const user = await db.user.findFirst({ where: { email: 'e2e-origin-fix@bean.test' } })
  if (!user) throw new Error('test user missing')

  if (cleanup) {
    const convs = await db.conversation.findMany({ where: { userId: user.id, title: { contains: MARKER } } })
    for (const c of convs) await db.conversation.delete({ where: { id: c.id } })
    console.log(`cleanup: removed ${convs.length} fixture conversation(s)`)
    return
  }

  const conv = await db.conversation.create({
    data: { userId: user.id, title: `${MARKER}: leadership check` },
  })
  await db.message.create({
    data: { conversationId: conv.id, role: 'user', content: 'Who is the current CEO of NVIDIA?' },
  })
  await db.message.create({
    data: {
      conversationId: conv.id,
      role: 'assistant',
      content:
        'As of the latest retrieved reporting, Jensen Huang co-founded NVIDIA and has served as its chief executive officer since its founding in 1993 [1]. The NVIDIA newsroom biography likewise lists him as president and CEO [2].',
      metadata: METADATA,
      tokensEstIn: 900,
      tokensEstOut: 60,
      latencyMs: 8400,
    },
  })
  console.log('fixture conversation created:', conv.id)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
