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
 *
 * M22 ADDITIVE: an error-observation bootstrap is injected into the served
 * document. It hooks console.error/warn, window.onerror and unhandledrejection
 * INSIDE the iframe and postMessages each real event to the parent workspace,
 * which surfaces it in the preview evidence strip. These are REAL browser
 * observations from the user's own rendering — never fabricated — and the
 * sandboxed frame (no same-origin) still cannot touch BEAN data.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { buildPreviewDocument } from '@/lib/code/preview-inline'

/** The bootstrap injected as the FIRST head child so it observes everything
 *  the document does afterwards. JSON-encodes safely for inline embedding. */
const ERROR_BOOTSTRAP = `<script>(function(){
  var send = function(type, message, detail){
    try { parent.postMessage({ source: 'giftz-preview', type: type, message: String(message).slice(0, 500), detail: String(detail || '').slice(0, 800) }, '*'); } catch (e) {}
  };
  var origError = console.error ? console.error.bind(console) : null;
  console.error = function(){ var args = Array.prototype.slice.call(arguments); send('console-error', args.map(function(a){ try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch (e) { return String(a) } }).join(' ')); if (origError) origError.apply(console, args); };
  var origWarn = console.warn ? console.warn.bind(console) : null;
  console.warn = function(){ var args = Array.prototype.slice.call(arguments); send('console-warn', args.map(function(a){ try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch (e) { return String(a) } }).join(' ')); if (origWarn) origWarn.apply(console, args); };
  window.addEventListener('error', function(ev){ send('pageerror', ev.message, (ev.filename || '') + (ev.lineno ? (':' + ev.lineno + ':' + ev.colno) : '')); }, true);
  window.addEventListener('unhandledrejection', function(ev){ var r = ev.reason; send('unhandledrejection', r && r.message ? r.message : String(r), r && r.stack ? r.stack : ''); }, true);
})();</script>`

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

  // Inline project CSS/JS referenced with relative src/href so the preview is
  // self-contained (the iframe never fetches anything else). M24: the inliner
  // lives in @/lib/code/preview-inline and uses function-form replacements —
  // a string replacement corrupted vendor JS containing `$&`/`$'` sequences
  // (real browser-only preview failure found by the M24 validation run).
  for (const f of files) {
    assertSafeProjectPath(f.path)
  }
  const doc = buildPreviewDocument(html.content, files, ERROR_BOOTSTRAP)

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
