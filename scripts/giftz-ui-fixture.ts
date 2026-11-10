/**
 * TEMPORARY CODE GIFTZ UI-rendering verification seed (mirrors the
 * seed-ui-fixture.ts precedent): inserts ONE completed generate-mode task
 * for the giftz-ui-check test account with clearly-labeled real code so the
 * result panel + REAL local sandbox execution can be browser-verified while
 * the LLM gateway is quota-exhausted (429). The sandbox run itself is 100%
 * real (bun child process); nothing fakes a product response.
 * Run: bun run scripts/giftz-ui-fixture.ts ; cleanup flag: --cleanup
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const MARKER = 'giftz-ui-render-fixture'

const CODE = `// giftz-ui-render-fixture: real runnable sample used for sandbox verification
function isPalindrome(s) {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let i = 0, j = t.length - 1; i < j; i++, j--) {
    if (t[i] !== t[j]) return false;
  }
  return true;
}

const samples = ['racecar', 'BEAN Intelligence', 'A man, a plan, a canal: Panama'];
for (const s of samples) {
  console.log(JSON.stringify(s), '->', isPalindrome(s));
}
`

async function main() {
  const cleanup = process.argv.includes('--cleanup')
  const user = await db.user.findFirst({ where: { email: 'giftz-ui-check@bean-test.dev' } })
  if (!user) throw new Error('test user missing')

  if (cleanup) {
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'code-giftz', paramsJson: { contains: MARKER } },
    })
    for (const j of jobs) await db.generationJob.delete({ where: { id: j.id } })
    console.log(`cleanup: removed ${jobs.length} fixture job(s)`)
    return
  }

  const files = [{ path: 'main.js', content: CODE }]
  const job = await db.generationJob.create({
    data: {
      userId: user.id,
      product: 'code-giftz',
      task: 'coding-task',
      status: 'completed',
      backendId: 'bean-code-llm-hosted-primary',
      paramsJson: JSON.stringify({
        mode: 'generate',
        prompt: `${MARKER}: write isPalindrome with self-tests`,
        language: 'javascript',
      }),
      resultJson: JSON.stringify({
        content:
          '**Palindrome checker** (fixture for UI rendering verification).\n\nChecks whether a string is a palindrome, ignoring case and non-alphanumeric characters, with three built-in self-tests.',
        files,
        durationMs: 1234,
      }),
      queuedAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })
  console.log('fixture job created:', job.id)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
