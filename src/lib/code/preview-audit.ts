/**
 * BEAN Intelligence — CODE GIFTZ preview audit (M22).
 *
 * Deterministic, honest static audit of a project's HTML entry points:
 *   - which HTML files can the preview render;
 *   - missing assets (src/href targets that resolve to no project file);
 *   - broken internal links (href="*.html" targets that do not exist);
 *   - external references recorded as information (the preview CSP
 *     `default-src 'none'` blocks them — stated, not guessed).
 *
 * Pure module — no execution, no network. Runtime console errors are a
 * separate, REAL signal collected in the browser by the preview iframe
 * bootstrap (see the preview route) — never fabricated here.
 */

export interface PreviewAudit {
  htmlFiles: string[]
  entry: string | null
  missingAssets: Array<{ file: string; reference: string; resolved: string }>
  brokenInternalLinks: Array<{ file: string; target: string }>
  externalReferences: Array<{ file: string; url: string }>
  notes: string[]
}

const SKIP_PREFIXES = ['#', 'data:', 'blob:', 'mailto:', 'tel:', 'javascript:']

/** Normalize a relative base dir + reference to a project path (pure). */
export function normalizeRef(baseDir: string, ref: string): string {
  const segments = [...baseDir.split('/').filter(Boolean), ...ref.split('/')]
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Extract src= / href= attribute values from an HTML document (pure). */
export function extractRefs(html: string): string[] {
  const refs = new Set<string>()
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) refs.add(m[1].trim())
  }
  return [...refs]
}

const ASSET_EXTENSIONS = /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|json|txt|md|woff2?|ttf|mp3|mp4|wav)$/i

export function auditPreview(files: Array<{ path: string; content: string }>): PreviewAudit {
  const byPath = new Set(files.map((f) => f.path))
  const htmlFiles = files.filter((f) => f.path.endsWith('.html')).map((f) => f.path)
  const entry = htmlFiles.find((p) => p === 'index.html') ?? htmlFiles.find((p) => p === 'main.html') ?? htmlFiles[0] ?? null

  const missingAssets: PreviewAudit['missingAssets'] = []
  const brokenInternalLinks: PreviewAudit['brokenInternalLinks'] = []
  const externalReferences: PreviewAudit['externalReferences'] = []

  for (const f of files.filter((x) => x.path.endsWith('.html'))) {
    const baseDir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    for (const ref of extractRefs(f.content)) {
      if (SKIP_PREFIXES.some((p) => ref.startsWith(p))) continue
      if (/^https?:\/\//i.test(ref) || ref.startsWith('//')) {
        externalReferences.push({ file: f.path, url: ref })
        continue
      }
      // Strip a query/hash suffix for resolution purposes.
      const clean = ref.split('#')[0].split('?')[0]
      if (clean.length === 0) continue
      const resolved = normalizeRef(baseDir, clean)
      const endsHtml = /\.html?$/i.test(resolved)
      const looksLikeAsset = ASSET_EXTENSIONS.test(resolved)
      if (!endsHtml && !looksLikeAsset) continue // anchor-ish or generated route — not auditable statically
      if (byPath.has(resolved)) continue
      if (byPath.has(resolved.replace(/\.html$/i, '.html'))) continue
      if (endsHtml) {
        brokenInternalLinks.push({ file: f.path, target: ref })
      } else {
        missingAssets.push({ file: f.path, reference: ref, resolved })
      }
    }
  }

  const notes: string[] = []
  if (externalReferences.length > 0) {
    notes.push(
      `${externalReferences.length} external URL reference(s) found. The isolated preview blocks all network access by CSP — external scripts, fonts and styles will not load in the preview.`,
    )
  }
  if (entry === null) {
    notes.push('No HTML entry file found — nothing can be previewed.')
  }

  return { htmlFiles, entry, missingAssets, brokenInternalLinks, externalReferences, notes }
}
