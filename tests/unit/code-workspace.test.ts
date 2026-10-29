import { describe, expect, test } from 'bun:test'
import { planFileUpdates, buildProjectContext, MAX_FILE_CHARS } from '../../src/lib/code/files'
import { diffLines, compactDiff, diffStats, type HunkGap } from '../../src/lib/code/diff'

describe('CODE GIFTZ file planning', () => {
  test('new path -> generated; changed content -> modified with previous content kept', () => {
    const plan = planFileUpdates(
      [{ path: 'app.js', content: 'const a = 1\n', version: 1 }],
      '```js path=app.js\nconst a = 2\n```\n```html path=index.html\n<h1>hi</h1>\n```',
    )
    expect(plan.changes).toHaveLength(2)
    const app = plan.changes.find((c) => c.path === 'app.js')!
    expect(app.status).toBe('modified')
    expect(app.version).toBe(2)
    expect(app.previousContent).toBe('const a = 1\n')
    expect(app.content).toBe('const a = 2\n')
    const index = plan.changes.find((c) => c.path === 'index.html')!
    expect(index.status).toBe('generated')
    expect(index.version).toBe(1)
    expect(index.previousContent).toBeNull()
    expect(plan.rejected).toHaveLength(0)
  })

  test('identical content produces NO change (no false modified badge)', () => {
    const plan = planFileUpdates(
      [{ path: 'main.js', content: 'console.log(1)\n', version: 3 }],
      '```js path=main.js\nconsole.log(1)\n```',
    )
    expect(plan.changes).toHaveLength(0)
    expect(plan.rejected).toHaveLength(0)
  })

  test('unsafe paths are rejected, never written', () => {
    const plan = planFileUpdates([], '```js path=../evil.js\nx\n```\n```js path=/abs.js\ny\n```')
    expect(plan.changes).toHaveLength(0)
    expect(plan.rejected).toHaveLength(2)
    expect(plan.rejected[0].reason).toMatch(/Unsafe/)
  })

  test('duplicate path: last occurrence wins, duplicate noted', () => {
    const plan = planFileUpdates([], '```js path=a.js\none\n```\n```js path=a.js\ntwo\n```')
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].content).toBe('two\n')
    expect(plan.rejected).toHaveLength(1)
  })

  test('oversized file rejected with honest reason', () => {
    const big = 'x'.repeat(MAX_FILE_CHARS + 1)
    const plan = planFileUpdates([], '```js path=big.js\n' + big + '\n```')
    expect(plan.changes).toHaveLength(0)
    expect(plan.rejected[0].reason).toMatch(/limit/)
  })

  test('single unlabeled block still maps via extractFiles fallback', () => {
    const plan = planFileUpdates([], '```js\nconsole.log("hi")\n```')
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].path).toBe('main.js')
  })
})

describe('CODE GIFTZ project context builder', () => {
  test('renders path-tagged fences; empty project -> empty context', () => {
    const empty = buildProjectContext([])
    expect(empty.text).toBe('')
    const ctx = buildProjectContext([{ path: 'index.html', content: '<p>hi</p>' }])
    expect(ctx.text).toContain('path=index.html')
    expect(ctx.text).toContain('<p>hi</p>')
    expect(ctx.truncated).toHaveLength(0)
  })

  test('budget exhaustion truncates largest files and reports omissions', () => {
    const small = { path: 'small.js', content: 'a'.repeat(100) }
    const huge = { path: 'huge.js', content: 'b'.repeat(80_000) }
    const ctx = buildProjectContext([huge, small])
    expect(ctx.text).toContain('path=small.js')
    expect(ctx.truncated).toContain('huge.js')
  })
})

describe('CODE GIFTZ diff', () => {
  test('added/removed/context rows with line numbers', () => {
    const rows = diffLines('a\nb\nc', 'a\nX\nc\nd')
    const adds = rows.filter((r) => r.type === 'add')
    const dels = rows.filter((r) => r.type === 'del')
    expect(adds.map((r) => r.text)).toEqual(['X', 'd'])
    expect(dels.map((r) => r.text)).toEqual(['b'])
    expect(rows[0]).toMatchObject({ type: 'context', oldLine: 1, newLine: 1 })
  })

  test('diffStats counts real additions/removals', () => {
    expect(diffStats('1\n2\n3', '1\n2\n3\n4')).toEqual({ added: 1, removed: 0 })
    expect(diffStats('1\n2\n3', '9')).toEqual({ added: 1, removed: 3 })
  })

  test('compactDiff collapses long unchanged runs into gaps', () => {
    const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 50', 'LINE 50')
    const chunks = compactDiff(before, after, 2)
    const gaps = chunks.filter((c): c is HunkGap => c.type === 'gap')
    expect(gaps.length).toBeGreaterThan(0)
    expect(chunks.some((c) => c.type !== 'gap' && c.text === 'LINE 50')).toBe(true)
    // collapsed view must be far smaller than the raw 101-line diff
    expect(chunks.length).toBeLessThan(30)
  })
})
