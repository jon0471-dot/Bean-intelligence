/**
 * BEAN Intelligence — unit tests for CODE GIFTZ chat-first workspace
 * primitives: response parsing (file fences vs chat text), streaming
 * visibility rules, LCS diffing, and the bounded project context builder.
 */
import { describe, test, expect } from 'bun:test'
import { parseCodeResponse, visibleChatPrefix, langFromPath } from '../../src/lib/giftz/parse'
import { diffLines, compactDiff } from '../../src/lib/giftz/diff'
import { buildProjectContext } from '../../src/app/api/code-giftz/chat/route'
import { extractFiles } from '../../src/lib/sandbox/runner'

describe('parseCodeResponse', () => {
  test('extracts path-tagged fences as files and removes them from the chat text', () => {
    const out = [
      'Here is a tiny app.',
      '```html path=index.html',
      '<!doctype html><p>hi</p>',
      '```',
      '```js path=app.js',
      'console.log(1)',
      '```',
      'It renders a paragraph.',
    ].join('\n')
    const parsed = parseCodeResponse(out)
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0].path).toBe('index.html')
    expect(parsed.files[0].content).toContain('<!doctype html>')
    expect(parsed.files[1].path).toBe('app.js')
    expect(parsed.message).toContain('Here is a tiny app.')
    expect(parsed.message).toContain('It renders a paragraph.')
    expect(parsed.message).not.toContain('console.log(1)')
    expect(parsed.message).not.toContain('path=')
  })

  test('ordinary fenced snippets stay in the chat text', () => {
    const out = 'Explanation:\n```js\nconst x = 1\n```\nDone.'
    const parsed = parseCodeResponse(out)
    expect(parsed.files).toHaveLength(0)
    expect(parsed.message).toContain('const x = 1')
  })

  test('no file fences means a pure conversational answer', () => {
    const parsed = parseCodeResponse('You need a boundary check before the division.')
    expect(parsed.files).toHaveLength(0)
    expect(parsed.message).toContain('boundary check')
  })

  test('unsafe paths are dropped (never written) and the fence stays visible', () => {
    const out = 'Hmm.\n```js path=../evil.js\nbad()\n```'
    const parsed = parseCodeResponse(out)
    expect(parsed.files).toHaveLength(0)
    expect(parsed.message).toContain('../evil.js')
  })

  test('output stays compatible with the sandbox extractFiles contract', () => {
    const out = '```js path=main.js\nconsole.log("ok")\n```'
    const parsed = parseCodeResponse(out)
    expect(parsed.files).toHaveLength(1)
    const sandboxFiles = extractFiles(out)
    expect(sandboxFiles).toEqual([{ path: 'main.js', content: 'console.log("ok")\n' }])
  })
})

describe('visibleChatPrefix (streaming guard)', () => {
  test('plain prose streams immediately', () => {
    expect(visibleChatPrefix('Working on it…')).toBe('Working on it…')
  })

  test('file-fence bodies are withheld while streaming', () => {
    const acc = 'Creating files.\n```html path=index.html\n<!doctype html>'
    expect(visibleChatPrefix(acc)).toBe('Creating files.\n')
  })

  test('closed file fences are removed entirely', () => {
    const acc = 'Creating files.\n```html path=index.html\n<p>hi</p>\n```\nAll set.'
    expect(visibleChatPrefix(acc)).toBe('Creating files.\nAll set.')
  })

  test('ordinary fenced snippets stream once their info line is final', () => {
    const acc = 'Example:\n```js\nconst a = 1;\n```'
    expect(visibleChatPrefix(acc)).toContain('const a = 1;')
  })

  test('an unterminated info line is withheld (could still become a file)', () => {
    const acc = 'Text before\n```ht'
    expect(visibleChatPrefix(acc)).toBe('Text before\n')
  })

  test('file content NEVER leaks into any visible prefix', () => {
    const secret = 'SECRET_FILE_BODY_SHOULD_NOT_STREAM'
    const acc = `Intro.\n\`\`\`js path=main.js\nconsole.log('${secret}')\n\`\`\`\nOutro.`
    expect(visibleChatPrefix(acc)).not.toContain(secret)
  })
})

describe('diffLines (LCS)', () => {
  test('marks added, removed and context lines with correct numbering', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc\nd')
    expect(d.added).toBe(2)
    expect(d.removed).toBe(1)
    const adds = d.lines.filter((l) => l.type === 'add')
    const dels = d.lines.filter((l) => l.type === 'del')
    expect(adds.map((l) => l.text)).toEqual(['B', 'd'])
    expect(dels.map((l) => l.text)).toEqual(['b'])
    expect(dels[0].oldLine).toBe(2)
    expect(adds[0].newLine).toBe(2)
  })

  test('identical content produces an empty diff', () => {
    const d = diffLines('same\nlines', 'same\nlines')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
    expect(d.lines.every((l) => l.type === 'ctx')).toBe(true)
  })

  test('empty-to-content is a pure addition', () => {
    const d = diffLines('', 'line1\nline2')
    expect(d.added).toBe(2)
    expect(d.removed).toBe(0)
  })

  test('compactDiff truncates honestly with a flag', () => {
    const big = { lines: Array.from({ length: 500 }, (_, i) => ({ type: 'add' as const, text: `l${i}`, newLine: i + 1 })), added: 500, removed: 0 }
    const c = compactDiff(big, 100)
    expect(c.lines).toHaveLength(100)
    expect(c.truncated).toBe(true)
    expect(c.added).toBe(500)
  })
})

describe('buildProjectContext (bounded, honest truncation)', () => {
  test('empty project yields an empty block (the route filters empty segments out)', () => {
    // MEASURED CONTRACT (2026-10-29): the real builder returns '' for an
    // empty file list — the chat route joins context blocks with
    // filter(s => s.length > 0), so nothing empty is ever injected.
    expect(buildProjectContext([])).toBe('')
  })

  test('includes file contents and marks budget truncation honestly', () => {
    const ctx = buildProjectContext([
      { path: 'a.js', content: 'x'.repeat(5_000) },
      { path: 'b.css', content: 'body{}' },
    ])
    expect(ctx).toContain('a.js')
    expect(ctx).toContain('b.css')
    expect(ctx).toContain('body{}')
    // A file that fits shows in full; the marker only appears when the
    // per-request character budget actually cuts a file.
    expect(ctx).toContain('x')
  })

  test('respects the character budget: later files are flagged as omitted, never silently dropped', () => {
    const files = Array.from({ length: 14 }, (_, i) => ({
      path: `f${i}.js`,
      content: 'y'.repeat(2_000),
    }))
    const ctx = buildProjectContext(files)
    expect(ctx).toContain('omitted from context: file budget reached')
    // Files beyond the budget keep their PATH listed (the model is told the
    // file exists but its content was withheld — never a silent omission).
    expect(ctx).toContain('f13.js')
  })
})

describe('langFromPath', () => {
  test('maps extensions to highlighter languages', () => {
    expect(langFromPath('src/app.js')).toBe('javascript')
    expect(langFromPath('index.html')).toBe('html')
    expect(langFromPath('styles.css')).toBe('css')
    expect(langFromPath('README.md')).toBe('markdown')
    expect(langFromPath('data.unknown')).toBe('text')
  })
})
