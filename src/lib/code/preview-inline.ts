/**
 * CODE GIFTZ — preview document assembly (M24 hardening).
 *
 * Extracted verbatim from the preview route so the inlining contract is
 * unit-testable. M24 found a real bug here: String.replace with a STRING
 * replacement interprets `$&`, `$'`, `` $` `` and `$n` sequences inside the
 * REPLACEMENT TEXT — minified vendor bundles contain those sequences, which
 * corrupted the inlined script and broke the preview (browser-only failure
 * that static checks cannot see). All replacements now use function form,
 * which inserts the text literally.
 */

export interface PreviewFile {
  path: string
  content: string
}

/**
 * Build the standalone preview document:
 *  - inline project CSS referenced with relative href (or append to <head>);
 *  - inline project JS referenced with relative src (or append before </body>);
 *  - inject the error-observation bootstrap as the first head child.
 * The document's own behavior is otherwise untouched.
 */
export function buildPreviewDocument(
  entryHtml: string,
  files: PreviewFile[],
  errorBootstrap: string,
): string {
  let doc = entryHtml
  const cssFiles = files.filter((f) => f.path.endsWith('.css'))
  const jsFiles = files.filter((f) => f.path.endsWith('.js') && f.path !== 'index.html')

  for (const f of cssFiles) {
    const linkRe = new RegExp(`<link[^>]*href=["']\\.?/?${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'gi')
    if (linkRe.test(doc)) {
      // Function replacement: content is inserted literally, never as a
      // $-pattern replacement string.
      doc = doc.replace(linkRe, () => `<style>\n${f.content}\n</style>`)
    } else if (!/<style/i.test(doc)) {
      doc = doc.replace(/<\/head>/i, () => `<style>\n${f.content}\n</style>\n</head>`)
    }
  }

  for (const f of jsFiles) {
    const scriptRe = new RegExp(`<script[^>]*src=["']\\.?/?${f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`, 'gi')
    if (scriptRe.test(doc)) {
      doc = doc.replace(scriptRe, () => `<script>\n${f.content}\n</script>`)
    } else if (!doc.includes(f.content.slice(0, 40))) {
      doc = doc.replace(/<\/body>/i, () => `<script>\n${f.content}\n</script>\n</body>`)
    }
  }

  if (/<head[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, (m) => `${m}\n${errorBootstrap}`)
  } else {
    doc = `${errorBootstrap}\n${doc}`
  }

  return doc
}
