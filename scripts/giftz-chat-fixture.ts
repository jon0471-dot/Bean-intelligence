/**
 * TEMPORARY labeled fixture for CODE GIFTZ workspace verification.
 *
 * Creates one project (clearly marked as a UI/execution fixture) with a
 * small real web app (index.html + styles.css + app.js) so the workspace,
 * preview assembly, sandbox execution and manual-edit flow can be verified
 * while the inference gateway is rate-limited. This does NOT fake a model
 * response: the fixture is labeled as test data and deleted right after
 * verification (giftz-chat-e2e.sh does the cleanup).
 * Run: bun scripts/giftz-chat-fixture.ts  -> { projectId }
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const INDEX_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>BEAN Counter (fixture)</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main>
<h1>Counter</h1>
<p id="count">0</p>
<button id="inc">+1</button>
<button id="dec">-1</button>
</main>
<script src="app.js"></script>
</body>
</html>
`

const STYLES_CSS = `body { font-family: system-ui; background: #141414; color: #f0c75e; display: grid; place-items: center; min-height: 100vh; margin: 0; }
main { text-align: center; }
button { background: #d4af37; border: 0; border-radius: 8px; padding: 8px 16px; margin: 4px; font-weight: 700; cursor: pointer; }
p#count { font-size: 48px; font-weight: 800; margin: 12px 0; }
`

const APP_JS = `let count = 0;
const el = document.getElementById('count');
function render() { if (el) el.textContent = String(count); }
document.getElementById('inc')?.addEventListener('click', () => { count += 1; render(); });
document.getElementById('dec')?.addEventListener('click', () => { count -= 1; render(); });
render();
console.log('fixture counter ready');
`

const HELLO_JS = `console.log('BEAN fixture says hello');
console.log('sum:', 17 * 23 - 45);
`

async function main() {
  const user = await db.user.findFirst({
    where: { email: { contains: 'giftz-chat-' } },
    orderBy: { createdAt: 'desc' },
  })
  if (!user) throw new Error('e2e user missing (register first)')
  const project = await db.codeProject.create({
    data: {
      userId: user.id,
      name: 'UI fixture: counter app (test data, deleted after verification)',
      files: {
        create: [
          { path: 'index.html', content: INDEX_HTML, status: 'generated', version: 1 },
          { path: 'styles.css', content: STYLES_CSS, status: 'generated', version: 1 },
          { path: 'app.js', content: APP_JS, status: 'generated', version: 1 },
          { path: 'hello.js', content: HELLO_JS, status: 'generated', version: 1 },
        ],
      },
      messages: {
        create: [{ role: 'user', content: '[fixture] counter app (labeled test data)' }],
      },
    },
  })
  console.log(JSON.stringify({ projectId: project.id }))
}

await main()
