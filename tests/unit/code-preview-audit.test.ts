/**
 * BEAN Intelligence — CODE GIFTZ preview audit tests (M22).
 *
 * Pins the deterministic static preview-audit contract: missing assets,
 * broken internal links, external references (CSP-blocked — stated, not
 * guessed), anchors/data URLs skipped, and subdirectory-relative resolution.
 */
import { describe, test, expect } from 'bun:test'

const { auditPreview, extractRefs, normalizeRef } = await import('../../src/lib/code/preview-audit')

describe('pure helpers', () => {
  test('normalizeRef resolves dot segments', () => {
    expect(normalizeRef('pages', '../styles/main.css')).toBe('styles/main.css')
    expect(normalizeRef('', './app.js')).toBe('app.js')
    // from directory a/b/c, two levels up is a/
    expect(normalizeRef('a/b/c', '../../top.css')).toBe('a/top.css')
    expect(normalizeRef('a/b', '../../top.css')).toBe('top.css')
  })

  test('extractRefs collects src/href values', () => {
    const refs = extractRefs('<link rel="stylesheet" href="styles.css"><script src="app.js"></script><a href="#top">x</a>')
    expect(refs).toEqual(['styles.css', 'app.js', '#top'])
  })
})

describe('auditPreview', () => {
  test('entry detection: index.html preferred, then main.html, then first html', () => {
    expect(auditPreview([{ path: 'main.html', content: '<html></html>' }, { path: 'other.html', content: '<html></html>' }]).entry).toBe('main.html')
    expect(auditPreview([{ path: 'about.html', content: '<html></html>' }, { path: 'index.html', content: '<html></html>' }]).entry).toBe('index.html')
    expect(auditPreview([{ path: 'app.js', content: '' }]).entry).toBeNull()
    expect(auditPreview([{ path: 'app.js', content: '' }]).notes.join(' ')).toMatch(/No HTML entry/)
  })

  test('missing assets are reported with the referencing file and resolved path', () => {
    const audit = auditPreview([
      { path: 'index.html', content: '<link rel="stylesheet" href="styles.css"><script src="app.js"></script><img src="logo.png">' },
      { path: 'app.js', content: 'console.log(1)' },
      // styles.css and logo.png intentionally absent
    ])
    const refs = audit.missingAssets.map((m) => m.resolved)
    expect(refs).toEqual(expect.arrayContaining(['styles.css', 'logo.png']))
    expect(audit.missingAssets.every((m) => m.file === 'index.html')).toBe(true)
    expect(audit.brokenInternalLinks).toHaveLength(0)
  })

  test('present assets are never flagged', () => {
    const audit = auditPreview([
      { path: 'index.html', content: '<link rel="stylesheet" href="styles.css"><script src="app.js"></script>' },
      { path: 'styles.css', content: 'body{}' },
      { path: 'app.js', content: 'console.log(1)' },
    ])
    expect(audit.missingAssets).toHaveLength(0)
    expect(audit.brokenInternalLinks).toHaveLength(0)
  })

  test('broken internal links: href to an html page that does not exist', () => {
    const audit = auditPreview([
      { path: 'index.html', content: '<a href="about.html">About</a><a href="pages/contact.html">Contact</a>' },
    ])
    expect(audit.brokenInternalLinks.map((l) => l.target)).toEqual(expect.arrayContaining(['about.html', 'pages/contact.html']))
  })

  test('existing internal links are fine', () => {
    const audit = auditPreview([
      { path: 'index.html', content: '<a href="about.html">About</a>' },
      { path: 'about.html', content: '<a href="index.html">Home</a>' },
    ])
    expect(audit.brokenInternalLinks).toHaveLength(0)
  })

  test('anchors, data/blob/mailto are skipped; external URLs recorded as CSP-blocked information', () => {
    const audit = auditPreview([
      {
        path: 'index.html',
        content: '<a href="#section">s</a><img src="data:image/png;base64,AAAA"><a href="mailto:x@y.z">m</a>' +
          '<script src="https://cdn.example.com/lib.js"></script><link href="https://fonts.example.com/css" rel="stylesheet">',
      },
    ])
    expect(audit.missingAssets).toHaveLength(0)
    expect(audit.brokenInternalLinks).toHaveLength(0)
    expect(audit.externalReferences.map((e) => e.url)).toEqual(
      expect.arrayContaining(['https://cdn.example.com/lib.js', 'https://fonts.example.com/css']),
    )
    expect(audit.notes.join(' ')).toMatch(/blocks all network access/)
  })

  test('subdirectory pages resolve assets relative to their own directory', () => {
    const audit = auditPreview([
      { path: 'pages/detail.html', content: '<link rel="stylesheet" href="../styles/main.css"><img src="img/local.png">' },
      { path: 'styles/main.css', content: 'body{}' },
      // pages/img/local.png intentionally absent
    ])
    const missing = audit.missingAssets.map((m) => m.resolved)
    expect(missing).toEqual(['pages/img/local.png'])
    expect(audit.missingAssets[0].reference).toBe('img/local.png')
  })
})
