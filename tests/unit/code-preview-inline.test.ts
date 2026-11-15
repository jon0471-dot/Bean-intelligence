/**
 * M24 regression — preview document inlining must never corrupt file content.
 *
 * Found live in M24: String.replace with a STRING replacement interprets
 * `$&`/`$'`/`` $` ``/`$n` sequences inside the replacement text. Minified
 * vendor bundles (e.g. GSAP ScrollTrigger) contain `$&&$(...)`, which
 * corrupted the inlined `<script>` block and produced a browser-only
 * "Unexpected token '<'" error that static checks could not see.
 */
import { describe, expect, test } from 'bun:test'
import { buildPreviewDocument } from '@/lib/code/preview-inline'

const BOOTSTRAP = '<script>/*bootstrap*/</script>'

describe('buildPreviewDocument (M24 inliner hardening)', () => {
  test('referenced <script src> is inlined byte-exact even when the JS contains $-patterns', () => {
    const js = 'var a = "x$&y"; if (a) {$&&window}; alert($\'z);' // hostile $-patterns
    const html = '<!doctype html><html><head></head><body><script src="app.js"></script></body></html>'
    const doc = buildPreviewDocument(html, [{ path: 'app.js', content: js }], BOOTSTRAP)
    expect(doc).toContain(`<script>\n${js}\n</script>`)
    expect(doc).not.toContain('src="app.js"')
    // The literal $-patterns survive untouched.
    expect(doc).toContain('$&&window')
    expect(doc).toContain('$\'z')
  })

  test('referenced <link stylesheet> is inlined byte-exact even when the CSS contains $-patterns', () => {
    const css = 'body { content: "a$&b$\'c"; }'
    const html = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body></body></html>'
    const doc = buildPreviewDocument(html, [{ path: 'styles.css', content: css }], BOOTSTRAP)
    expect(doc).toContain(`<style>\n${css}\n</style>`)
    expect(doc).not.toContain('href="styles.css"')
  })

  test('unreferenced JS files are appended before </body> without corruption', () => {
    const vendor = '/*! vendor 3.13.0 */ oe&&!(oe=!1)&&$&&$(se);'
    const html = '<!doctype html><html><head></head><body><h1>ok</h1></body></html>'
    const doc = buildPreviewDocument(html, [{ path: 'vendor/x.min.js', content: vendor }], BOOTSTRAP)
    expect(doc).toContain(`<script>\n${vendor}\n</script>\n</body>`)
    // Exactly ONE closing tag sequence for the appended script — no duplicated
    // match text (the $& bug used to splice the appended script into a
    // previous script block).
    const firstAppend = doc.indexOf(`<script>\n${vendor.slice(0, 10)}`)
    expect(doc.slice(firstAppend)).toBe(`<script>\n${vendor}\n</script>\n</body></html>`)
  })

  test('error bootstrap is injected as the first head child', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body></body></html>'
    const doc = buildPreviewDocument(html, [], BOOTSTRAP)
    expect(doc.indexOf('<head>')).toBeLessThan(doc.indexOf(BOOTSTRAP))
    expect(doc.indexOf(BOOTSTRAP)).toBeLessThan(doc.indexOf('<title>'))
  })

  test('a script whose content already exists verbatim is not appended twice', () => {
    const js = 'console.log("already inlined");'
    const html = `<!doctype html><html><head></head><body><script>\n${js}\n</script></body></html>`
    const doc = buildPreviewDocument(html, [{ path: 'app.js', content: js }], BOOTSTRAP)
    expect(doc.match(/already inlined/g)?.length).toBe(1)
  })
})
