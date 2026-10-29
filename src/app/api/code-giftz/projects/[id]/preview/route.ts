/**
 * CODE GIFTZ — isolated web-app preview.
 *
 * Serves the project's index.html as a STANDALONE document with its CSS/JS
 * inlined from the persisted project files. The iframe embeds this with the
 * `sandbox` attribute (no allow-same-origin), so the preview CANNOT touch
 * BEAN cookies, storage or APIs — real isolation, no server-side execution.
 *
 * Never claims the app "works": it renders exactly the generated files, and
 * any runtime error shows up inside the iframe like it would for the user.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth check first (the iframe carries the session cookie).
  const user = await requireUser().catch(() => null)
  const { id } = await params
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }
  const project = await db.codeProject.findUnique({ where: { id } })
  if (!project || project.userId !== user.id) {
    return new Response('Not found', { status: 404 })
  }
  const files = await db.codeFile.findMany({ where: { projectId: id } })
  const html = files.find((f) => f.path === 'index.html' || f.path === 'main.html')
  if (!html) {
    return new Response('This project has no index.html to preview.', { status: 404 })
  }

  let doc = html.content
  // Inline project CSS/JS referenced with relative src/href so the preview is
  // self-contained (the iframe never fetches anything else).
  for (const f of files) {
    assertSafeProjectPath(f.path)
  }
  const cssFiles = files.filter((f) => f.path.endsWith('.css'))
  const jsFiles = files.filter((f) => f.path.endsWith('.js') && f.path !== 'index.html')
  if (cssFiles.length > 0 || jsFiles.length > 0) {
    // Replace <link rel=stylesheet href="x.css"> and <script src="x.js">.
    for (const f of cssFiles) {
      const linkRe = new RegExp(`<link[^>]*href=["']\\.?/?${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'gi')
      if (linkRe.test(doc)) {
        doc = doc.replace(linkRe, `<style>\n${f.content}\n</style>`)
      } else if (!/<style/i.test(doc)) {
        doc = doc.replace(/<\/head>/i, `<style>\n${f.content}\n</style>\n</head>`)
      }
    }
    for (const f of jsFiles) {
      const scriptRe = new RegExp(`<script[^>]*src=["']\\.?/?${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`, 'gi')
      if (scriptRe.test(doc)) {
        doc = doc.replace(scriptRe, `<script>\n${f.content}\n</script>`)
      } else if (!doc.includes(f.content.slice(0, 40))) {
        doc = doc.replace(/<\/body>/i, `<script>\n${f.content}\n</script>\n</body>`)
      }
    }
  }

  return new Response(doc, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Defense in depth: the embedding iframe is sandboxed, and this
      // document itself refuses to frame anything or call out to other origins.
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
      'x-content-type-options': 'nosniff',
    },
  })
}
